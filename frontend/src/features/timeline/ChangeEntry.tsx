import type { Snapshot } from './api'
import { AiSummary, FieldChanges, ListingDetails } from './ListingContent'
import { changeTitle } from './presentation'

const timestamp = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  second: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
})

export default function ChangeEntry({ poll }: { poll: Snapshot }) {
  const disappeared = poll.changeKind === 'disappeared'
  return <li className="event change-card">
    <article>
      <div className="event-heading">
        <h3>{changeTitle(poll)}</h3>
        <time dateTime={poll.fetchedAt}>{timestamp.format(new Date(poll.fetchedAt))}</time>
      </div>
      {disappeared && <span className="badge" data-tone="amber">HTTP 404</span>}
      {poll.changeKind === 'returned' && <p className="availability">Unavailable → <strong>Available</strong></p>}
      <FieldChanges poll={poll} />
      {!disappeared && <details><summary>View listing details</summary><ListingDetails poll={poll} /></details>}
      <AiSummary poll={poll} />
    </article>
  </li>
}
