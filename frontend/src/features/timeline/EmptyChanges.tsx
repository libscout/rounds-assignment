import { useEffect, useState } from 'react'
import { loadPage, type Snapshot } from './api'
import { pollStatus } from './presentation'

const checkedAt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  timeZone: 'UTC', timeZoneName: 'short',
})

async function readContext(id: string, signal: AbortSignal) {
  let page = await loadPage(id, 'polls', null, signal)
  const latest = page.rows[0]
  const onlyMissing = !page.nextCursor && page.rows.every(poll => poll.outcomeKind === 'missing')
  let count = page.rows.length
  let priorComplete = page.rows.slice(1).some(poll => poll.outcomeKind === 'complete')
  // A complete check may follow many failed checks before its comparison baseline.
  while (latest?.outcomeKind === 'complete' && !priorComplete && page.nextCursor) {
    page = await loadPage(id, 'polls', page.nextCursor, signal)
    count += page.rows.length
    priorComplete = page.rows.some(poll => poll.outcomeKind === 'complete')
  }
  return { latest, priorComplete, onlyMissing, count: page.nextCursor ? null : count }
}

function describe(latest: Snapshot | undefined, priorComplete: boolean, onlyMissing: boolean) {
  if (!latest) return { title: 'Waiting for the first check.' }
  switch (latest.outcomeKind) {
    case 'complete':
      return priorComplete
        ? { title: 'No listing changes detected yet.', detail: 'The listing matched the previous complete check.' }
        : { title: 'First listing recorded.', detail: 'Future checks will compare against this version.' }
    case 'missing':
      return { title: onlyMissing ? 'Listing hasn’t been seen yet.' : 'Listing unavailable.', detail: 'The source returned HTTP 404 on the last check.' }
    default:
      return { title: 'Latest check was inconclusive.', detail: pollStatus(latest).title + '.' }
  }
}

export default function EmptyChanges({ id, pollsHref }: { id: string; pollsHref: string }) {
  const [context, setContext] = useState<Awaited<ReturnType<typeof readContext>> | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    readContext(id, controller.signal).then(result => {
      if (!controller.signal.aborted) setContext(result)
    }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [id, attempt])

  if (failed) return <div role="alert">Could not load the latest poll.{' '}
    <button onClick={() => { setFailed(false); setAttempt(attempt + 1) }}>Retry</button>{' '}
    <a href={pollsHref}>View all polls</a>
  </div>
  if (!context) return <output>Checking poll history…</output>
  const { latest, count, priorComplete, onlyMissing } = context
  const { title, detail } = describe(latest, priorComplete, onlyMissing)
  const link = count === 1 ? 'View 1 poll' : count ? `View all ${count} polls` : 'View all polls'
  return <section className="event empty-changes">
    <h3>{title}</h3>
    {detail && <p>{detail}</p>}
    {latest && <p className="last-checked">Last checked <time dateTime={latest.fetchedAt}>{checkedAt.format(new Date(latest.fetchedAt))}</time></p>}
    <a href={pollsHref}>{link}</a>
  </section>
}
