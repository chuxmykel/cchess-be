import { requireEnv } from '../common/require-env.js';

export interface AppConfig {
  port: number;
  corsOrigin: string;
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    name: string;
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

// Connection credentials and auth secrets have no fallback - a missing
// .env should fail loudly at boot rather than silently connect to a
// guessed-at database or sign tokens with a secret baked into source
// control. Non-sensitive operational knobs (port, CORS, TTLs, game rules)
// keep sane defaults below; nothing security- or connection-relevant does.
export default (): AppConfig => ({
  port: Number(process.env.PORT ?? 3000),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  database: {
    host: requireEnv('DB_HOST'),
    port: Number(requireEnv('DB_PORT')),
    username: requireEnv('DB_USERNAME'),
    password: requireEnv('DB_PASSWORD'),
    name: requireEnv('DB_NAME'),
  },
  jwt: {
    accessSecret: requireEnv('JWT_ACCESS_SECRET'),
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshSecret: requireEnv('JWT_REFRESH_SECRET'),
    refreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30),
  },
  game: {
    disconnectGraceMs: Number(process.env.GAME_DISCONNECT_GRACE_MS ?? 60_000),
    abortPlyLimit: Number(process.env.GAME_ABORT_PLY_LIMIT ?? 2),
  },
});
