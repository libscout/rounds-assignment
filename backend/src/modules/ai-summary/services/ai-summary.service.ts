import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { AiSummaryRepository } from '../repositories/ai-summary.repository';
import { summaryFields, summaryKinds } from '../consts/summary-diff.const';
import {
  SummarySubmissionOutcome,
  type SubmitSummary,
  type SummaryDiff,
} from '../types';

/** Accepts immutable diffs and serves the latest outcomes for the requested poll IDs. */
@Injectable()
export class AiSummaryService {
  /** Uses the summary repository to queue diffs and read outcomes. */
  constructor(private readonly repo: AiSummaryRepository) {}

  /** Returns the submission outcome and propagates storage errors for the caller to retry. */
  async submit(input: SubmitSummary): Promise<SummarySubmissionOutcome> {
    if (!isUUID(input?.pollId, '7')) {
      return SummarySubmissionOutcome.InvalidInput;
    }
    if (!AiSummaryService.isValidDiff(input.diff)) {
      return SummarySubmissionOutcome.InvalidInput;
    }

    return this.repo.submit(input);
  }

  /** Checks that the diff has a supported kind and a map of changed fields. */
  private static isValidDiff(diff: SummaryDiff): boolean {
    if (!summaryKinds.includes(diff?.kind)) {
      return false;
    }
    const fields = diff.changedFields;
    const isFieldMap =
      fields !== null && typeof fields === 'object' && !Array.isArray(fields);
    if (!isFieldMap) {
      return false;
    }

    return AiSummaryService.hasValidChanges(diff.kind, fields);
  }

  /** Checks field counts for the change kind and validates each before-and-after value. */
  private static hasValidChanges(
    kind: SummaryDiff['kind'],
    fields: SummaryDiff['changedFields'],
  ): boolean {
    const entries = Object.entries(fields);
    if (kind === 'content_changed' && entries.length === 0) {
      return false;
    }
    if (kind === 'disappeared') {
      return entries.length === 0;
    }

    return entries.every(([name, change]) => {
      if (!summaryFields.has(name)) {
        return false;
      }

      return typeof change?.from === 'string' && typeof change?.to === 'string';
    });
  }

  /** Returns the current outcome for each requested poll with a summary job. */
  getResults(ids: string[]) {
    return this.repo.results(ids);
  }
}
