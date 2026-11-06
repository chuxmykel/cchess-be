import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Move } from '../games/entities/move.entity.js';
import { ExplorerCacheEntry } from './entities/explorer-cache-entry.entity.js';
import { ExplorerPosition } from './entities/explorer-position.entity.js';
import { ExplorerCacheService } from './explorer-cache.service.js';
import { ExplorerController } from './explorer.controller.js';
import { ExplorerService } from './explorer.service.js';
import { LichessExplorerClient } from './lichess/lichess-explorer.client.js';
import { LichessFetcherService } from './lichess/lichess-fetcher.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Move, ExplorerPosition, ExplorerCacheEntry]),
  ],
  controllers: [ExplorerController],
  providers: [
    ExplorerService,
    ExplorerCacheService,
    LichessExplorerClient,
    LichessFetcherService,
  ],
})
export class ExplorerModule {}
