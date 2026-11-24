import { Expose, Type } from 'class-transformer';
import type { ChangeKind, ListingChange, SummaryStatus } from '@src/modules/change-history/types';
import type { OutcomeKind, PollObservation } from '@src/modules/tracking/types';
import { ChangedFieldsDto } from './changed-fields.dto';

export class SnapshotDto {
  @Expose() pollId: string;
  @Expose() fetchedAt: string;
  @Expose() title: string | null;
  @Expose() tagline: string | null;
  @Expose() price: string | null;
  @Expose() description: string | null;
  @Expose() outcomeKind: OutcomeKind;
  @Expose() changed: boolean;
  @Expose() changeKind: ChangeKind | null;
  @Expose() @Type(() => ChangedFieldsDto) changedFields: ChangedFieldsDto;
  @Expose() summary: string | null;
  @Expose() summaryStatus: SummaryStatus | 'not_applicable';

  static fromPoll(poll: PollObservation, change?: ListingChange): SnapshotDto {
    return Object.assign(new SnapshotDto(), {
      pollId: poll.pollId,
      fetchedAt: poll.finishedAt.toISOString(),
      outcomeKind: poll.outcomeKind,
      title: poll.fields?.title ?? null,
      tagline: poll.fields?.tagline ?? null,
      description: poll.fields?.description ?? null,
      price: poll.fields?.price ?? null,
      changed: change !== undefined,
      changeKind: change?.kind ?? null,
      changedFields: change?.changedFields ?? {},
      summary: change?.summary ?? null,
      summaryStatus: change?.summaryStatus ?? 'not_applicable',
    } satisfies SnapshotDto);
  }
}
