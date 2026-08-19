import type { TrajectoryRecord } from '@pi-trajectory/shared'

export type VirtualRow =
  | { readonly type: 'turn'; readonly key: string; readonly turn: number }
  | { readonly type: 'record'; readonly key: string; readonly record: TrajectoryRecord }

export function groupTrajectoryVirtualRows(records: readonly TrajectoryRecord[]): readonly VirtualRow[] {
  const rows: VirtualRow[] = []
  let previousTurn: number | null | undefined
  for (const record of records) {
    if (record.turn !== null && record.turn !== previousTurn) rows.push({ type: 'turn', key: `turn:${record.turn}`, turn: record.turn })
    rows.push({ type: 'record', key: `record:${record.recordId}`, record })
    previousTurn = record.turn
  }
  return rows
}

export function estimateVirtualRowSize(row: VirtualRow): number {
  return row.type === 'turn' ? 34 : 58
}
