import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/**
 * Whether users are connected, from the realtime gateway's `user:{id}`
 * rooms. The gateway attaches its server on init; the room lookups go
 * through the Socket.IO adapter, so they see every cluster worker.
 */
@Injectable()
export class PresenceService {
  private server: Server | null = null;

  attach(server: Server): void {
    this.server = server;
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.onlineUserIds([userId])).has(userId);
  }

  async onlineUserIds(userIds: string[]): Promise<Set<string>> {
    if (!this.server || userIds.length === 0) return new Set();
    const sockets = await this.server.in(userIds.map(userRoom)).fetchSockets();
    return new Set(
      sockets
        .map(
          (socket) =>
            (socket.data as { user?: { userId: string } }).user?.userId,
        )
        .filter(
          (userId): userId is string =>
            userId !== undefined && userIds.includes(userId),
        ),
    );
  }
}
