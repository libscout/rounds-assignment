import Timeline from './features/timeline/Timeline';
import Watchlist from './features/watchlist/Watchlist';

/** Routes the current URL to the watchlist or the selected competitor's timeline. */
export default function App() {
  const query = new URLSearchParams(window.location.search);
  const id = query.get('competitor');
  const view = query.get('view') === 'polls' ? 'polls' : 'changes';

  const content = id ? (
    <Timeline
      key={view + ':' + id}
      id={id}
      view={view}
    />
  ) : (
    <Watchlist />
  );

  return (
    <>
      <header>
        <a
          href="/"
          className="brand"
        >
          CompetitorPulse
        </a>
      </header>
      {content}
    </>
  );
}
