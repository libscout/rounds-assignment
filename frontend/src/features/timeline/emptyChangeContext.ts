import { loadPage, type Snapshot } from './api';
import { changeTitle, pollStatus } from './presentation';

const comparisonMessages = {
  pending: 'Comparison pending.',
  error: 'Comparison failed.',
  unavailable: 'Comparison status unavailable.',
};

interface EmptyChangeMessage {
  title: string;
  detail?: string;
}

export interface EmptyChangeContext extends EmptyChangeMessage {
  latest: Snapshot | undefined;
  count: number | null;
}

/** Explains a completed comparison with the first listing or with an earlier baseline. */
function describeBaseline(priorComplete: boolean): EmptyChangeMessage {
  if (priorComplete) {
    return {
      title: 'No listing changes detected yet.',
      detail: 'The listing matched the previous complete check.',
    };
  }

  return {
    title: 'First listing recorded.',
    detail: 'Future checks will compare against this version.',
  };
}

/** Describes the known comparison or source outcome when a baseline lookup is unnecessary. */
function describePoll(
  latest: Snapshot | undefined,
  onlyMissing: boolean,
): EmptyChangeMessage {
  if (!latest) {
    return { title: 'Waiting for the first check.' };
  }
  const status = latest.comparisonStatus;
  if (status !== 'completed' && status !== 'not_applicable') {
    return {
      title: comparisonMessages[status],
      detail: pollStatus(latest).title + '.',
    };
  }
  if (status === 'completed' && latest.changed) {
    return { title: changeTitle(latest) };
  }
  if (latest.outcomeKind === 'missing') {
    const title = onlyMissing
      ? 'Listing hasn’t been seen yet.'
      : 'Listing unavailable.';

    return { title, detail: 'The source returned HTTP 404 on the last check.' };
  }

  return {
    title: 'Latest check was inconclusive.',
    detail: pollStatus(latest).title + '.',
  };
}

/** Reads older polls only to distinguish a completed first baseline from a confirmed match. */
export async function readEmptyChangeContext(
  id: string,
  signal: AbortSignal,
): Promise<EmptyChangeContext> {
  let page = await loadPage(id, 'polls', null, signal);
  const latest = page.rows.at(0);
  let count = page.rows.length;
  let message: EmptyChangeMessage;
  const needsBaseline =
    latest?.outcomeKind === 'complete' &&
    latest.comparisonStatus === 'completed' &&
    !latest.changed;
  if (needsBaseline) {
    let priorComplete = page.rows
      .slice(1)
      .some((poll) => poll.outcomeKind === 'complete');
    while (!priorComplete && page.nextCursor) {
      page = await loadPage(id, 'polls', page.nextCursor, signal);
      count += page.rows.length;
      priorComplete = page.rows.some((poll) => poll.outcomeKind === 'complete');
    }
    message = describeBaseline(priorComplete);
  } else {
    const onlyMissing =
      !page.nextCursor && page.rows.every((poll) => poll.outcomeKind === 'missing');
    message = describePoll(latest, onlyMissing);
  }
  const totalCount = page.nextCursor ? null : count;

  return { latest, count: totalCount, ...message };
}
