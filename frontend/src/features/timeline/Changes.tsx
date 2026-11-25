import { useEffect, useState } from 'react';
import { loadLatestComparisonError, type ComparisonError, type Snapshot } from './api';
import ChangeEntry from './ChangeEntry';
import EmptyChanges from './EmptyChanges';
import { timestamp } from './consts/date-formats.const';

type ComparisonErrorState = ComparisonError | 'unavailable' | null;

/** Reads comparison errors independently of the change feed when the timeline opens or refreshes. */
function useLatestComparisonError(id: string, revision: number) {
  const [error, setError] = useState<ComparisonErrorState>(null);
  useEffect(() => {
    const controller = new AbortController();
    loadLatestComparisonError(id, controller.signal)
      .then((latest) => {
        if (!controller.signal.aborted) {
          setError(latest);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError('unavailable');
        }
      });

    return () => controller.abort();
  }, [id, revision]);

  return error;
}

/** Shows the affected poll's time or explains that comparison status could not be read. */
function ComparisonNotice({ error }: { error: ComparisonErrorState }) {
  if (error === null) {
    return null;
  }
  if (error === 'unavailable') {
    return (
      <output className="comparison-notice">
        Latest comparison status unavailable.
      </output>
    );
  }

  return (
    <output className="comparison-notice">
      Comparison failed for the poll checked at{' '}
      <time dateTime={error.trackingFinishedAt}>
        {timestamp.format(new Date(error.trackingFinishedAt))}
      </time>
      .
    </output>
  );
}

interface ChangesProps {
  id: string;
  rows: Snapshot[];
  pollsHref: string;
  showEmpty: boolean;
  revision: number;
}

/** Shows committed changes alongside the competitor's current comparison error. */
export default function Changes({
  id,
  rows,
  pollsHref,
  showEmpty,
  revision,
}: ChangesProps) {
  const error = useLatestComparisonError(id, revision);
  const reportedErrorId = error === 'unavailable' ? undefined : error?.pollId;

  return (
    <>
      <h2 className="sr-only">Change history</h2>
      <ComparisonNotice error={error} />
      {rows.length > 0 && (
        <ol className="changes">
          {rows.map((poll) => (
            <ChangeEntry
              key={poll.pollId}
              poll={poll}
            />
          ))}
        </ol>
      )}
      <EmptyChanges
        key={revision}
        id={id}
        visible={showEmpty}
        pollsHref={pollsHref}
        reportedErrorId={reportedErrorId}
      />
    </>
  );
}
