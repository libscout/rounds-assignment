import type { Snapshot } from './api';
import { AiSummary, FieldChanges, ListingDetails } from './ListingContent';
import { pollStatus } from './presentation';
import { clock } from './consts/date-formats.const';

/** Shows one poll with its outcome, listing details, field changes and AI summary. */
export default function PollEntry({
  poll,
  latest,
}: {
  poll: Snapshot;
  latest: boolean;
}) {
  const status = pollStatus(poll);
  const hasListing = poll.outcomeKind === 'complete' || poll.outcomeKind === 'partial';

  const expanded = latest || poll.outcomeKind === 'partial';

  return (
    <li
      className="poll"
      data-tone={status.tone}
    >
      <time dateTime={poll.fetchedAt}>{clock.format(new Date(poll.fetchedAt))}</time>
      <article className="event">
        <div className="event-heading">
          <h4>{status.title}</h4>
          <span className="badge">{status.badge}</span>
        </div>
        <FieldChanges poll={poll} />
        {hasListing && expanded && <ListingDetails poll={poll} />}
        {hasListing && !expanded && (
          <details>
            <summary>Listing details</summary>
            <ListingDetails poll={poll} />
          </details>
        )}
        <AiSummary poll={poll} />
      </article>
    </li>
  );
}
