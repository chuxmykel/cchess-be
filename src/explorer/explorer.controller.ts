import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ExplorerPositionDto, ExplorerQuery } from './dto/explorer.dto.js';
import { ExplorerService } from './explorer.service.js';

@ApiTags('explorer')
@ApiBearerAuth()
@Controller('explorer')
export class ExplorerController {
  constructor(private readonly explorerService: ExplorerService) {}

  @Get()
  @ApiOperation({
    summary:
      "The moves played from a position - in lichess's Masters or Lichess database, one player's games here, or everyone's - and how those games ended",
  })
  explore(@Query() query: ExplorerQuery): Promise<ExplorerPositionDto> {
    return this.explorerService.explore(query);
  }
}
