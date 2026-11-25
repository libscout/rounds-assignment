import { Injectable } from '@nestjs/common';
import { ListingHistoryRepository, PollDeliveryRepository } from '../repositories';
import { OutcomeKind, type DeliverableObservation, type ListingFields } from '../types';
import { listingFields } from '../consts/listing-fields.const';

/** Serves immutable complete and missing observations to the poll consumer. */
@Injectable()
export class PollDeliveryService {
  /** Uses delivery state and poll history to serve observations to the consumer. */
  constructor(
    private readonly queue: PollDeliveryRepository,
    private readonly history: ListingHistoryRepository,
  ) {}

  /** Returns a page containing the first deliverable poll for each eligible competitor. */
  listDeliverablePolls(limit: number, after?: string) {
    return this.queue.list(limit, after);
  }

  /** Finds the next poll awaiting acknowledgement for one competitor. */
  oldestOutstandingId(competitorId: string) {
    return this.queue.head(competitorId);
  }

  /** Marks the poll as delivered after the consumer has processed it. */
  acknowledge(pollId: string) {
    return this.queue.acknowledge(pollId);
  }

  /** Returns a complete listing or a confirmed absence and rejects other poll outcomes. */
  async getDeliverableObservation(id: string): Promise<DeliverableObservation> {
    const [row] = await this.history.byIds([id]);
    if (row?.outcomeKind === OutcomeKind.Missing) {
      return { ...row, outcomeKind: OutcomeKind.Missing, fields: null };
    }
    if (
      row?.outcomeKind !== OutcomeKind.Complete ||
      !PollDeliveryService.hasCompleteFields(row.fields)
    ) {
      throw new Error('Expected a complete or missing observation');
    }

    return {
      ...row,
      outcomeKind: OutcomeKind.Complete,
      fields: row.fields,
    };
  }

  /** Checks that every listing field is present as a string before delivery. */
  private static hasCompleteFields(
    fields: ListingFields | null,
  ): fields is Required<ListingFields> {
    return (
      fields != null && listingFields.every((key) => typeof fields[key] === 'string')
    );
  }
}
