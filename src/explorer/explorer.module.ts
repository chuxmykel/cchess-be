import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Move } from '../games/entities/move.entity.js';
import { ExplorerController } from './explorer.controller.js';
import { ExplorerService } from './explorer.service.js';
import { LichessExplorerClient } from './lichess/lichess-explorer.client.js';

@Module({
  imports: [TypeOrmModule.forFeature([Move])],
  controllers: [ExplorerController],
  providers: [ExplorerService, LichessExplorerClient],
})
export class ExplorerModule {}
