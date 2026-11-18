import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Whether a connection comes from this machine (this container, in
 * Docker). The socket's own address, not a forwarded header, which a
 * client could write. */
export function isLoopback(remoteAddress: string | undefined): boolean {
  return remoteAddress !== undefined && LOOPBACK.has(remoteAddress);
}

/**
 * Lets through only requests made from the api's own machine - in
 * production, `docker compose exec api ...` on the server. Anything else,
 * Caddy's proxied requests included, is told the route doesn't exist.
 */
@Injectable()
export class LoopbackOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!isLoopback(request.socket.remoteAddress)) {
      throw new NotFoundException();
    }
    return true;
  }
}
