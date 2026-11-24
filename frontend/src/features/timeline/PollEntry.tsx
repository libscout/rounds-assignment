import type { Snapshot } from './api'
import { AiSummary, FieldChanges, ListingDetails } from './ListingContent'
import { pollStatus } from './presentation'

const clock = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC',
})
export default function PollEntry({ poll, latest }: { poll: Snapshot, latest: boolean }) {
  const status = pollStatus(poll)
  const hasListing = poll.outcomeKind === 'complete' || poll.outcomeKind === 'partial'
  return (
    <li className="poll" data-tone={status.tone}>
      <time dateTime={poll.fetchedAt}>{clock.format(new Date(poll.fetchedAt))}</time>
      <article className="event">
        <div className="event-heading">
          <h4>{status.title}</h4>
          <span className="badge">{status.badge}</span>
        </div>
        <FieldChanges poll={poll} />
        {hasListing && (
          latest || poll.outcomeKind === 'partial'
            ? <ListingDetails poll={poll} />
            : <details><summary>Listing details</summary><ListingDetails poll={poll} /></details>
        )}
        <AiSummary poll={poll} />
      </article>
    </li>
  )
}
