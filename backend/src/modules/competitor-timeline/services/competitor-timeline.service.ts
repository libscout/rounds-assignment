import { BadRequestException, Injectable } from '@nestjs/common';
import { ChangeHistoryService } from '@src/modules/change-history/services';
import { PollObservationsService } from '@src/modules/tracking/services';
import type { PollObservation } from '@src/modules/tracking/types';
import { ChangeFeedRepository } from '../repositories/change-feed.repository';
import { SnapshotDto } from '../dto/snapshot.dto';

/** Combines each processed poll with its recorded change and latest summary for the timeline. */
@Injectable()
export class CompetitorTimelineService {
  constructor(
    private readonly polls: PollObservationsService,
    private readonly changes: ChangeHistoryService,
    private readonly feed: ChangeFeedRepository,
  ) {}

  async page(
    competitorId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ snapshots: SnapshotDto[]; nextCursor: string | null }> {
    const { items, nextCursor } = await this.polls.page(competitorId, limit, cursor);
    return { snapshots: await this.snapshotsFor(items), nextCursor };
  }

  async changePage(competitorId: string, limit: number, cursor?: string) {
    const rows = await this.feed.page(competitorId, limit + 1, cursor);
    if (!rows) throw new BadRequestException('Invalid change cursor');
    const snapshots = rows
      .slice(0, limit)
      .map(({ change, finishedAt, outcomeKind, fields }) =>
        SnapshotDto.fromPoll({ pollId: change.pollId, finishedAt, outcomeKind, fields }, change),
      );
    return { snapshots, nextCursor: rows.length > limit ? snapshots[limit - 1].pollId : null };
  }

  private async snapshotsFor(polls: PollObservation[]): Promise<SnapshotDto[]> {
    if (!polls.length) return [];
    const changes = await this.changes.byPollIds(polls.map((poll) => poll.pollId));
    const changesByPoll = new Map(changes.map((change) => [change.pollId, change]));
    return polls.map((poll) => SnapshotDto.fromPoll(poll, changesByPoll.get(poll.pollId)));
  }
}
