import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { In, IsNull, MoreThan, Repository } from 'typeorm';

import { SlidingWindowLimiter } from '../common/sliding-window-limiter.js';
import type { AppConfig } from '../config/configuration.js';
import { Mailer } from '../mail/mailer.js';
import type { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';
import {
  type AccountEmail,
  changeEmailMessage,
  emailChangeRequestedMessage,
  passwordChangedMessage,
  resetPasswordMessage,
  verifyEmailMessage,
} from './account-emails.js';
import {
  EmailToken,
  type EmailTokenPurpose,
} from './entities/email-token.entity.js';
import { RefreshToken } from './entities/refresh-token.entity.js';
import { AUTH_RATE_LIMITS } from './rate-limits.js';
import { generateOpaqueToken, hashToken } from './token.util.js';

const HOUR = 60 * 60 * 1000;
/** How long each kind of link works. */
export const EMAIL_TOKEN_TTL_MS: Record<EmailTokenPurpose, number> = {
  verify: 24 * HOUR,
  change: 24 * HOUR,
  reset: HOUR,
};
/** Where each kind of link opens: the app, by a universal / app link, or
 * the server's own page where the app isn't installed. */
const LINK_PATHS: Record<EmailTokenPurpose, string> = {
  verify: '/app/verify-email',
  change: '/app/verify-email',
  reset: '/app/reset-password',
};
const BCRYPT_ROUNDS = 12;

/** The account's email: confirming the address, changing it, and
 * resetting a forgotten password - each by a single-use link. */
@Injectable()
export class AccountEmailService {
  private readonly logger = new Logger(AccountEmailService.name);
  private readonly emailsPerAccount = new SlidingWindowLimiter(
    AUTH_RATE_LIMITS.emailsPerAccount,
    'Too many emails - try again in an hour',
  );
  private readonly resetsPerAddress = new SlidingWindowLimiter(
    AUTH_RATE_LIMITS.resetsPerAddress,
  );
  private readonly resetsPerIp = new SlidingWindowLimiter(
    AUTH_RATE_LIMITS.resetsPerIp,
    'Too many requests - try again later',
  );

  constructor(
    @InjectRepository(EmailToken)
    private readonly tokens: Repository<EmailToken>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    private readonly usersService: UsersService,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private get limited(): boolean {
    return this.config.get('authRateLimits', { infer: true });
  }

  private get supportEmail(): string {
    return this.config.get('mail.supportEmail', { infer: true });
  }

  /** Right after sign-up: a failure to send is logged, never a failed
   * sign-up - the player can ask again. */
  async sendVerificationAfterSignUp(user: User): Promise<void> {
    if (!user.email) return;
    try {
      await this.sendLink(user, 'verify', user.email);
    } catch (error) {
      this.logger.error(
        `could not send ${user.username}'s verification email: ${(error as Error).message}`,
      );
    }
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.usersService.findByIdOrThrow(userId);
    if (!user.email)
      throw new BadRequestException('There is no email to verify');
    if (user.emailVerifiedAt) {
      throw new ConflictException('Your email is already verified');
    }
    this.limit(this.emailsPerAccount, user.id);
    await this.sendOrThrow(user, 'verify', user.email);
  }

  /** Sends a confirmation link to the new address, and tells the old one;
   * the address changes once the link is used. */
  async requestEmailChange(
    userId: string,
    newEmail: string,
    password: string,
  ): Promise<void> {
    const user = await this.usersService.findByIdOrThrow(userId);
    await this.checkPassword(user, password);
    const email = newEmail.toLowerCase();
    if (email === user.email) {
      throw new BadRequestException('That is already your email');
    }
    const owner = await this.usersService.findByEmail(email);
    if (owner) {
      throw new ConflictException('An account with that email already exists');
    }
    this.limit(this.emailsPerAccount, user.id);
    await this.sendOrThrow(user, 'change', email);
    if (user.email) {
      await this.mailQuietly(
        user.email,
        emailChangeRequestedMessage(user.username, email, this.supportEmail),
      );
    }
  }

  /** Uses a verify or change link: the address is confirmed, or becomes
   * the account's. */
  async verify(rawToken: string): Promise<{ email: string }> {
    const token = await this.redeem(rawToken, ['verify', 'change']);
    if (token.purpose === 'change') {
      await this.usersService.changeEmail(token.userId, token.email);
    } else if (
      !(await this.usersService.markEmailVerified(token.userId, token.email))
    ) {
      throw new BadRequestException('This link is for an old email address');
    }
    return { email: token.email };
  }

  /** Always quiet about whether the address has an account: the reply is
   * the same either way. */
  async requestPasswordReset(email: string, ip: string): Promise<void> {
    this.limit(this.resetsPerIp, ip);
    const address = email.toLowerCase();
    const user = await this.usersService.findByEmail(address);
    if (!user || user.isGuest || !user.passwordHash) return;
    if (this.limited) {
      if (this.resetsPerAddress.isLimited(address)) return;
      this.resetsPerAddress.record(address);
    }
    try {
      await this.sendLink(user, 'reset', address);
    } catch (error) {
      this.logger.error(
        `could not send ${user.username}'s reset email: ${(error as Error).message}`,
      );
    }
  }

  /** Sets the new password and signs every device out. */
  async resetPassword(rawToken: string, password: string): Promise<void> {
    const token = await this.redeem(rawToken, ['reset']);
    const user = await this.usersService.findByIdOrThrow(token.userId);
    await this.usersService.setPasswordHash(
      user.id,
      await bcrypt.hash(password, BCRYPT_ROUNDS),
    );
    // The link reached the inbox, so the address is the player's.
    if (user.email === token.email && !user.emailVerifiedAt) {
      await this.usersService.markEmailVerified(user.id, token.email);
    }
    await this.refreshTokens.update(
      { userId: user.id, revoked: false },
      { revoked: true },
    );
    await this.mailQuietly(
      token.email,
      passwordChangedMessage(user.username, this.supportEmail),
    );
  }

  private limit(limiter: SlidingWindowLimiter, key: string): void {
    if (this.limited) limiter.recordOrThrow(key);
  }

  private async checkPassword(user: User, password: string): Promise<void> {
    if (
      !user.passwordHash ||
      !(await bcrypt.compare(password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Wrong password');
    }
  }

  private async sendOrThrow(
    user: User,
    purpose: EmailTokenPurpose,
    email: string,
  ): Promise<void> {
    try {
      await this.sendLink(user, purpose, email);
    } catch (error) {
      this.logger.error(`could not send email: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        "Couldn't send the email - try again later",
      );
    }
  }

  /** A fresh link of this kind, replacing any unused one, mailed. */
  private async sendLink(
    user: User,
    purpose: EmailTokenPurpose,
    email: string,
  ): Promise<void> {
    await this.tokens.softDelete({
      userId: user.id,
      purpose,
      usedAt: IsNull(),
    });
    const raw = generateOpaqueToken();
    await this.tokens.save(
      this.tokens.create({
        userId: user.id,
        purpose,
        email,
        tokenHash: this.hash(raw),
        expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS[purpose]),
        usedAt: null,
      }),
    );
    const link = `${this.config.get('publicUrl', { infer: true })}${LINK_PATHS[purpose]}?token=${encodeURIComponent(raw)}`;
    const message =
      purpose === 'reset'
        ? resetPasswordMessage(user.username, link)
        : purpose === 'change'
          ? changeEmailMessage(user.username, link)
          : verifyEmailMessage(user.username, link);
    await this.mailer.send({ to: email, ...message });
  }

  /** The unused, unexpired link `rawToken` names, now used up. */
  private async redeem(
    rawToken: string,
    purposes: EmailTokenPurpose[],
  ): Promise<EmailToken> {
    const token = await this.tokens.findOne({
      where: {
        tokenHash: this.hash(rawToken),
        purpose: In(purposes),
        usedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
    if (!token) {
      throw new BadRequestException(
        'This link has expired or was already used',
      );
    }
    // Conditional, so two clicks racing can't both use it.
    const claimed = await this.tokens.update(
      { id: token.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );
    if (!claimed.affected) {
      throw new BadRequestException(
        'This link has expired or was already used',
      );
    }
    return token;
  }

  private hash(raw: string): string {
    return hashToken(
      raw,
      this.config.get('jwt.refreshSecret', { infer: true }),
    );
  }

  private async mailQuietly(to: string, message: AccountEmail): Promise<void> {
    try {
      await this.mailer.send({ to, ...message });
    } catch (error) {
      this.logger.error(`could not send email: ${(error as Error).message}`);
    }
  }
}
