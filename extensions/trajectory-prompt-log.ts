/**
 * pi-Trajectory extension.
 *
 * - Logs hash-gated system-prompt snapshots to session JSONL via
 *   `before_agent_start`, so Trajectory can show prompt anatomy.
 * - Registers `/trajectory` slash command: opens the browser to the
 *   current session's trajectory page. Requires the replay server to
 *   be running separately (`pnpm dev` or `pnpm start` from the repo).
 */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import type { BuildSystemPromptOptions, ExtensionAPI } from '@earendil-works/pi-coding-agent'

const ENTRY_TYPE = 'trajectory-prompt'
const PORT = Number(process.env.PI_TRAJECTORY_PORT ?? 8787)
const HOST = '127.0.0.1'
const BASE = `http://${HOST}:${PORT}`

interface PromptSection {
  readonly id: string
  readonly label: string
  readonly content: string
  readonly length: number
}

interface PromptSnapshot {
  readonly prompt: string
  readonly sections: readonly PromptSection[]
  readonly tools: readonly {
    readonly name: string
    readonly description?: string
    readonly promptGuidelines?: readonly string[]
  }[]
  readonly promptHash: string
  readonly previousPromptHash?: string
}

let lastHash: string | undefined

export default function trajectoryExtension(pi: ExtensionAPI): void {
  //
  // Prompt logging
  //
  pi.on('before_agent_start', (event) => {
    const promptHash = hash(event.systemPrompt)
    if (promptHash === lastHash) return

    pi.appendEntry<PromptSnapshot>(ENTRY_TYPE, {
      prompt: event.systemPrompt,
      sections: promptSections(event.systemPromptOptions),
      tools: (event.systemPromptOptions.selectedTools ?? []).map((name) => ({
        name,
        ...(event.systemPromptOptions.toolSnippets?.[name] !== undefined
          ? { description: event.systemPromptOptions.toolSnippets[name] }
          : {}),
        ...(event.systemPromptOptions.promptGuidelines !== undefined
          ? { promptGuidelines: event.systemPromptOptions.promptGuidelines }
          : {}),
      })),
      promptHash,
      ...(lastHash !== undefined ? { previousPromptHash: lastHash } : {}),
    })
    lastHash = promptHash
  })

  //
  // Slash command: /trajectory [session-id]
  //
  pi.registerCommand('trajectory', {
    description: 'Open this session (or a given session id) in the Trajectory browser inspector',
    handler: async (args, ctx) => {
      const sessionId = (args.trim() || ctx.sessionManager.getSessionId()).trim()
      if (sessionId.length === 0) {
        ctx.ui.notify('No active session to inspect', 'error')
        return
      }

      ctx.ui.setStatus('trajectory', 'Checking Trajectory server…')
      try {
        if (!(await isHealthy())) {
          ctx.ui.notify(
            `Trajectory server not running on ${BASE}. Start it from the repo: pnpm dev`,
            'error',
          )
          return
        }
        const url = `${BASE}/s/${encodeURIComponent(sessionId)}`
        openBrowser(url)
        ctx.ui.notify(`Trajectory opened: ${url}`, 'info')
      } catch (error) {
        ctx.ui.notify(`Trajectory failed: ${error instanceof Error ? error.message : 'unknown error'}`, 'error')
      } finally {
        ctx.ui.setStatus('trajectory', undefined)
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Server health check
// ---------------------------------------------------------------------------

function isHealthy(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(`${BASE}/api/health`, { method: 'GET', timeout: 1500 }, (res) => {
      resolve(res.statusCode === 200)
      res.resume()
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Browser launch
// ---------------------------------------------------------------------------

function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
      : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', url] : [url]
  spawn(command, args, { stdio: 'ignore' }).unref()
}

// ---------------------------------------------------------------------------
// Prompt-section helpers
// ---------------------------------------------------------------------------

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function promptSections(options: BuildSystemPromptOptions): PromptSection[] {
  const sections = [
    section('custom-prompt', 'Custom prompt', options.customPrompt),
    section('guidelines', 'Prompt guidelines', options.promptGuidelines?.join('\n')),
    section('append', 'Appended prompt', options.appendSystemPrompt),
    section('skills', 'Loaded skills', options.skills?.map((skill) => skill.name).join('\n')),
    section('context-files', 'Context files', options.contextFiles?.map((file) => file.path).join('\n')),
  ]
  return sections.filter((section): section is PromptSection => section !== undefined)
}

function section(id: string, label: string, content: string | undefined): PromptSection | undefined {
  if (content === undefined || content.length === 0) return undefined
  return { id, label, content, length: Buffer.byteLength(content) }
}
