import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import type { GameType } from '../chess/time-control.js';
import {
  Rating,
  STARTING_DEVIATION,
  STARTING_RATING,
  STARTING_VOLATILITY,
} from './entities/rating.entity.js';
import { User } from './entities/user.entity.js';

export const GAME_TYPES: readonly GameType[] = [
  'bullet',
  'blitz',
  'rapid',
  'classical',
];

// Postgres's own SQLSTATE code for unique_violation - not an app-specific
// value, it's part of the Postgres error-code standard.
const POSTGRES_UNIQUE_VIOLATION = '23505';

const AVATAR_PALETTE = [
  '#F5A623',
  '#E8601C',
  '#8E6E53',
  '#3A3A3A',
  '#4A90D9',
  '#7B61FF',
  '#2E9E6B',
  '#D64545',
];

// Classic Java String.hashCode()-style multiplier - not security-sensitive
// (just picking a deterministic palette index), any odd multiplier with
// good bit-mixing would do.
const HASH_MULTIPLIER = 31;

function pickAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * HASH_MULTIPLIER + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Rating) private readonly ratings: Repository<Rating>,
  ) {}

  async findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  async findByIdOrThrow(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.users.findOne({ where: { username: username.toLowerCase() } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ where: { email: email.toLowerCase() } });
  }

  async findByUsernameOrEmail(identifier: string): Promise<User | null> {
    const lowered = identifier.toLowerCase();
    return this.users.findOne({
      where: [{ username: lowered }, { email: lowered }],
    });
  }

  async createRegisteredUser(params: {
    username: string;
    email: string;
    passwordHash: string;
  }): Promise<User> {
    const username = params.username.toLowerCase();
    const email = params.email.toLowerCase();

    if (await this.findByUsername(username)) {
      throw new ConflictException('Username is already taken');
    }
    if (await this.findByEmail(email)) {
      throw new ConflictException('An account with that email already exists');
    }

    const user = this.users.create({
      username,
      email,
      passwordHash: params.passwordHash,
      displayName: params.username,
      isGuest: false,
      bio: null,
      avatarColor: pickAvatarColor(username),
    });
    const saved = await this.users.save(user);

    await this.ratings.save(
      GAME_TYPES.map((category) =>
        this.ratings.create({
          userId: saved.id,
          category,
          rating: STARTING_RATING,
          deviation: STARTING_DEVIATION,
          volatility: STARTING_VOLATILITY,
          gamesPlayed: 0,
        }),
      ),
    );

    return saved;
  }

  async createGuestUser(): Promise<User> {
    // randomUUID()-derived suffix (~1.1 trillion possible values from the
    // first 10 hex chars) rather than Math.random().toString(36) (~2.2
    // billion) - at tens of thousands of simultaneous guest signups (e.g.
    // load testing), the birthday-paradox collision odds on the old scheme
    // were measured in the tens of percent, not a theoretical edge case.
    // The retry below is still real defense-in-depth on top of that, since
    // no fixed-width random suffix is collision-proof at arbitrary scale.
    const MAX_ATTEMPTS = 5;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
      const username = `guest_${suffix}`;
      const user = this.users.create({
        username,
        email: null,
        passwordHash: null,
        displayName: `Guest ${suffix.slice(0, 4).toUpperCase()}`,
        isGuest: true,
        bio: null,
        avatarColor: pickAvatarColor(username),
      });
      try {
        return await this.users.save(user);
      } catch (error) {
        const isUniqueViolation =
          error instanceof QueryFailedError &&
          (error as unknown as { code?: string }).code ===
            POSTGRES_UNIQUE_VIOLATION;
        if (!isUniqueViolation || attempt === MAX_ATTEMPTS) throw error;
        // A real collision, not the theoretical edge case the comment above
        // describes - worth knowing if this starts firing often outside of
        // load testing, since that'd mean the odds have shifted (e.g. a far
        // larger guest-account volume than expected).
        this.logger.warn(
          `guest username collision on attempt ${attempt}/${MAX_ATTEMPTS}, retrying`,
        );
      }
    }
    // Unreachable (the loop always returns or throws), but keeps TS's
    // control-flow analysis happy about a guaranteed return value.
    throw new Error('failed to create guest user after retries');
  }

  async updateProfile(
    userId: string,
    updates: { displayName?: string; bio?: string | null },
  ): Promise<User> {
    const user = await this.findByIdOrThrow(userId);
    if (updates.displayName !== undefined)
      user.displayName = updates.displayName;
    if (updates.bio !== undefined) user.bio = updates.bio;
    return this.users.save(user);
  }

  /** Returns the rating row (creating one at the starting rating if missing - e.g. a guest's first rated game). */
  async findRating(userId: string, category: GameType): Promise<Rating | null> {
    return this.ratings.findOne({ where: { userId, category } });
  }

  async getOrCreateRating(userId: string, category: GameType): Promise<Rating> {
    const existing = await this.findRating(userId, category);
    if (existing) return existing;
    return this.ratings.save(
      this.ratings.create({
        userId,
        category,
        rating: STARTING_RATING,
        deviation: STARTING_DEVIATION,
        volatility: STARTING_VOLATILITY,
        gamesPlayed: 0,
      }),
    );
  }

  async applyRatingUpdate(
    userId: string,
    category: GameType,
    {
      rating,
      deviation,
      volatility,
    }: Pick<Rating, 'rating' | 'deviation' | 'volatility'>,
    ratedAt: Date,
  ): Promise<Rating> {
    const row = await this.getOrCreateRating(userId, category);
    row.rating = rating;
    row.deviation = deviation;
    row.volatility = volatility;
    row.lastRatedAt = ratedAt;
    row.gamesPlayed += 1;
    return this.ratings.save(row);
  }

  async touchLastSeen(userId: string): Promise<void> {
    await this.users.update({ id: userId }, { lastSeenAt: new Date() });
  }

  async getRatings(userId: string): Promise<Rating[]> {
    return this.ratings.find({ where: { userId } });
  }

  async getRatingsByUsername(username: string): Promise<Rating[]> {
    const user = await this.findByUsername(username);
    if (!user) throw new NotFoundException('User not found');
    return this.getRatings(user.id);
  }
}
