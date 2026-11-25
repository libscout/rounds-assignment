import { loadLatestPoll, type Snapshot } from './api';
import { comparisonMessages } from './consts/timeline-labels.const';
import { pollStatus } from './presentation';

export interface EmptyChangeContext {
  latest: Snapshot | undefined;
  title: string;
  detail?: string;
}

/** Describes the empty changes view from the latest finished poll. */
export async function readEmptyChangeContext(
  id: string,
  signal: AbortSignal,
): Promise<EmptyChangeContext> {
  const latest = await loadLatestPoll(id, signal);
  if (!latest) {
    return { latest, title: 'Waiting for the first check.' };
  }
  const outcome = pollStatus(latest).title + '.';
  const missing = latest.outcomeKind === 'missing';
  const detail = missing ? 'The source returned HTTP 404 on the last check.' : outcome;
  const status = latest.comparisonStatus;
  if (status !== 'completed' && status !== 'not_applicable') {
    return { latest, title: comparisonMessages[status], detail };
  }
  if (missing) {
    return { latest, title: outcome, detail };
  }
  if (latest.outcomeKind === 'complete' && !latest.changed) {
    return { latest, title: 'No changes recorded yet.' };
  }

  return { latest, title: outcome };
}
