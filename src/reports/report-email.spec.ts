import { describe, expect, it } from 'vitest';

import type { Report } from './entities/report.entity.js';
import { reportEmail } from './report-email.js';

describe('reportEmail', () => {
  const fields = {
    id: 'r1',
    reason: 'abuse',
    details: 'kept insulting me',
    gameId: 'g1',
    messageId: 'm1',
    messageText: 'you are terrible',
    createdAt: new Date('2026-11-23T10:00:00Z'),
  };
  const report = fields as Report;

  it('says who, why and what was said, and how to act', () => {
    const { subject, text } = reportEmail(report, 'ana', 'bob');
    expect(subject).toBe('[cchess report] abuse: bob');
    expect(text).toContain('ana reported bob for abuse.');
    expect(text).toContain('"you are terrible"');
    expect(text).toContain('/internal/users/bob/suspend');
    expect(text).toContain('/internal/game-chat/m1');
    expect(text).toContain('/internal/reports/r1/resolve');
  });

  it('leaves out what a report of a player alone has none of', () => {
    const { text } = reportEmail(
      {
        ...fields,
        gameId: null,
        messageId: null,
        messageText: null,
        details: null,
      },
      'ana',
      'bob',
    );
    expect(text).not.toContain('Game:');
    expect(text).not.toContain('message');
  });
});
