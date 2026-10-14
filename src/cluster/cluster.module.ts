import { Global, Module } from '@nestjs/common';

import { ClusterBus } from './cluster-bus.js';

@Global()
@Module({
  providers: [ClusterBus],
  exports: [ClusterBus],
})
export class ClusterModule {}
