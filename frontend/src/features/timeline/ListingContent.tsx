import type { Field, Snapshot } from './api'
import { displayText } from './displayText'
import { fieldLabels, summaryStatuses } from './presentation'

const fields = Object.keys(fieldLabels) as Field[]

export function ListingDetails({ poll }: { poll: Snapshot }) {
  const missing = fields.filter(key => poll[key] === null)
  return (
    <div className="listing">
      <div className="listing-heading">
        {poll.title && <strong>{displayText(poll.title)}</strong>}
        {poll.price && <span className="price">{displayText(poll.price)}</span>}
      </div>
      {poll.tagline && <p className="tagline">{displayText(poll.tagline)}</p>}
      {poll.description && <p>{displayText(poll.description)}</p>}
      {missing.length > 0 && <p className="missing-fields">Fields unavailable: {missing.map(key => fieldLabels[key]).join(', ')}</p>}
    </div>
  )
}

export function FieldChanges({ poll }: { poll: Snapshot }) {
  const changed = fields.filter(key => poll.changedFields[key])
  if (!changed.length) return null
  return (
    <dl className="diff">{changed.map(key => {
      const change = poll.changedFields[key]!
      return <div key={key}>
        <dt>{fieldLabels[key]}</dt>
        <dd>
          <del><span className="sr-only">Before: </span>{displayText(change.from)}</del>
          <ins><span className="sr-only">After: </span>{displayText(change.to)}</ins>
        </dd>
      </div>
    })}</dl>
  )
}

export function AiSummary({ poll }: { poll: Snapshot }) {
  const summary = summaryStatuses[poll.summaryStatus]
  return <div className="ai-summary">
    <div className="ai-status">
      <strong>AI summary</strong>
      <span className="badge" data-tone={summary.tone}>{summary.label}</span>
    </div>
    {poll.summaryStatus === 'ready' && poll.summary?.trim() && <p>{displayText(poll.summary)}</p>}
  </div>
}
