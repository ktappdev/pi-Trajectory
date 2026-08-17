import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchSnapshot } from '../api.ts'
import { useTrajectoryStore } from '../store.ts'
import { TrajectoryView } from '../components/TrajectoryView.tsx'

export function TrajectoryPage(): React.JSX.Element {
  const { sessionId } = useParams()
  const setSnapshot = useTrajectoryStore((state) => state.setSnapshot)
  const snapshot = useTrajectoryStore((state) => state.snapshot)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (sessionId === undefined) return
    const controller = new AbortController()
    setError(null)
    setSnapshot(null)
    void fetchSnapshot(sessionId, controller.signal)
      .then(setSnapshot)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : 'Could not load session')
      })
    return () => controller.abort()
  }, [sessionId, setSnapshot])

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="wordmark" to="/">PI / TRAJECTORY</Link>
        <span className="topbar-status">REPLAY</span>
      </header>
      {error !== null ? <section className="feedback feedback-error"><h1>Session unavailable</h1><p>{error}</p><Link to="/">Return to sessions</Link></section> : null}
      {error === null && snapshot === null ? <section className="feedback"><p>Loading trajectory…</p></section> : null}
      {snapshot !== null ? <TrajectoryView /> : null}
    </main>
  )
}
