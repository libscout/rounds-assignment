import { useEffect, useState } from 'react'
import { loadPage } from './api'
import type { HistoryView, Snapshot } from './api'
import EmptyChanges from './EmptyChanges'
import ChangeEntry from './ChangeEntry'
import PollEntry from './PollEntry'
import AdvanceListing from '../mock-controls/AdvanceListing'

const calendar = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
})

function byDay(rows: Snapshot[]) {
  const days = new Map<string, Snapshot[]>()
  for (const row of rows) {
    const day = row.fetchedAt.slice(0, 10)
    const entries = days.get(day)
    if (entries) entries.push(row)
    else days.set(day, [row])
  }
  return days
}

export default function Timeline({ id, view }: { id: string, view: HistoryView }) {
  const changes = view === 'changes'
  const changesHref = '/?' + new URLSearchParams({ competitor: id })
  const pollsHref = changesHref + '&view=polls'
  const itemsLabel = changes ? 'changes' : 'polls'
  const [rows, setRows] = useState<Snapshot[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [page, setPage] = useState<{ cursor: string | null }>({ cursor: null })
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const controller = new AbortController()
    loadPage(id, view, page.cursor, controller.signal).then(result => {
      if (controller.signal.aborted) return
      setRows(previous => page.cursor ? [...previous, ...result.rows] : result.rows)
      setNextCursor(result.nextCursor)
      setStatus('ready')
    }).catch(() => {
      if (!controller.signal.aborted) setStatus('error')
    })
    return () => controller.abort()
  }, [id, view, page])

  function read(cursor: string | null) {
    setStatus('loading')
    setPage({ cursor })
  }

  return (
    <main>
      <a className="back" href="/">← Watchlist</a>
      <h1>{id}</h1>
      {import.meta.env.DEV && <AdvanceListing id={id} />}
      <nav className="history-nav" aria-label="Competitor history">
        <a href={changesHref} aria-current={changes ? 'page' : undefined}>Changes</a>
        <a href={pollsHref} aria-current={!changes ? 'page' : undefined}>All polls</a>
      </nav>
      {changes && <h2 className="sr-only">Change history</h2>}
      {changes && rows.length > 0 && <ol className="changes">{rows.map(poll => <ChangeEntry key={poll.pollId} poll={poll} />)}</ol>}
      {!changes && rows.length > 0 && <div className="section-heading"><h2>Poll history</h2><span>Times in UTC</span></div>}
      {!changes && Array.from(byDay(rows), ([day, polls]) => (
        <section key={day} className="day">
          <h3><time dateTime={day}>{calendar.format(new Date(day))}</time></h3>
          <ol className="timeline">
            {polls.map(poll => <PollEntry key={poll.pollId} poll={poll} latest={poll === rows[0]} />)}
          </ol>
        </section>
      ))}
      {status === 'ready' && rows.length === 0 && (changes
        ? <EmptyChanges id={id} pollsHref={pollsHref} />
        : <p>No polls recorded yet.</p>)}
      {status === 'loading' && <output>Loading {itemsLabel}…</output>}
      {status === 'error' && <div role="alert">
        {page.cursor ? 'Could not load older ' + itemsLabel + '.' : 'Could not load ' + itemsLabel + '.'}{' '}
        <button onClick={() => read(page.cursor)}>Retry</button>
      </div>}
      {status !== 'error' && nextCursor && (
        <button disabled={status === 'loading'} onClick={() => read(nextCursor)}>Load older {itemsLabel}</button>
      )}
    </main>
  )
}
