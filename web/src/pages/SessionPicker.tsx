import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { SessionListItem } from '@pi-trajectory/shared'
import { fetchSessions } from '../api.ts'

export function SessionPicker(): React.JSX.Element {
  const [sessions, setSessions] = useState<readonly SessionListItem[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetchSessions(controller.signal)
      .then(setSessions)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : 'Could not load sessions')
      })
    return () => controller.abort()
  }, [])

  const visibleSessions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (needle.length === 0) return sessions
    return sessions.filter((session) => [session.name, session.cwd, session.firstMessage, session.provider, session.model]
      .some((value) => value?.toLocaleLowerCase().includes(needle)))
  }, [query, sessions])

  return (
    <main className="app-shell picker-shell">
      <header className="topbar">
        <span className="wordmark">PI / TRAJECTORY</span>
        <span className="topbar-status">LOCAL REPLAY</span>
      </header>
      <section className="picker-intro">
        <h1>Session traces, held in local orbit.</h1>
        <p>Search every pi session on this machine. Open one to inspect its turns, calls, outputs, and cost.</p>
      </section>
      <section className="session-browser" aria-label="Pi sessions">
        <div className="session-browser-bar">
          <label className="search-control">
            <span className="sr-only">Search sessions</span>
            <input type="search" placeholder="Search project, title, or prompt" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <span className="session-count">{visibleSessions.length} / {sessions.length} sessions</span>
        </div>
        {error !== null ? <div className="feedback feedback-error"><h2>Could not list sessions</h2><p>{error}</p></div> : null}
        {error === null && sessions.length === 0 ? <div className="feedback"><h2>No sessions found</h2><p>Run pi once, then reload this page.</p></div> : null}
        {visibleSessions.length === 0 && sessions.length > 0 ? <div className="feedback"><h2>No matching sessions</h2><p>Try project path, session title, or words from first prompt.</p></div> : null}
        <ol className="session-list">
          {visibleSessions.map((session) => <li key={session.id}>
            <Link className="session-row" to={`/s/${encodeURIComponent(session.id)}`}>
              <time dateTime={new Date(session.modified).toISOString()}>{formatDate(session.modified)}</time>
              <span className="session-project">{projectName(session.cwd)}</span>
              <span className="session-prompt">{session.name ?? (session.firstMessage || 'Untitled session')}</span>
              <span className="session-meta">{session.messageCount} messages{session.model !== undefined ? ` · ${session.model}` : ''}</span>
            </Link>
          </li>)}
        </ol>
      </section>
    </main>
  )
}

function projectName(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean)
  return parts.at(-1) ?? cwd
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}
