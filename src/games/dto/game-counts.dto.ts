import { ApiProperty } from '@nestjs/swagger';

import type { GameType } from '../../chess/time-control.js';
import type { GameOutcome } from './list-games.query.js';

/** How many finished games ended one way, in one game type, for the player
 * whose games they are. */
export class GameCountDto {
  @ApiProperty({ enum: ['win', 'draw', 'loss'] })
  result!: GameOutcome;

  @ApiProperty({ enum: ['bullet', 'blitz', 'rapid', 'classical', 'daily'] })
  gameType!: GameType;

  @ApiProperty()
  count!: number;
}
