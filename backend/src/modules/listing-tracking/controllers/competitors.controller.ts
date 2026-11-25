import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  AddCompetitorDto,
  CompetitorIdParamDto,
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

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param() params: CompetitorIdParamDto): Promise<void> {
    await this.watchlist.remove(params.id);
  }
}
