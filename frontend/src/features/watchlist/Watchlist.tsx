import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { addCompetitor, listCompetitors, removeCompetitor } from './api';
import type { Competitor } from './api';
import { demoCompetitorIds } from './consts/demo-competitors.const';
import ResetAll from '../mock-controls/ResetAll';

/** Lists tracked competitors and provides controls for adding and removing them. */
export default function Watchlist() {
  const [items, setItems] = useState<Competitor[]>([]);
  const [readStatus, setReadStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [revision, setRevision] = useState(0);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const disabled = saving || readStatus !== 'ready';

  useEffect(() => {
    const controller = new AbortController();
    listCompetitors(controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) {
          return;
        }
        setItems(rows);
        setReadStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setReadStatus('error');
        }
      });

    return () => controller.abort();
  }, [revision]);

  /** Triggers a fresh watchlist read and shows the loading state. */
  function reload() {
    setReadStatus('loading');
    setRevision((value) => value + 1);
  }

  /** Clears the old watchlist and reloads membership after a confirmed demo reset. */
  function onReset() {
    setInput('');
    setItems([]);
    setMessage('');
    reload();
  }

  /** Applies a watchlist change, reports its outcome and refreshes membership on success. */
  async function save(id: string, action: 'add' | 'remove') {
    if (disabled || !id) {
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      if (action === 'add') {
        await addCompetitor(id);
        setInput('');
        setMessage(`Tracking ${id}.`);
      } else {
        await removeCompetitor(id);
        setMessage(`Removed ${id} from the watchlist.`);
      }
      reload();
    } catch {
      setMessage(`Could not ${action} ${id}. Try again.`);
    } finally {
      setSaving(false);
    }
  }

  /** Submits the trimmed competitor ID from the add form. */
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(input.trim(), 'add');
  }

  return (
    <main>
      <h1>Watchlist</h1>
      <form onSubmit={submit}>
        <label htmlFor="competitor-id">Competitor ID</label>
        <div className="form-row">
          <input
            id="competitor-id"
            list="competitor-suggestions"
            required
            value={input}
            placeholder="Select or type an ID"
            disabled={saving}
            onChange={(event) => setInput(event.target.value)}
          />
          <datalist id="competitor-suggestions">
            {demoCompetitorIds.map((id) => (
              <option
                key={id}
                value={id}
              >
                {id}
              </option>
            ))}
          </datalist>
          <button
            className="primary"
            disabled={disabled || !input.trim()}
          >
            Add competitor
          </button>
        </div>
      </form>
      <output>{message}</output>
      <section aria-labelledby="tracked-heading">
        <h2 id="tracked-heading">Tracked competitors</h2>
        {readStatus === 'loading' && <output>Loading watchlist…</output>}
        {readStatus === 'error' && (
          <div role="alert">
            Could not load the watchlist. <button onClick={reload}>Retry</button>
          </div>
        )}
        {readStatus === 'ready' && items.length === 0 && (
          <p>No competitors tracked yet.</p>
        )}
        {items.length > 0 && (
          <ul className="watchlist">
            {items.map(({ id, changedInLast24h }) => (
              <li key={id}>
                <div>
                  <a href={`/?${new URLSearchParams({ competitor: id })}`}>{id}</a>
                  {changedInLast24h && (
                    <span className="change-flag">Changed in the last 24 hours</span>
                  )}
                  {changedInLast24h === null && (
                    <span
                      className="badge"
                      data-tone="neutral"
                    >
                      Recent activity unavailable
                    </span>
                  )}
                </div>
                <button
                  aria-label={`Remove ${id}`}
                  disabled={disabled}
                  onClick={() => void save(id, 'remove')}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {import.meta.env.DEV && (
        <ResetAll
          busy={saving}
          setBusy={setSaving}
          onReset={onReset}
        />
      )}
    </main>
  );
}
