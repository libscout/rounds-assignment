import { useState } from 'react'
import { nextVersion } from './api'

export default function AdvanceListing({ id }: { id: string }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function advance() {
    setBusy(true)
    setMessage('')
    try {
      const version = await nextVersion(id)
      setMessage(version
        ? `Mock version ${version.index + 1} of ${version.of}.${version.index + 1 === version.of ? ' This is the final version.' : ''}`
        : 'The mock has no listing for this competitor.')
    } catch {
      setMessage('Could not confirm the mock version. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="advance-listing">
    <button type="button" disabled={busy} onClick={advance}>Advance mock listing</button>
    <output>{message}</output>
  </div>
}
