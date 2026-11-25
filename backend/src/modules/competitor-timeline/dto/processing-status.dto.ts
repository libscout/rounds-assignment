import { Expose, Type } from 'class-transformer';
import type { PollObservation } from '@src/modules/listing-tracking/types';
import { ComparisonErrorDto } from './comparison-error.dto';
import { TrackingStatusDto } from './tracking-status.dto';

interface ComparisonError {
  pollId: string;
  trackingFinishedAt: Date;
}

export class ProcessingStatusDto {
  @Expose()
  @Type(() => ComparisonErrorDto)
  latestComparisonError: ComparisonErrorDto | null = null;

  @Expose()
  @Type(() => TrackingStatusDto)
  latestTrackingPoll: TrackingStatusDto | null = null;

  constructor(error: ComparisonError | null, poll: PollObservation | undefined) {
    if (poll) {
      this.latestTrackingPoll = Object.assign(new TrackingStatusDto(), {
        pollId: poll.pollId,
        finishedAt: poll.finishedAt.toISOString(),
        outcomeKind: poll.outcomeKind,
      });
    }
    if (error) {
      this.latestComparisonError = Object.assign(new ComparisonErrorDto(), {
        pollId: error.pollId,
        trackingFinishedAt: error.trackingFinishedAt.toISOString(),
        status: 'error' as const,
      });
    }
  }
}
