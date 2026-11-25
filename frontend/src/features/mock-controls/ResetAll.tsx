import { useState } from 'react';
import { resetDemo } from './api';

interface ResetAllProps {
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onReset: () => void;
}

const confirmation =
  'Delete the entire watchlist, poll history, changes and AI summaries? This also restores both mock servers to their initial settings and clears their counters.';

/** Confirms the local demo reset and reports which servers completed it. */
export default function ResetAll({ busy, setBusy, onReset }: ResetAllProps) {
  const [message, setMessage] = useState('');

  /** Clears demo progress after confirmation and reloads the empty watchlist. */
  async function reset() {
    if (!window.confirm(confirmation)) {
      return;
    }
    setBusy(true);
    setMessage('Resetting…');
    try {
      await resetDemo();
      onReset();
      setMessage('Watchlist, history and both mock servers reset.');
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : 'Could not confirm the reset. Try again.';
      setMessage(detail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="reset-all">
      <button
        type="button"
        disabled={busy}
        onClick={reset}
      >
        Reset all
      </button>
      <output>{message}</output>
    </div>
  );
}
