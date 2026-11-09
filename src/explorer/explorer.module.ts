import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Move } from '../games/entities/move.entity.js';
import { ExplorerCacheEntry } from './entities/explorer-cache-entry.entity.js';
import { ExplorerPosition } from './entities/explorer-position.entity.js';
import { LichessFetchState } from './entities/lichess-fetch-state.entity.js';
import { ExplorerCacheService } from './explorer-cache.service.js';
import { ExplorerController } from './explorer.controller.js';
import { ExplorerService } from './explorer.service.js';
import { ExplorerSweeper } from './explorer.sweeper.js';
import { LichessExplorerClient } from './lichess/lichess-explorer.client.js';
import { LichessFetchStateStore } from './lichess/lichess-fetch-state.store.js';
import { LichessFetcherService } from './lichess/lichess-fetcher.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Move,
      ExplorerPosition,
      ExplorerCacheEntry,
      LichessFetchState,
    ]),
  ],
  controllers: [ExplorerController],
  providers: [
    ExplorerService,
    ExplorerCacheService,
    LichessExplorerClient,
    LichessFetcherService,
    LichessFetchStateStore,
    ExplorerSweeper,
  ],
})
export class ExplorerModule {}
