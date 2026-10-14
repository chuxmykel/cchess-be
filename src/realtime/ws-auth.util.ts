import type { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';

import type { AccessTokenPayload, AuthenticatedUser } from '../auth/types.js';

/**
 * Sockets don't go through Nest's HTTP guard pipeline, so the gateway
 * verifies the JWT itself on connection. The token travels in the Socket.IO
 * handshake `auth` payload (`io(url, { auth: { token } })`), not a header.
 */
export function extractHandshakeToken(socket: Socket): string | undefined {
  const authToken = socket.handshake.auth?.token as string | undefined;
  if (authToken) return authToken;

  const header = socket.handshake.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);

  return undefined;
}

export function verifySocketToken(
  jwtService: JwtService,
  socket: Socket,
): AuthenticatedUser {
  const token = extractHandshakeToken(socket);
  if (!token) {
    throw new Error('Missing auth token');
  }
  const payload = jwtService.verify<AccessTokenPayload>(token);
  return {
    userId: payload.sub,
    username: payload.username,
    isGuest: payload.isGuest,
  };
}
