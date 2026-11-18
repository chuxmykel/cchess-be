import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Game } from '../games/entities/game.entity.js';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceService } from './maintenance.service.js';

/** Global, like ClusterModule: whatever starts a live game checks it. */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Game])],
  controllers: [MaintenanceController],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
