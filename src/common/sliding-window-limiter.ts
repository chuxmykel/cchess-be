import { HttpException, HttpStatus } from '@nestjs/common';

export interface RateLimit {
  messages: number;
  perMs: number;
}

/** Allows each key at most `limit.messages` actions per `limit.perMs`. */
export class SlidingWindowLimiter {
  private readonly recentTimes = new Map<string, number[]>();

  constructor(private readonly limit: RateLimit) {}

  recordOrThrow(key: string): void {
    const now = Date.now();
    const recent = (this.recentTimes.get(key) ?? []).filter(
      (at) => now - at < this.limit.perMs,
    );
    if (recent.length >= this.limit.messages) {
      throw new HttpException(
        'Slow down - too many messages',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.recentTimes.set(key, recent);
  }
}
