import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { AppConfig } from '../../config/configuration.js';
import { UsersService } from '../../users/users.service.js';
import type { AccessTokenPayload, AuthenticatedUser } from '../types.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService<AppConfig, true>,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.accessSecret', { infer: true }),
    });
  }

  /** An access token outlives its account by up to its TTL, so the
   * account is looked up: a deleted one is refused at once. */
  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    if (!(await this.usersService.findActiveById(payload.sub))) {
      throw new UnauthorizedException('This account no longer exists');
    }
    return {
      userId: payload.sub,
      username: payload.username,
      isGuest: payload.isGuest,
    };
  }
}
