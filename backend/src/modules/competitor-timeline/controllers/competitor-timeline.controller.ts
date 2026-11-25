import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { CompetitorIdParamDto } from '@src/modules/listing-tracking/dto';
import { SnapshotDto, TrackedCompetitorListItemDto } from '../dto';
import { TimelineQueryDto } from '../dto/timeline-query.dto';
import { CompetitorTimelineService } from '../services/competitor-timeline.service';

/** Serves newest-first snapshots and the cursor for the next page of a competitor’s timeline. */
@Controller('api/competitors')
@UsePipes(
  new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
)
export class CompetitorTimelineController {
  constructor(private readonly timeline: CompetitorTimelineService) {}

  @Get()
  async competitors(): Promise<TrackedCompetitorListItemDto[]> {
    return (await this.timeline.listCompetitors()).map(
      (row) => new TrackedCompetitorListItemDto(row.id, row.changedInLast24h),
    );
  }

  @Get(':id/status')
  status(@Param() params: CompetitorIdParamDto) {
    return this.timeline.processingStatus(params.id);
  }

  @Get(':id/snapshots')
  async list(
    @Param() params: CompetitorIdParamDto,
    @Query() query: TimelineQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SnapshotDto[]> {
    const page = await this.timeline.page(params.id, query.limit, query.cursor);

    return CompetitorTimelineController.response(page, response);
  }

  @Get(':id/changes')
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
    if (page.nextCursor) {
      response.setHeader('X-Next-Cursor', page.nextCursor);
    }

    return page.snapshots;
  }
}
