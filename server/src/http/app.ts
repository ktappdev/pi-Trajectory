/** HTTP API for pi-Trajectory replay mode. */
import { existsSync, statSync } from 'node:fs'
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { buildReplaySnapshot, loadReplayEntries } from '../replay/buildReplaySnapshot.ts'
import { listSessions, resolveSessionPath } from '../replay/listSessions.ts'

const app = new Hono()

app.get('/api/health', (c) => c.json({ ok: true }))

app.get('/api/sessions', async (c) => {
  const sessions = await listSessions()
  return c.json(sessions)
})

app.get('/api/sessions/:id/raw', async (c) => {
  const path = await sessionFile(c.req.param('id'))
  if (path === undefined) return c.json({ error: 'session not found' }, 404)
  try {
    return c.json(loadReplayEntries(path))
  } catch {
    return c.json({ error: 'session could not be parsed' }, 422)
  }
})

app.get('/api/sessions/:id', async (c) => {
  const path = await sessionFile(c.req.param('id'))
  if (path === undefined) return c.json({ error: 'session not found' }, 404)
  return c.json(buildReplaySnapshot(path))
})

async function sessionFile(id: string): Promise<string | undefined> {
  try {
    const path = await resolveSessionPath(decodeURIComponent(id))
    return path !== undefined && existsSync(path) && statSync(path).isFile() ? path : undefined
  } catch {
    return undefined
  }
}

/** Mount static assets when `web/dist` exists (production `pnpm build`). */
export function mountWebDist(dist: string): void {
  if (!existsSync(dist)) return
  app.use('/*', serveStatic({ root: dist, rewriteRequestPath: (path) => path === '/' ? '/index.html' : path }))
  // SPA fallback for `/s/:id` direct loads.
  app.get('*', serveStatic({ root: dist, path: '/index.html' }))
}

export { app }
