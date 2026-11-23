import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from '../users/users.module.js';
import { BlocksController } from './blocks.controller.js';
import { BlocksService } from './blocks.service.js';
import { UserBlock } from './entities/user-block.entity.js';

/** Global: friends, challenges, chat and matchmaking all ask it, and it
 * imports none of them. */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([UserBlock]), UsersModule],
  controllers: [BlocksController],
  providers: [BlocksService],
  exports: [BlocksService],
})
export class BlocksModule {}
