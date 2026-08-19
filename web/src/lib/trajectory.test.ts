import { describe, expect, it } from 'vitest'
import type { TrajectoryRecord } from '@pi-trajectory/shared'
import { deriveTrajectoryLayout, visibleRecords } from './layout.ts'
import { TrajectorySearchIndex } from './search-index.ts'
import { deriveTrajectoryTimeline, focusedRecordIds } from './timeline.ts'
import { groupTrajectoryVirtualRows } from './virtual-rows.ts'

function record(overrides: Partial<TrajectoryRecord>): TrajectoryRecord {
  return {
    index: 1,
    recordId: 'record:1',
    kind: 'message',
    timestamp: 1,
    summary: 'assistant output',
    turn: 1,
    step: 1,
    timeSeconds: null,
    ...overrides,
  }
}

describe('trajectory library', () => {
  const records = [
    record({ recordId: 'user', kind: 'user', turn: 1, step: 0, summary: 'Find failed tool' }),
    record({ recordId: 'message', turn: 1, step: 1, requestNumber: 1 }),
    record({ recordId: 'tool', kind: 'tool', turn: 1, step: 1, requestNumber: 1, toolName: 'bash', summary: 'bash failed', isError: true }),
    record({ recordId: 'next', kind: 'user', turn: 2, step: 0, summary: 'Try again' }),
  ]

  it('groups, collapses, and virtualizes trace records', () => {
    expect(deriveTrajectoryLayout(records).map((turn) => turn.records.length)).toEqual([3, 1])
    expect(visibleRecords(records, new Set([1]), new Set())).toEqual([records[0], records[3]])
    expect(visibleRecords(records, new Set(), new Set(['request:1']))).toEqual([records[0], records[1], records[3]])
    expect(groupTrajectoryVirtualRows(records).map((row) => row.type)).toEqual(['turn', 'record', 'record', 'record', 'turn', 'record'])
  })

  it('filters sequence timeline inclusively and searches full record text', () => {
    const timeline = deriveTrajectoryTimeline(records)
    expect(focusedRecordIds(timeline, [timeline[1]!.start, timeline[2]!.end])).toEqual(new Set(['message', 'tool']))
    const search = new TrajectorySearchIndex()
    search.update(records)
    expect(search.search('BASH')).toEqual(new Set(['tool']))
  })
})

describe('system record labels and JSON formatting', () => {
  it('labels prompt/tool changes', async () => {
    const { systemRecordLabel, prettyJson } = await import('./record.ts')
    const previous = { prompt: 'old', tools: [{ name: 'a' }] }
    expect(systemRecordLabel(record({ kind: 'system', promptAnatomy: { prompt: 'new', tools: [{ name: 'b' }] }, previousPromptAnatomy: previous }))).toBe('System Prompt and Tools Updated')
    expect(systemRecordLabel(record({ kind: 'system', promptAnatomy: { prompt: 'new', tools: previous.tools }, previousPromptAnatomy: previous }))).toBe('System Prompt Updated')
    expect(systemRecordLabel(record({ kind: 'system', promptAnatomy: previous, previousPromptAnatomy: { prompt: 'old', tools: [{ name: 'b' }] } }))).toBe('Tools Updated')
    expect(systemRecordLabel(record({ kind: 'system' }))).toBe('Initial System Prompt')
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(prettyJson('nope')).toBe('nope')
    expect(prettyJson(undefined)).toBeUndefined()
  })
})
