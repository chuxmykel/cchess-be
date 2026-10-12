import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { LessThan, Repository } from 'typeorm';

import type { AppConfig } from '../config/configuration.js';
import { toMeDto } from '../users/dto/profile.dto.js';
import type { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';
import type { AccessTokenPayload } from './types.js';
import { AuthResponseDto } from './dto/auth-response.dto.js';
import { RefreshToken } from './entities/refresh-token.entity.js';
import { generateOpaqueToken, hashToken } from './token.util.js';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
  ) {}

  async register(params: { username: string; email: string; password: string }): Promise<AuthResponseDto> {
    const passwordHash = await bcrypt.hash(params.password, BCRYPT_ROUNDS);
    const user = await this.usersService.createRegisteredUser({
      username: params.username,
      email: params.email,
      passwordHash,
    });
    return this.issueSession(user);
  }

  async login(params: { usernameOrEmail: string; password: string }): Promise<AuthResponseDto> {
    const user = await this.usersService.findByUsernameOrEmail(params.usernameOrEmail);
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const matches = await bcrypt.compare(params.password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.issueSession(user);
  }

  async loginAsGuest(): Promise<AuthResponseDto> {
    const user = await this.usersService.createGuestUser();
    return this.issueSession(user);
  }

  async refresh(rawRefreshToken: string): Promise<AuthResponseDto> {
    const tokenHash = hashToken(rawRefreshToken, this.configService.get('jwt.refreshSecret', { infer: true }));
    const stored = await this.refreshTokens.findOne({ where: { tokenHash } });

    if (!stored || stored.revoked || stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    stored.revoked = true;
    await this.refreshTokens.save(stored);

    const user = await this.usersService.findByIdOrThrow(stored.userId);
    return this.issueSession(user);
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashToken(rawRefreshToken, this.configService.get('jwt.refreshSecret', { infer: true }));
    await this.refreshTokens.update({ tokenHash }, { revoked: true });
  }

  /** Housekeeping: drop expired/revoked refresh tokens. Safe to run on an interval. */
  async pruneExpiredTokens(): Promise<void> {
    await this.refreshTokens.delete({ expiresAt: LessThan(new Date()) });
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
    const refreshTtlDays = this.configService.get('jwt.refreshTtlDays', { infer: true });
    const expiresAt = new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000);

    await this.refreshTokens.save(
      this.refreshTokens.create({
        userId: user.id,
        tokenHash: hashToken(rawRefreshToken, this.configService.get('jwt.refreshSecret', { infer: true })),
        expiresAt,
        revoked: false,
      }),
    );

    const ratings = await this.usersService.getRatings(user.id);
    return { accessToken, refreshToken: rawRefreshToken, user: toMeDto(user, ratings) };
  }
}
