import { useEffect, useState } from 'react';
import { checkedAt } from './consts/date-formats.const';
import { readEmptyChangeContext, type EmptyChangeContext } from './emptyChangeContext';

/** Reads the latest check once the change feed has loaded and is empty. */
export default function EmptyChanges({
  id,
  visible,
  pollsHref,
  reportedErrorId,
}: {
  id: string;
  visible: boolean;
  pollsHref: string;
  reportedErrorId?: string;
}) {
  const [context, setContext] = useState<EmptyChangeContext | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!visible) {
      return;
    }
    const controller = new AbortController();
    readEmptyChangeContext(id, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setContext(result);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true);
        }
      });

    return () => controller.abort();
  }, [id, visible, attempt]);

  if (!visible) {
    return null;
  }
  if (failed) {
    return (
      <div role="alert">
        Could not load the latest poll.{' '}
        <button
          onClick={() => {
            setFailed(false);
            setAttempt(attempt + 1);
          }}
        >
          Retry
        </button>{' '}
        <a href={pollsHref}>View all polls</a>
      </div>
    );
  }
  if (!context) {
    return <output>Loading the latest poll…</output>;
  }
  const { latest, title, detail } = context;
  const errorAlreadyShown =
    latest?.comparisonStatus === 'error' && latest.pollId === reportedErrorId;
  const heading = errorAlreadyShown ? 'No changes recorded yet.' : title;

  return (
    <section className="event empty-changes">
      <h3>{heading}</h3>
      {detail && <p>{detail}</p>}
      {latest && (
        <p className="last-checked">
          Last checked{' '}
          <time dateTime={latest.fetchedAt}>
            {checkedAt.format(new Date(latest.fetchedAt))}
          </time>
        </p>
      )}
      <a href={pollsHref}>View all polls</a>
    </section>
  );
}
