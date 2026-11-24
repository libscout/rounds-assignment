import { Controller, Get, Param, Query, Res, UsePipes, ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';
import { CompetitorIdParamDto } from '@src/modules/tracking/dto';
import { SnapshotDto } from '../dto/snapshot.dto';
import { TimelineQueryDto } from '../dto/timeline-query.dto';
import { CompetitorTimelineService } from '../services/competitor-timeline.service';

/** Serves newest-first snapshots and the cursor for the next page of a competitor’s timeline. */
@Controller('api/competitors/:id')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class CompetitorTimelineController {
  constructor(private readonly timeline: CompetitorTimelineService) {}

  @Get('snapshots')
  async list(
    @Param() params: CompetitorIdParamDto,
    @Query() query: TimelineQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SnapshotDto[]> {
    const page = await this.timeline.page(params.id, query.limit, query.cursor);
    return CompetitorTimelineController.response(page, response);
  }

  @Get('changes')
  async changes(
    @Param() params: CompetitorIdParamDto,
    @Query() query: TimelineQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SnapshotDto[]> {
    const page = await this.timeline.changePage(params.id, query.limit, query.cursor);
    return CompetitorTimelineController.response(page, response);
  }

  private static response(
    page: { snapshots: SnapshotDto[]; nextCursor: string | null },
    response: Response,
  ) {
    if (page.nextCursor) response.setHeader('X-Next-Cursor', page.nextCursor);
    return page.snapshots;
  }
}
