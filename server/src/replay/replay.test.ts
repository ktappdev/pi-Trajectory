import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildReplaySnapshot } from './buildReplaySnapshot.ts'
import { isInside } from './listSessions.ts'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('replay safety', () => {
  it('returns an error snapshot for corrupt session JSONL', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pi-trajectory-'))
    directories.push(directory)
    const file = join(directory, 'corrupt.jsonl')
    writeFileSync(file, '{not valid json}\n')

    const snapshot = buildReplaySnapshot(file)

    expect(snapshot.records).toEqual([])
    expect(snapshot.error?.stage).toBe('parse')
  })

  it('accepts only descendants of the session directory', () => {
    expect(isInside('/sessions', '/sessions/project/session.jsonl')).toBe(true)
    expect(isInside('/sessions', '/sessions')).toBe(false)
    expect(isInside('/sessions', '/sessions-other/session.jsonl')).toBe(false)
    expect(isInside('/sessions', '/sessions/../secret.jsonl')).toBe(false)
  })
})
