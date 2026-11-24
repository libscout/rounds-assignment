import Timeline from './features/timeline/Timeline'
import Watchlist from './features/watchlist/Watchlist'

export default function App() {
  const query = new URLSearchParams(window.location.search)
  const id = query.get('competitor')
  const view = query.get('view') === 'polls' ? 'polls' : 'changes'
  return (
    <>
      <header><a href="/" className="brand">CompetitorPulse</a></header>
      {id ? <Timeline key={view + ':' + id} id={id} view={view} /> : <Watchlist />}
    </>
  )
}
