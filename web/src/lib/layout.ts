import type { TrajectoryRecord } from '@pi-trajectory/shared'

export interface TrajectoryTurn {
  readonly number: number | null
  readonly records: readonly TrajectoryRecord[]
}

export function deriveTrajectoryLayout(records: readonly TrajectoryRecord[]): readonly TrajectoryTurn[] {
  const turns: TrajectoryTurn[] = []
  for (const record of records) {
    const current = turns.at(-1)
    if (current?.number === record.turn) {
      turns[turns.length - 1] = { ...current, records: [...current.records, record] }
    } else {
      turns.push({ number: record.turn, records: [record] })
    }
  }
  return turns
}

export function visibleRecords(
  records: readonly TrajectoryRecord[],
  collapsedTurns: ReadonlySet<number>,
  collapsedAssistants: ReadonlySet<string>,
): readonly TrajectoryRecord[] {
  return records.filter((record) => {
    if (record.turn !== null && collapsedTurns.has(record.turn) && record.kind !== 'user') return false
    return record.kind !== 'tool' || record.requestNumber === undefined || !collapsedAssistants.has(`request:${record.requestNumber}`)
  })
}
