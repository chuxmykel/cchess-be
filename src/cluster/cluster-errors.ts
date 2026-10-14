import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

/**
 * A forwarded game mutation can fail with one of GamesService's normal Nest
 * HTTP exceptions (wrong turn, illegal move, not a player in this game...).
 * Those exception TYPES matter - REST responses depend on their status code,
 * and `cluster.util.ts`'s hashing means a REST request for an existing game
 * lands on its owning worker only by chance, so this can't just rethrow a
 * generic Error on the forwarding side. Only the handful of exception types
 * GamesService actually throws need a round trip here.
 */
const KNOWN_EXCEPTIONS = {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} as const;

export interface WireError {
  name: string;
  message: string;
}

export function toWireError(error: unknown): WireError {
  if (error instanceof Error)
    return { name: error.name, message: error.message };
  return { name: 'Error', message: String(error) };
}

export function reviveError(wireError: WireError): Error {
  const ctor = (
    KNOWN_EXCEPTIONS as Record<string, new (message: string) => Error>
  )[wireError.name];
  return ctor ? new ctor(wireError.message) : new Error(wireError.message);
}
