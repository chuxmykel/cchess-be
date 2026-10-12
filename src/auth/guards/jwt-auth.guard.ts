import { Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // This guard is registered globally (APP_GUARD), which also makes it run
    // for every @SubscribeMessage gateway handler - but passport's extractor
    // expects an HTTP request (req.headers.authorization) and throws on a WS
    // execution context. Socket auth is handled separately, once per
    // connection, in RealtimeGateway.handleConnection (see ws-auth.util.ts) -
    // an unauthenticated socket is disconnected before any message handler
    // can run, so it's safe to just let every WS context through here.
    // Deliberately checked as === 'ws', not !== 'http': a future microservice
    // handler (gRPC, etc.) would get its own 'rpc' context here, and unlike a
    // socket - authenticated once for its whole connection - each such call
    // is its own independent request with no equivalent up-front check, so
    // it must still go through the auth logic below rather than being
    // silently waved through by a catch-all.
    if (context.getType() === 'ws') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
