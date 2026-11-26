import { HttpException, HttpStatus } from '@nestjs/common';

export interface RateLimit {
  messages: number;
  perMs: number;
}

/** Allows each key at most `limit.messages` actions per `limit.perMs`.
 * In memory, so per cluster worker - a limit on abuse, not an exact
 * count. */
export class SlidingWindowLimiter {
  private readonly recentTimes = new Map<string, number[]>();

  constructor(
    private readonly limit: RateLimit,
    private readonly refusal = 'Slow down - too many messages',
  ) {}

  recordOrThrow(key: string): void {
    this.throwIfLimited(key);
    this.record(key);
  }

  /** Whether the key has used up its actions for now. */
  isLimited(key: string): boolean {
    return this.recent(key).length >= this.limit.messages;
  }

  throwIfLimited(key: string): void {
    if (this.isLimited(key)) {
      throw new HttpException(this.refusal, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** Counts an action without checking - a failed sign-in, say, where
   * only failures count. */
  record(key: string): void {
    const recent = this.recent(key);
    recent.push(Date.now());
    this.recentTimes.set(key, recent);
  }

  private recent(key: string): number[] {
    const now = Date.now();
    return (this.recentTimes.get(key) ?? []).filter(
      (at) => now - at < this.limit.perMs,
    );
  }
}
