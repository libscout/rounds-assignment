import type { Snapshot } from './api';
import { AiSummary, FieldChanges, ListingDetails } from './ListingContent';
import FailedAttempts from './FailedAttempts';
import { changeTitle } from './presentation';
import { timestamp } from './consts/date-formats.const';

/** Shows a detected change with its observed values, timestamp and summary status. */
export default function ChangeEntry({ poll }: { poll: Snapshot }) {
  const disappeared = poll.changeKind === 'disappeared';

  return (
    <li className="event change-card">
      <article>
        <div className="event-heading">
          <h3>{changeTitle(poll)}</h3>
          <time dateTime={poll.fetchedAt}>
            {timestamp.format(new Date(poll.fetchedAt))}
          </time>
        </div>
        {disappeared && (
          <span
            className="badge"
            data-tone="amber"
          >
            HTTP 404
          </span>
        )}
        {poll.changeKind === 'returned' && (
          <p className="availability">
            Unavailable → <strong>Available</strong>
          </p>
        )}
        <FieldChanges poll={poll} />
        <ListingDetails poll={poll} />
        <FailedAttempts attempts={poll.failedAttempts} />
        <AiSummary poll={poll} />
      </article>
    </li>
  );
}
