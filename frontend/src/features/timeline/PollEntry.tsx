import type { Snapshot } from './api';
import { AiSummary, FieldChanges, ListingDetails } from './ListingContent';
import FailedAttempts from './FailedAttempts';
import { comparisonMessages } from './consts/timeline-labels.const';
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
  const comparison = poll.changed ? null : comparisonMessages[poll.comparisonStatus];
  const comparisonTone = poll.comparisonStatus === 'pending' ? 'blue' : undefined;
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
        {comparison && (
          <p
            className="poll-note"
            data-tone={comparisonTone}
          >
            {comparison}
          </p>
        )}
        <FieldChanges poll={poll} />
        <ListingDetails
          poll={poll}
          expanded={expanded}
        />
        <FailedAttempts attempts={poll.failedAttempts} />
        <AiSummary poll={poll} />
      </article>
    </li>
  );
}
