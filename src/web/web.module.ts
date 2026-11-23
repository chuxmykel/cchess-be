import { Module } from '@nestjs/common';

import { WebController } from './web.controller.js';

@Module({ controllers: [WebController] })
export class WebModule {}
