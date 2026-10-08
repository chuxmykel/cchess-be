export interface AppConfig {
  port: number;
  corsOrigin: string;
  database: {
    path: string;
  };
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshSecret: string;
    refreshTtlDays: number;
  };
  game: {
    /** Grace period after a socket disconnects before the game is forfeited. */
    disconnectGraceMs: number;
    /** Half-moves before either side may abort instead of resign. */
    abortPlyLimit: number;
  };
}

function requireInProduction(value: string | undefined, fallback: string, name: string): string {
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable in production: ${name}`);
  }
  return fallback;
}

export default (): AppConfig => ({
  port: Number(process.env.PORT ?? 3000),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  database: {
    path: process.env.DB_PATH ?? 'data/cchess.sqlite',
  },
  jwt: {
    accessSecret: requireInProduction(
      process.env.JWT_ACCESS_SECRET,
      'dev-insecure-access-secret',
      'JWT_ACCESS_SECRET',
    ),
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshSecret: requireInProduction(
      process.env.JWT_REFRESH_SECRET,
      'dev-insecure-refresh-secret',
      'JWT_REFRESH_SECRET',
    ),
    refreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30),
  },
  game: {
    disconnectGraceMs: Number(process.env.GAME_DISCONNECT_GRACE_MS ?? 60_000),
    abortPlyLimit: Number(process.env.GAME_ABORT_PLY_LIMIT ?? 2),
  },
});
