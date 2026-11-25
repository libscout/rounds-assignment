import { useEffect, useState } from 'react';
import { checkedAt } from './consts/date-formats.const';
import { readEmptyChangeContext, type EmptyChangeContext } from './emptyChangeContext';

/** Explains an empty change feed using the competitor's recent poll history. */
export default function EmptyChanges({
  id,
  pollsHref,
}: {
  id: string;
  pollsHref: string;
}) {
  const [context, setContext] = useState<EmptyChangeContext | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
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
  }, [id, attempt]);

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
    return <output>Checking poll history…</output>;
  }
  const { latest, count, title, detail } = context;
  let link = 'View all polls';
  if (count === 1) {
    link = 'View 1 poll';
  } else if (count) {
    link = `View all ${count} polls`;
  }

  return (
    <section className="event empty-changes">
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
      {latest && (
        <p className="last-checked">
          Last checked{' '}
          <time dateTime={latest.fetchedAt}>
            {checkedAt.format(new Date(latest.fetchedAt))}
          </time>
        </p>
      )}
      <a href={pollsHref}>{link}</a>
    </section>
  );
}
