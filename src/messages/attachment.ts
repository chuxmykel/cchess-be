import { isUUID } from 'class-validator';

import { ServerChessEngine } from '../chess/chess-engine.js';

/** Something chess sent along with a direct message - a game to look
 * through, or a position to analyse - drawn as a card with its board. */
export type MessageAttachment =
  { kind: 'game'; gameId: string } | { kind: 'position'; fen: string };

/** The longest a FEN can sensibly be; anything longer isn't one. */
const MAX_FEN_LENGTH = 100;

export class AttachmentError extends Error {}

/** `raw`, as a client sent it, as an attachment - only its own fields
 * kept - or an AttachmentError saying what's wrong with it. Whether a game
 * shared exists is the caller's to check. */
export function parseAttachment(raw: unknown): MessageAttachment {
  if (typeof raw !== 'object' || raw === null) {
    throw new AttachmentError('Attachment must be an object');
  }
  const { kind, gameId, fen } = raw as Record<string, unknown>;
  if (kind === 'game') {
    if (typeof gameId !== 'string' || !isUUID(gameId)) {
      throw new AttachmentError('A shared game needs its id');
    }
    return { kind, gameId };
  }
  if (kind === 'position') {
    if (typeof fen !== 'string' || fen.length > MAX_FEN_LENGTH) {
      throw new AttachmentError('A shared position needs its FEN');
    }
    try {
      new ServerChessEngine(fen);
    } catch {
      throw new AttachmentError('Not a position');
    }
    return { kind, fen: fen.trim() };
  }
  throw new AttachmentError('Attachment must be a game or a position');
}
