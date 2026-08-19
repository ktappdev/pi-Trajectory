import type { TrajectoryRecord } from '@pi-trajectory/shared'
import { recordTone } from './record.ts'

export type TimelineLane = 'input' | 'model' | 'tool'

export interface TimelineRecord {
  readonly record: TrajectoryRecord
  readonly lane: TimelineLane
  readonly start: number
  readonly end: number
}

export function deriveTrajectoryTimeline(records: readonly TrajectoryRecord[]): readonly TimelineRecord[] {
  const timed = records.some((record) => record.startedAt !== null && record.startedAt !== undefined && record.completedAt !== null && record.completedAt !== undefined)
  const firstTime = timed ? Math.min(...records.map((record) => record.startedAt ?? record.completedAt ?? 0).filter(Boolean)) : 0
  const lastTime = timed ? Math.max(...records.map((record) => record.completedAt ?? record.startedAt ?? 0)) : Math.max(records.length - 1, 1)
  const span = Math.max(lastTime - firstTime, 1)
  return records.map((record, index) => {
    const startTime = record.startedAt ?? record.completedAt ?? firstTime + index
    const endTime = record.completedAt ?? startTime
    return { record, lane: laneFor(record), start: timed ? (startTime - firstTime) / span : index / Math.max(records.length - 1, 1), end: timed ? (endTime - firstTime) / span : index / Math.max(records.length - 1, 1) }
  })
}

export function focusedRecordIds(timeline: readonly TimelineRecord[], range: readonly [number, number] | null): ReadonlySet<string> | null {
  if (range === null) return null
  const [start, end] = range[0] < range[1] ? range : [range[1], range[0]]
  return new Set(timeline.filter((item) => item.end >= start && item.start <= end).map((item) => item.record.recordId))
}

function laneFor(record: TrajectoryRecord): TimelineLane {
  const tone = recordTone(record)
  return tone === 'tool' ? 'tool' : tone === 'model' || tone === 'error' || record.kind === 'compacted' ? 'model' : 'input'
}
