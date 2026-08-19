import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { TrajectoryRecord } from '@pi-trajectory/shared'
import { kindLabel, recordTone, systemRecordLabel } from '../lib/record.ts'
import { estimateVirtualRowSize, groupTrajectoryVirtualRows } from '../lib/virtual-rows.ts'
import { Icon } from './Icon.tsx'

interface TrajectoryTableProps {
  readonly records: readonly TrajectoryRecord[]
  readonly selectedRecordId: string | null
  readonly focusedRecordIds: ReadonlySet<string> | null
  readonly collapsedAssistants: ReadonlySet<string>
  onSelect(recordId: string): void
  onToggleAssistant(requestNumber: number): void
}

export function TrajectoryTable(props: TrajectoryTableProps): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => groupTrajectoryVirtualRows(props.records), [props.records])
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: (index) => estimateVirtualRowSize(rows[index]!), getItemKey: (index) => rows[index]!.key, overscan: 12 })
  return <div className="trace-table" ref={parentRef} role="listbox" aria-label="Trajectory record ledger">
    <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const row = rows[virtualRow.index]!
        return <div key={row.key} ref={virtualizer.measureElement} data-index={virtualRow.index} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}>
          {row.type === 'turn' ? <div className="turn-divider">TURN {row.turn}</div> : <RecordRow record={row.record} selected={row.record.recordId === props.selectedRecordId} focused={props.focusedRecordIds === null || props.focusedRecordIds.has(row.record.recordId)} collapsed={row.record.requestNumber !== undefined && props.collapsedAssistants.has(`request:${row.record.requestNumber}`)} onSelect={props.onSelect} onToggleAssistant={props.onToggleAssistant} />}
        </div>
      })}
    </div>
  </div>
}

function RecordRow({ record, selected, focused, collapsed, onSelect, onToggleAssistant }: { readonly record: TrajectoryRecord; readonly selected: boolean; readonly focused: boolean; readonly collapsed: boolean; onSelect(recordId: string): void; onToggleAssistant(requestNumber: number): void }): React.JSX.Element {
  const canCollapse = record.kind === 'message' && record.requestNumber !== undefined
  return <div role="option" aria-selected={selected} className={`trace-row tone-${recordTone(record)}${selected ? ' is-selected' : ''}${focused ? '' : ' is-muted'}`} onClick={() => onSelect(record.recordId)}>
    <span className="trace-kind">{kindLabel(record.kind)}</span>
    <span className="trace-index">{record.turn ?? '—'}.{record.step}</span>
    <span className="trace-summary">{record.kind === 'system' ? systemRecordLabel(record) : record.summary}</span>
    <span className="trace-request">{record.requestNumber === undefined ? '' : `R${record.requestNumber}`}</span>
    {canCollapse ? <button className="row-fold" type="button" title="Fold or unfold tool calls" aria-label="Fold or unfold tool calls" aria-pressed={collapsed} onClick={(event) => { event.stopPropagation(); onToggleAssistant(record.requestNumber!) }}><Icon name={collapsed ? 'chevron' : 'fold'} size={14} /></button> : <span className="row-fold" />}
  </div>
}
