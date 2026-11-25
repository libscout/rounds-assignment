import {
  Body,
  Controller,
  Delete,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  AddCompetitorDto,
  CompetitorIdParamDto,
  RequestedPollDto,
  TrackedCompetitorResponseDto,
} from '../dto';
import { WatchlistService } from '../services';
import { PollAttemptService } from '../internal/poll-attempt.service';

/** Handles watchlist membership and manual poll requests for tracked competitors. */
@Controller('api/competitors')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    transformOptions: { enableImplicitConversion: false },
  }),
)
export class CompetitorsController {
  constructor(
    private readonly watchlist: WatchlistService,
    private readonly polls: PollAttemptService,
  ) {}

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

  @Post(':id/polls')
  @HttpCode(202)
  async requestPoll(@Param() params: CompetitorIdParamDto): Promise<RequestedPollDto> {
    const result = await this.polls.requestPoll(params.id);
    if (!result) {
      throw new NotFoundException('Competitor is not on the watchlist');
    }

    return new RequestedPollDto(result);
  }
}
