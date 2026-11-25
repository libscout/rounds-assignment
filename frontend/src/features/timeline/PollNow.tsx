import { useEffect, useRef, useState } from 'react';
import { requestPoll, waitForPoll, type HistoryView } from './api';

interface PollNowProps {
  id: string;
  view: HistoryView;
  onFinished: () => void;
}

/** Requests an immediate poll and refreshes the timeline once the result is visible. */
export default function PollNow({ id, view, onFinished }: PollNowProps) {
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => () => active.current?.abort(), []);

  /** Follows the queued poll until the timeline can display its result. */
  async function follow(pollId: string, signal: AbortSignal) {
    try {
      await waitForPoll(id, pollId, view, signal);
      signal.throwIfAborted();
      setMessage('Poll finished.');
      onFinished();
    } catch {
      if (!signal.aborted) {
        setMessage('Poll requested. Refresh the timeline to check its result.');
      }
    }
  }

  /** Shows whether tracking queued a new poll or reused one already in progress. */
  async function poll() {
    if (active.current) {
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const result = await requestPoll(id, controller.signal);
      if (!result) {
        setMessage('Add this competitor to the watchlist to poll it.');

        return;
      }
      const progress = result.created
        ? 'Poll queued.'
        : 'A poll is already in progress.';
      setMessage(progress);
      await follow(result.pollId, controller.signal);
    } catch {
      if (!controller.signal.aborted) {
        setMessage('Could not request a poll. Try again.');
      }
    } finally {
      active.current = null;
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        className="primary"
        type="button"
        disabled={busy}
        onClick={poll}
      >
        Poll now
      </button>
      <output>{message}</output>
    </div>
  );
}
