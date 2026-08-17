import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { SessionListItem } from '@pi-trajectory/shared'
import { fetchSessions } from '../api.ts'

const GITHUB_URL = 'https://github.com/ktappdev/pi-Trajectory'

export function SessionPicker(): React.JSX.Element {
  const [sessions, setSessions] = useState<readonly SessionListItem[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    void fetchSessions(controller.signal)
      .then(setSessions)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : 'Could not load sessions')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  const visibleSessions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (needle.length === 0) return sessions
    return sessions.filter((session) => [session.name, session.cwd, session.firstMessage, session.provider, session.model]
      .some((value) => value?.toLocaleLowerCase().includes(needle)))
  }, [query, sessions])

  const sessionLabel = sessions.length === 1 ? 'session' : 'sessions'

  return (
    <main className="app-shell picker-shell">
      <header className="topbar">
        <span className="wordmark">PI / TRAJECTORY</span>
        <div className="topbar-tools">
          <span className="topbar-status">LOCAL REPLAY</span>
          <a className="github-link" href={GITHUB_URL} target="_blank" rel="noreferrer">View on GitHub</a>
        </div>
      </header>
      <section className="picker-intro">
        <div className="picker-intro-copy">
          <h1>Your pi sessions, in full view.</h1>
          <p>Find a run. Trace every turn, tool call, output, and cost — without leaving your machine.</p>
        </div>
        <div className="picker-signals" aria-label="Trajectory properties">
          <span><b>{sessions.length}</b> {sessionLabel} indexed</span>
          <span>Local replay</span>
          <span>Read only</span>
        </div>
      </section>
      <section className="session-browser" aria-label="Pi sessions">
        <div className="session-browser-bar">
          <label className="search-control">
            <span className="sr-only">Search sessions</span>
            <input type="search" placeholder="Search project, title, or prompt" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <span className="session-count">{loading ? 'INDEXING…' : `${visibleSessions.length} / ${sessions.length} sessions`}</span>
        </div>
        {error !== null ? <div className="feedback feedback-error"><h2>Could not read your sessions.</h2><p>{error}</p></div> : null}
        {error === null && loading ? <div className="feedback feedback-loading"><span className="feedback-label">LOCAL ARCHIVE</span><h2>Reading pi session history…</h2><p>Looking through JSONL traces on this machine.</p></div> : null}
        {error === null && !loading && sessions.length === 0 ? <div className="feedback feedback-empty"><span className="feedback-label">NO LOCAL SESSIONS</span><h2>Start with a pi session.</h2><p>Trajectory reads the session files pi keeps locally. Run pi once, then come back and reload this page.</p><button type="button" onClick={() => window.location.reload()}>Reload sessions</button></div> : null}
        {error === null && !loading && visibleSessions.length === 0 && sessions.length > 0 ? <div className="feedback"><span className="feedback-label">NO MATCHES</span><h2>Nothing in that trace.</h2><p>Try a project path, session title, or words from your first prompt.</p></div> : null}
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
      <footer className="picker-footer">
        <span>Pi Trajectory · local session replay</span>
        <span>Built by <a href="https://github.com/ktappdev" target="_blank" rel="noreferrer">@ktappdev</a> · inspired by <a href="https://github.com/deepseek-ai/dsh" target="_blank" rel="noreferrer">DeepSeek Harness Trajectory</a></span>
      </footer>
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
