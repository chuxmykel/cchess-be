import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { LessThan, Repository } from 'typeorm';

import { SlidingWindowLimiter } from '../common/sliding-window-limiter.js';
import type { AppConfig } from '../config/configuration.js';
import { toMeDto } from '../users/dto/profile.dto.js';
import type { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';
import type { AccessTokenPayload } from './types.js';
import { AccountEmailService } from './account-email.service.js';
import { AuthResponseDto } from './dto/auth-response.dto.js';
import { RefreshToken } from './entities/refresh-token.entity.js';
import { AUTH_RATE_LIMITS } from './rate-limits.js';
import { generateOpaqueToken, hashToken } from './token.util.js';

export const BCRYPT_ROUNDS = 12;

const TRY_LATER = 'Too many attempts - try again later';

@Injectable()
export class AuthService {
  private readonly failuresPerAccount = new SlidingWindowLimiter(
    AUTH_RATE_LIMITS.signInFailuresPerAccount,
    'Too many sign-in attempts - try again in 15 minutes',
  );
  private readonly failuresPerIp = new SlidingWindowLimiter(
    AUTH_RATE_LIMITS.signInFailuresPerIp,
    'Too many sign-in attempts - try again in 15 minutes',
  );
  private readonly accountsPerIp = new SlidingWindowLimiter(
    AUTH_RATE_LIMITS.accountsPerIp,
    TRY_LATER,
  );
  private readonly guestsPerIp = new SlidingWindowLimiter(
    AUTH_RATE_LIMITS.guestsPerIp,
    TRY_LATER,
  );

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    private readonly accountEmail: AccountEmailService,
  ) {}

  private get limited(): boolean {
    return this.configService.get('authRateLimits', { infer: true });
  }

  async register(
    params: {
      username: string;
      email: string;
      password: string;
    },
    ip = '',
  ): Promise<AuthResponseDto> {
    if (this.limited) this.accountsPerIp.recordOrThrow(ip);
    const passwordHash = await bcrypt.hash(params.password, BCRYPT_ROUNDS);
    const user = await this.usersService.createRegisteredUser({
      username: params.username,
      email: params.email,
      passwordHash,
    });
    await this.accountEmail.sendVerificationAfterSignUp(user);
    return this.issueSession(user);
  }

  /** Only failures count toward the limits, by account and by address. */
  async login(
    params: {
      usernameOrEmail: string;
      password: string;
    },
    ip = '',
  ): Promise<AuthResponseDto> {
    const account = params.usernameOrEmail.toLowerCase();
    if (this.limited) {
      this.failuresPerAccount.throwIfLimited(account);
      this.failuresPerIp.throwIfLimited(ip);
    }
    const user = await this.usersService.findByUsernameOrEmail(account);
    const matches =
      !!user?.passwordHash &&
      (await bcrypt.compare(params.password, user.passwordHash));
    if (!user || !matches) {
      if (this.limited) {
        this.failuresPerAccount.record(account);
        this.failuresPerIp.record(ip);
      }
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.suspendedAt) {
      throw new ForbiddenException('This account is suspended');
    }
    return this.issueSession(user);
  }

  async loginAsGuest(ip = ''): Promise<AuthResponseDto> {
    if (this.limited) this.guestsPerIp.recordOrThrow(ip);
    const user = await this.usersService.createGuestUser();
    return this.issueSession(user);
  }

  async refresh(rawRefreshToken: string): Promise<AuthResponseDto> {
    const tokenHash = hashToken(
      rawRefreshToken,
      this.configService.get('jwt.refreshSecret', { infer: true }),
    );
    const stored = await this.refreshTokens.findOne({ where: { tokenHash } });

    if (!stored || stored.revoked || stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    stored.revoked = true;
    await this.refreshTokens.save(stored);

    const user = await this.usersService.findActiveById(stored.userId);
    if (!user) throw new UnauthorizedException('This account is not available');
    return this.issueSession(user);
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashToken(
      rawRefreshToken,
      this.configService.get('jwt.refreshSecret', { infer: true }),
    );
    await this.refreshTokens.update({ tokenHash }, { revoked: true });
  }

  /** Housekeeping: soft-delete expired refresh tokens. Safe to run on an
   * interval - rows are marked deletedAt, never hard-deleted. */
  async pruneExpiredTokens(): Promise<void> {
    await this.refreshTokens.softDelete({ expiresAt: LessThan(new Date()) });
  }

  private async issueSession(user: User): Promise<AuthResponseDto> {
    await this.usersService.touchLastSeen(user.id);

    const payload: AccessTokenPayload = {
      sub: user.id,
      username: user.username,
      isGuest: user.isGuest,
    };
    const accessToken = this.jwtService.sign(payload);

    const rawRefreshToken = generateOpaqueToken();
    const refreshTtlDays = this.configService.get('jwt.refreshTtlDays', {
      infer: true,
    });
    const expiresAt = new Date(
      Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000,
    );

    await this.refreshTokens.save(
      this.refreshTokens.create({
        userId: user.id,
        tokenHash: hashToken(
          rawRefreshToken,
          this.configService.get('jwt.refreshSecret', { infer: true }),
        ),
        expiresAt,
        revoked: false,
      }),
    );

    const ratings = await this.usersService.getRatings(user.id);
    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: toMeDto(user, ratings),
    };
  }
}
