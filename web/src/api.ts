import type { SessionListItem, TrajectorySnapshot } from '@pi-trajectory/shared'

export async function fetchSessions(signal?: AbortSignal): Promise<readonly SessionListItem[]> {
  return fetchJson<readonly SessionListItem[]>('/api/sessions', signal)
}

export async function fetchSnapshot(id: string, signal?: AbortSignal): Promise<TrajectorySnapshot> {
  return fetchJson<TrajectorySnapshot>(`/api/sessions/${encodeURIComponent(id)}`, signal)
}

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal })
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => undefined)
    const message = typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : `${response.status} ${response.statusText}`
    throw new Error(message)
  }
  return response.json() as Promise<T>
}
