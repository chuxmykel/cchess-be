import { HttpException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service.js';
import { AUTH_RATE_LIMITS } from './rate-limits.js';

describe('AuthService sign-in limits', () => {
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash('right-password', 4);
  });

  function service(rateLimits = true) {
    const user = { id: 'u1', username: 'ana', isGuest: false, passwordHash };
    const config = {
      get: vi.fn((key: string) =>
        key === 'authRateLimits'
          ? rateLimits
          : key === 'jwt.refreshTtlDays'
            ? 30
            : 'secret',
      ),
    };
    return new AuthService(
      {
        findByUsernameOrEmail: vi.fn().mockResolvedValue(user),
        touchLastSeen: vi.fn(),
        getRatings: vi.fn().mockResolvedValue([]),
      } as never,
      { sign: vi.fn().mockReturnValue('jwt') } as never,
      config as never,
      { save: vi.fn(), create: vi.fn((row) => row) } as never,
      {} as never,
    );
  }

  const failures = AUTH_RATE_LIMITS.signInFailuresPerAccount.messages;

  it('refuses an account after too many wrong passwords, even the right one', async () => {
    const auth = service();
    for (let i = 0; i < failures; i++) {
      await expect(
        auth.login({ usernameOrEmail: 'Ana', password: 'wrong' }, '1.1.1.1'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    const refused = auth.login(
      { usernameOrEmail: 'ana', password: 'right-password' },
      '2.2.2.2',
    );
    await expect(refused).rejects.toBeInstanceOf(HttpException);
    await expect(refused).rejects.toMatchObject({ status: 429 });
  });

  it('counts only failures', async () => {
    const auth = service();
    for (let i = 0; i < failures + 2; i++) {
      await auth.login(
        { usernameOrEmail: 'ana', password: 'right-password' },
        '1.1.1.1',
      );
    }
  });

  it('limits nothing when rate limits are off', async () => {
    const auth = service(false);
    for (let i = 0; i < failures + 2; i++) {
      await expect(
        auth.login({ usernameOrEmail: 'ana', password: 'wrong' }, '1.1.1.1'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });
});
