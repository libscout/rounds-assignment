import { Injectable } from '@nestjs/common';
import {
  ObservationKind,
  type ListingContent,
  type Observation,
} from '@src/modules/change-history/types';
import { ListingHistoryRepository } from '../repositories';
import { type ListingFields, OutcomeKind } from '../types';

/** Reconstructs the last known listing content and visibility for comparison with a new poll. */
@Injectable()
export class PollBaselineReader {
  constructor(private readonly listings: ListingHistoryRepository) {}
  async read(competitorId: string, before?: { time: Date; id: string }) {
    const baseline = await this.listings.findBaseline(competitorId, before);
    return {
      ...baseline,
      previousFields: baseline.previousFields
        ? PollBaselineReader.completeFields(baseline.previousFields)
        : null,
    };
  }

  static current(kind: OutcomeKind, fields: ListingFields | null): Observation['current'] {
    if (kind === OutcomeKind.Complete)
      return { kind: ObservationKind.Complete, fields: PollBaselineReader.completeFields(fields) };
    return {
      kind: kind === OutcomeKind.Missing ? ObservationKind.Missing : ObservationKind.Inconclusive,
    };
  }

  private static completeFields(fields: ListingFields | null): ListingContent {
    if (
      !fields ||
      typeof fields.title !== 'string' ||
      typeof fields.tagline !== 'string' ||
      typeof fields.description !== 'string' ||
      typeof fields.price !== 'string'
    )
      throw new Error('Complete listing lacks required fields');
    return {
      title: fields.title,
      tagline: fields.tagline,
      description: fields.description,
      price: fields.price,
    };
  }
}
