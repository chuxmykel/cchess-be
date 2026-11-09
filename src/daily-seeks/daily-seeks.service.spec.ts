import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import type { Game } from '../games/entities/game.entity.js';
import type { GamesService } from '../games/games.service.js';
import type { User } from '../users/entities/user.entity.js';
import type { UsersService } from '../users/users.service.js';
import { DailySeeksService, MAX_DAILY_SEEKS } from './daily-seeks.service.js';
import type { DailySeek } from './entities/daily-seek.entity.js';

const THREE_DAYS_SECONDS = 3 * 24 * 60 * 60;

function makeUser(id: string, isGuest = false): User {
  return { id, username: id, isGuest } as User;
}

function waitingSeek(overrides: Partial<DailySeek> = {}): DailySeek {
  return {
    id: `seek-${overrides.userId ?? 'bob'}`,
    userId: 'bob',
    initialSeconds: THREE_DAYS_SECONDS,
    rated: true,
    rating: 1500,
    ratingBelow: null,
    ratingAbove: null,
    color: 'random',
    createdAt: new Date('2026-11-01T10:00:00Z'),
    ...overrides,
  } as DailySeek;
}

/** DailySeeksService over stand-ins for its repository and the services
 * it calls - every seek in `waiting` there to be found, each player
 * with room for another daily game unless in `noRoomFor`. */
function setup({
  waiting = [] as DailySeek[],
  waitingCount = 0,
  noRoomFor = [] as string[],
} = {}) {
  const users = new Map(
    ['alice', 'bob', 'carol'].map((id) => [id, makeUser(id)]),
  );
  const seeks = {
    count: vi.fn(async () => waitingCount),
    create: vi.fn((fields: Partial<DailySeek>) => fields as DailySeek),
    save: vi.fn(async (seek: DailySeek) => seek),
    find: vi.fn(async () => waiting),
    softDelete: vi.fn(async () => ({
      affected: 1,
      raw: [],
      generatedMaps: [],
    })),
  };
  const gamesService = {
    assertDailyRoom: vi.fn(async (userId: string) => {
      if (noRoomFor.includes(userId)) throw new ConflictException('No room');
    }),
    createGame: vi.fn(
      async (white: User, black: User, tc, rated: boolean) =>
        ({
          gameType: 'daily',
          whiteId: white.id,
          blackId: black.id,
          initialSeconds: tc.initialSeconds,
          rated,
        }) as Game,
    ),
  };
  const usersService = {
    getOrCreateRating: vi.fn(async () => ({ rating: 1500.4 })),
    findByIdOrThrow: vi.fn(async (id: string) => users.get(id)!),
  };
  const service = new DailySeeksService(
    seeks as unknown as Repository<DailySeek>,
    gamesService as unknown as GamesService,
    usersService as unknown as UsersService,
  );
  return { service, seeks, gamesService, usersService };
}

describe('DailySeeksService', () => {
  const alice = makeUser('alice');

  describe('seek', () => {
    it('leaves a seek waiting when none agrees with it', async () => {
      const { service, seeks } = setup();

      const result = await service.seek(alice, { days: 3 });

      expect(result.status).toBe('queued');
      expect(seeks.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'alice',
          initialSeconds: THREE_DAYS_SECONDS,
          rated: true,
          rating: 1500,
          color: 'random',
        }),
      );
    });

    it('looks only among seeks of the same days and rated choice', async () => {
      const { service, seeks } = setup();

      await service.seek(alice, { days: 7, rated: false });

      expect(seeks.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            initialSeconds: 7 * 24 * 60 * 60,
            rated: false,
          }),
        }),
      );
    });

    it('starts a daily game with a seek already waiting, which it takes', async () => {
      const { service, seeks, gamesService } = setup({
        waiting: [waitingSeek({ color: 'black' })],
      });

      const result = await service.seek(alice, { days: 3 });

      expect(result).toEqual({
        status: 'matched',
        game: expect.objectContaining({
          whiteId: 'alice',
          blackId: 'bob',
          initialSeconds: THREE_DAYS_SECONDS,
        }),
      });
      expect(gamesService.createGame).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'alice' }),
        expect.objectContaining({ id: 'bob' }),
        { initialSeconds: THREE_DAYS_SECONDS, incrementSeconds: 0 },
        true,
      );
      expect(seeks.softDelete).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'seek-bob' }),
      );
      expect(seeks.save).not.toHaveBeenCalled();
    });

    it('gives each seeker the color it asked for', async () => {
      const { service } = setup({
        waiting: [waitingSeek({ color: 'white' })],
      });

      const result = await service.seek(alice, { days: 3, color: 'black' });

      expect(result.status === 'matched' && result.game).toMatchObject({
        whiteId: 'bob',
        blackId: 'alice',
      });
    });

    it('passes over a seek wanting the same color', async () => {
      const { service } = setup({
        waiting: [waitingSeek({ color: 'white' })],
      });

      const result = await service.seek(alice, { days: 3, color: 'white' });

      expect(result.status).toBe('queued');
    });

    it('passes over a seek whose player has no room for another daily game', async () => {
      const { service, seeks } = setup({
        waiting: [
          waitingSeek({ userId: 'bob' }),
          waitingSeek({ userId: 'carol' }),
        ],
        noRoomFor: ['bob'],
      });

      const result = await service.seek(alice, { days: 3, color: 'white' });

      expect(result.status === 'matched' && result.game.blackId).toBe('carol');
      expect(seeks.softDelete).toHaveBeenCalledTimes(1);
    });

    it('moves on to the next best seek when another seeker claims one first', async () => {
      const { service, seeks } = setup({
        waiting: [
          waitingSeek({ userId: 'bob' }),
          waitingSeek({ userId: 'carol' }),
        ],
      });
      seeks.softDelete.mockResolvedValueOnce({
        affected: 0,
        raw: [],
        generatedMaps: [],
      });

      const result = await service.seek(alice, { days: 3, color: 'white' });

      expect(result.status === 'matched' && result.game.blackId).toBe('carol');
      expect(seeks.softDelete).toHaveBeenCalledTimes(2);
    });

    it("waits when every seek's been claimed by someone else", async () => {
      const { service, seeks } = setup({ waiting: [waitingSeek()] });
      seeks.softDelete.mockResolvedValue({
        affected: 0,
        raw: [],
        generatedMaps: [],
      });

      expect((await service.seek(alice, { days: 3 })).status).toBe('queued');
    });

    it('makes a guest seek casual, with no rating', async () => {
      const { service, seeks, usersService } = setup();

      await service.seek(makeUser('guest', true), { days: 3, rated: true });

      expect(seeks.save).toHaveBeenCalledWith(
        expect.objectContaining({ rated: false, rating: null }),
      );
      expect(usersService.getOrCreateRating).not.toHaveBeenCalled();
    });

    it('refuses days not on offer', async () => {
      const { service } = setup();

      await expect(service.seek(alice, { days: 4 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses a rating range outside the allowed deltas, or an unknown color', async () => {
      const { service } = setup();

      await expect(
        service.seek(alice, {
          days: 3,
          ratingRange: { below: -1, above: 100 },
        }),
      ).rejects.toThrow('Invalid rating range');
      await expect(
        service.seek(alice, { days: 3, color: 'green' as never }),
      ).rejects.toThrow('Invalid color');
    });

    it(`holds a player to ${MAX_DAILY_SEEKS} seeks waiting`, async () => {
      const { service } = setup({ waitingCount: MAX_DAILY_SEEKS });

      await expect(service.seek(alice, { days: 3 })).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuses a player with no room for another daily game', async () => {
      const { service, seeks } = setup({ noRoomFor: ['alice'] });

      await expect(service.seek(alice, { days: 3 })).rejects.toThrow(
        ConflictException,
      );
      expect(seeks.save).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('withdraws your own seek, still waiting', async () => {
      const { service, seeks } = setup();

      await service.cancel('alice', 'seek-1');

      expect(seeks.softDelete).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'seek-1', userId: 'alice' }),
      );
    });

    it('refuses a seek that is not yours, or no longer waiting', async () => {
      const { service, seeks } = setup();
      seeks.softDelete.mockResolvedValue({
        affected: 0,
        raw: [],
        generatedMaps: [],
      });

      await expect(service.cancel('alice', 'seek-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
