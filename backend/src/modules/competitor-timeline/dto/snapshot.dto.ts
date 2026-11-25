import { Expose, Type } from 'class-transformer';
import type { ChangeKind, ListingChange } from '@src/modules/change-history/types';
import type { SummaryResult } from '@src/modules/ai-summary/types';
import type { OutcomeKind, PollObservation } from '@src/modules/listing-tracking/types';
import { FailedAttemptDto } from './failed-attempt.dto';
import { ChangedFieldsDto } from './changed-fields.dto';

export type ComparisonStatus =
  'completed' | 'pending' | 'error' | 'unavailable' | 'not_applicable';
type SummaryViewStatus = SummaryResult['status'] | 'not_applicable' | 'unavailable';
export class SnapshotDto {
  @Expose()
  pollId: string;

  @Expose()
  fetchedAt: string;

  @Expose()
  @Type(() => FailedAttemptDto)
  failedAttempts: FailedAttemptDto[];

  @Expose()
  outcomeKind: OutcomeKind;

  @Expose()
  title: string | null;

  @Expose()
  tagline: string | null;

  @Expose()
  description: string | null;

  @Expose()
  price: string | null;

  @Expose()
  changed: boolean;

  @Expose()
  comparisonStatus: ComparisonStatus;

  @Expose()
  changeKind: ChangeKind | null;

  @Expose()
  @Type(() => ChangedFieldsDto)
  changedFields: ChangedFieldsDto;

  @Expose()
  summary: string | null;

  @Expose()
  summaryStatus: SummaryViewStatus;

  @Expose()
  observationAvailable: boolean;

  static fromPoll(
    poll: PollObservation,
    change: ListingChange | null,
    comparisonStatus: ComparisonStatus,
    summaryStatus: SummaryViewStatus,
    summary: string | null,
    observationAvailable = true,
  ): SnapshotDto {
    return Object.assign(new SnapshotDto(), {
      pollId: poll.pollId,
      fetchedAt: poll.finishedAt.toISOString(),
      failedAttempts: poll.failedAttempts,
      outcomeKind: poll.outcomeKind,
      title: poll.fields?.title ?? null,
      tagline: poll.fields?.tagline ?? null,
      description: poll.fields?.description ?? null,
      price: poll.fields?.price ?? null,
      changed: !!change,
      changeKind: change?.kind ?? null,
      changedFields: change?.changedFields ?? {},
      comparisonStatus,
      summary,
      summaryStatus,
      observationAvailable,
    } satisfies SnapshotDto);
  }
}
