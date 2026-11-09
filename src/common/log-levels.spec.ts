import { describe, expect, it } from 'vitest';

import { logLevelsFrom } from './log-levels.js';

describe('logLevelsFrom', () => {
  it('shows the level given and every one more severe', () => {
    expect(logLevelsFrom('warn')).toEqual(['warn', 'error', 'fatal']);
    expect(logLevelsFrom('verbose')).toEqual([
      'verbose',
      'debug',
      'log',
      'warn',
      'error',
      'fatal',
    ]);
  });

  it('reads the level whatever its case or spacing', () => {
    expect(logLevelsFrom(' DEBUG ')).toEqual([
      'debug',
      'log',
      'warn',
      'error',
      'fatal',
    ]);
  });

  it('falls back to log when unset, blank or not a level', () => {
    const fromLog = ['log', 'warn', 'error', 'fatal'];
    expect(logLevelsFrom(undefined)).toEqual(fromLog);
    expect(logLevelsFrom('')).toEqual(fromLog);
    expect(logLevelsFrom('loud')).toEqual(fromLog);
  });
});
