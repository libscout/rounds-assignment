import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  AddCompetitorDto,
  CompetitorIdParamDto,
  TrackedCompetitorListItemDto,
  TrackedCompetitorResponseDto,
} from '../dto';
import { WatchlistService } from '../services';

/** Handles HTTP requests to add, list, and remove tracked competitors. */
@Controller('api/competitors')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    transformOptions: { enableImplicitConversion: false },
  }),
)
export class CompetitorsController {
  constructor(private readonly watchlist: WatchlistService) {}

  @Post()
  async add(@Body() body: AddCompetitorDto): Promise<TrackedCompetitorResponseDto> {
    await this.watchlist.add(body.id);
    return new TrackedCompetitorResponseDto(body.id);
  }

  @Get()
  async list(): Promise<TrackedCompetitorListItemDto[]> {
    const rows = await this.watchlist.list();
    return rows.map((row) => new TrackedCompetitorListItemDto(row.id, row.changedInLast24h));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param() params: CompetitorIdParamDto): Promise<void> {
    await this.watchlist.remove(params.id);
  }
}
