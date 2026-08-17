/**
 * Resolve a session-file path from a request `:id` against the real
 * sessions directory, rejecting anything outside it (path-traversal guard).
 *
 * `id` may be:
 *   - an absolute path under the sessions dir
 *   - a path relative to the sessions dir
 *   - a short id (first 8+ chars of the session uuid) — resolved via listAll
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, relative, isAbsolute } from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import type { SessionListItem } from '@pi-trajectory/shared'

const SESSIONS_DIR = resolve(homedir(), '.pi/agent/sessions')

/** True when `target` is inside `dir`. */
export function isInside(dir: string, target: string): boolean {
  const rel = relative(dir, target)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Resolve a request id to an absolute session file path, or `undefined`
 * when not found / outside the sessions directory.
 * @param id - Absolute path, relative path, or short uuid prefix.
 */
export async function resolveSessionPath(id: string): Promise<string | undefined> {
  // Absolute or relative path form
  const candidate = isAbsolute(id) ? resolve(id) : resolve(SESSIONS_DIR, id)
  if (isInside(SESSIONS_DIR, candidate) && existsSync(candidate)) return candidate

  // Short-id form: match against listAll by uuid prefix
  const sessions = await listSessions()
  const match = sessions.find((s) => s.id.startsWith(id) || s.path.endsWith(id))
  return match?.path
}

/** Sessions directory (resolved once). */
export function sessionsDir(): string {
  return SESSIONS_DIR
}

/**
 * List all pi sessions across all projects, newest first.
 * Wraps `SessionManager.listAll` and shapes each row for the picker.
 */
export async function listSessions(): Promise<SessionListItem[]> {
  const infos = await SessionManager.listAll()
  return infos
    .map((info) => ({
      path: info.path,
      id: info.id,
      cwd: info.cwd,
      ...(info.name !== undefined ? { name: info.name } : {}),
      ...(info.parentSessionPath !== undefined ? { parentSessionPath: info.parentSessionPath } : {}),
      createdAt: info.created.getTime(),
      modified: info.modified.getTime(),
      messageCount: info.messageCount,
      firstMessage: info.firstMessage,
    }))
    .sort((a, b) => b.modified - a.modified)
}
