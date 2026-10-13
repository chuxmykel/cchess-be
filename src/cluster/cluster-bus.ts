import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';

import { CLUSTERING_ENABLED, WORKER_INDEX } from './cluster.util.js';
import { reviveError, toWireError, type WireError } from './cluster-errors.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

type RequestHandler = (payload: unknown) => Promise<unknown>;

type ClusterIpcMessage =
  | { kind: 'request'; corrId: string; from: number; to: number; reqType: string; payload: unknown }
  | { kind: 'response'; corrId: string; to: number; ok: true; result: unknown }
  | { kind: 'response'; corrId: string; to: number; ok: false; error: WireError };

function isClusterIpcMessage(value: unknown): value is ClusterIpcMessage {
  return typeof value === 'object' && value !== null && 'kind' in value && 'corrId' in value;
}

/**
 * Point-to-point RPC between cluster workers, relayed through the primary
 * process (see cluster-primary.ts) since Node's `cluster` module only gives
 * workers an IPC channel to the primary, not to each other directly. Used
 * for the handful of operations that must run on one specific worker - the
 * one that owns a given game's in-memory engine cache, clock timer and
 * mutex (see GamesService) - regardless of which worker actually received
 * the request that triggered them.
 *
 * A complete no-op when clustering is disabled (the default): nothing calls
 * `request()` in that case (see `cluster.util.ts`'s `isMine`, which is
 * always true for a single worker), and no `process.on('message')` listener
 * is registered.
 */
@Injectable()
export class ClusterBus implements OnModuleDestroy {
  private readonly logger = new Logger(ClusterBus.name);
  private readonly pendingRequestsByCorrId = new Map<string, PendingRequest>();
  private readonly handlers = new Map<string, RequestHandler>();
  /** Incremented per outbound request - see `request()` for why. */
  private requestSeq = 0;
  private readonly listener = (msg: unknown) => void this.handleInbound(msg);

  constructor() {
    if (CLUSTERING_ENABLED) process.on('message', this.listener);
  }

  onModuleDestroy(): void {
    process.off('message', this.listener);
    for (const p of this.pendingRequestsByCorrId.values()) clearTimeout(p.timeout);
  }

  /** Registers the handler that runs ON THIS WORKER when another worker forwards `type` here. */
  onRequest<TPayload, TResult>(type: string, handler: (payload: TPayload) => Promise<TResult>): void {
    this.logger.log(`[ClusterBus.onRequest] Setting ${type} handler`);
    this.handlers.set(type, handler as RequestHandler);
  }

  async request<TResult>(targetWorker: number, type: string, payload: unknown, timeoutMs = 15_000): Promise<TResult> {
    const corrId = `${WORKER_INDEX}:${++this.requestSeq}`;
    return new Promise<TResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequestsByCorrId.delete(corrId);
        // Worth knowing about even though the caller also sees the rejection -
        // a timeout here means the target worker is overloaded, deadlocked, or
        // crashed, which the eventual HTTP/WS error alone doesn't distinguish
        // from a normal business-rule rejection.
        this.logger.warn(`request '${type}' to worker ${targetWorker} timed out after ${timeoutMs}ms`);
        reject(new Error(`cluster request '${type}' to worker ${targetWorker} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timeout.unref?.();
      this.pendingRequestsByCorrId.set(corrId, { resolve: resolve as (v: unknown) => void, reject, timeout });

      const message: ClusterIpcMessage = { kind: 'request', corrId, from: WORKER_INDEX, to: targetWorker, reqType: type, payload };
      this.logger.log(
        `[ClusterBus.request] Sending request type: ${type} with payload: ${JSON.stringify(payload)} from worker: ${WORKER_INDEX} to worker: ${targetWorker}.`,
      );
      process.send?.(message);
    });
  }

  private async handleInbound(msg: unknown): Promise<void> {
    if (!isClusterIpcMessage(msg)) return;

    if (msg.kind === 'response') {
      const pendingRequest = this.pendingRequestsByCorrId.get(msg.corrId);
      if (!pendingRequest) return;
      this.pendingRequestsByCorrId.delete(msg.corrId);
      clearTimeout(pendingRequest.timeout);
      if (msg.ok) pendingRequest.resolve(msg.result);
      else pendingRequest.reject(reviveError(msg.error));
      return;
    }

    const handler = this.handlers.get(msg.reqType);
    if (!handler) {
      const errorMessage = `worker ${WORKER_INDEX} has no handler for '${msg.reqType}'`;
      const error = toWireError(new Error(errorMessage));
      this.logger.error(errorMessage);
      process.send?.({ kind: 'response', corrId: msg.corrId, to: msg.from, ok: false, error } satisfies ClusterIpcMessage);
      return;
    }
    try {
      const result = await handler(msg.payload);
      process.send?.({ kind: 'response', corrId: msg.corrId, to: msg.from, ok: true, result } satisfies ClusterIpcMessage);
    } catch (error) {
      this.logger.debug(`forwarded '${msg.reqType}' from worker ${msg.from} failed: ${(error as Error).message}`);
      process.send?.({
        kind: 'response',
        corrId: msg.corrId,
        to: msg.from,
        ok: false,
        error: toWireError(error),
      } satisfies ClusterIpcMessage);
    }
  }
}
