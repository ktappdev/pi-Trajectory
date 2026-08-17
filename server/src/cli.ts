/** One-command local launcher for pi-Trajectory. */
import { serve } from '@hono/node-server'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { app, mountWebDist } from './http/app.ts'

const here = dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT ?? 8787)
const host = '127.0.0.1'
const url = `http://${host}:${port}`

mountWebDist(resolve(here, '../../web/dist'))

serve({ fetch: app.fetch, port, hostname: host }, () => {
  console.log(`\n  Pi Trajectory running at ${url}\n`)
  if (process.env.NO_OPEN !== '1') {
    const command = process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'cmd'
        : 'xdg-open'
    const args = process.platform === 'win32' ? ['/c', 'start', url] : [url]
    execFile(command, args, () => undefined)
  }
})
