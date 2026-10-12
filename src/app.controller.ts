import { Controller, Get } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';

import { Public } from './common/decorators/public.decorator.js';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get('health')
  @ApiExcludeEndpoint()
  getHealth() {
    return this.appService.getHealth();
  }
}
