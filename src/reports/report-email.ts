import type { Report } from './entities/report.entity.js';

/** The email a report sends to the support address: everything needed to
 * judge it, and how to act on it from the server. Pure, tested alone. */
export function reportEmail(
  report: Report,
  reporter: string,
  reported: string,
): { subject: string; text: string } {
  const lines = [
    `${reporter} reported ${reported} for ${report.reason}.`,
    report.details ? `What they said: ${report.details}` : null,
    report.gameId ? `Game: ${report.gameId}` : null,
    report.messageText !== null
      ? `The message (${report.messageId}): "${report.messageText}"`
      : null,
    `Report ${report.id}, ${report.createdAt.toISOString()}.`,
    [
      'To act, on the server (docker compose exec api ...):',
      `  curl -X POST localhost:3000/internal/users/${reported}/suspend`,
      report.messageId
        ? `  curl -X DELETE localhost:3000/internal/${report.gameId ? 'game-chat' : 'direct-messages'}/${report.messageId}`
        : null,
      `  curl -X POST localhost:3000/internal/reports/${report.id}/resolve`,
    ]
      .filter(Boolean)
      .join('\n'),
  ];
  return {
    subject: `[cchess report] ${report.reason}: ${reported}`,
    text: lines.filter(Boolean).join('\n\n'),
  };
}
