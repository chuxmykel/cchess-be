import type { LogLevel } from '@nestjs/common';

/** Nest's log levels, least severe first. */
export const LOG_LEVELS: readonly LogLevel[] = [
  'verbose',
  'debug',
  'log',
  'warn',
  'error',
  'fatal',
];

/** Shown when LOG_LEVEL is unset - routine passes and per-request lines
 * (debug, verbose) left out. */
export const DEFAULT_LOG_LEVEL: LogLevel = 'log';

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/** The levels Nest shows for LOG_LEVEL: that level and every one more
 * severe - Nest itself takes a list, not a threshold. Unset or not a level,
 * the default's. */
export function logLevelsFrom(value: string | undefined): LogLevel[] {
  const wanted = value?.trim().toLowerCase() ?? '';
  const level = isLogLevel(wanted) ? wanted : DEFAULT_LOG_LEVEL;
  return LOG_LEVELS.slice(LOG_LEVELS.indexOf(level));
}
