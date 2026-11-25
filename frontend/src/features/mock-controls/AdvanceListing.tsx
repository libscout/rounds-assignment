import { useState } from 'react';
import { nextVersion } from './api';

/** Shows the development control for advancing a mock listing and its latest result. */
export default function AdvanceListing({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  /** Advances the listing once and reports the resulting version or failure. */
  async function advance() {
    setBusy(true);
    setMessage('');
    try {
      const version = await nextVersion(id);
      if (!version) {
        setMessage('The mock has no listing for this competitor.');

        return;
      }
      const number = version.index + 1;
      const suffix = number === version.of ? ' This is the final version.' : '';
      setMessage(`Mock version ${number} of ${version.of}.${suffix}`);
    } catch {
      setMessage('Could not confirm the mock version. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="advance-listing">
      <button
        type="button"
        disabled={busy}
        onClick={advance}
      >
        Advance mock listing
      </button>
      <output>{message}</output>
    </div>
  );
}
