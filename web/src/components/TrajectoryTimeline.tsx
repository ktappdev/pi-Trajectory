import { useRef } from 'react'
import type { TimelineLane, TimelineRecord } from '../lib/timeline.ts'
import { systemRecordLabel } from '../lib/record.ts'

interface TrajectoryTimelineProps {
  readonly timeline: readonly TimelineRecord[]
  readonly selection: readonly [number, number] | null
  onSelectionChange(selection: readonly [number, number] | null): void
  onRecordSelect(recordId: string): void
}

const lanes: readonly TimelineLane[] = ['input', 'model', 'tool']

export function TrajectoryTimeline({ timeline, selection, onSelectionChange, onRecordSelect }: TrajectoryTimelineProps): React.JSX.Element {
  const start = useRef<number | null>(null)
  const setPosition = (event: React.PointerEvent<HTMLDivElement>): number => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
  }
  return (
    <section className="trajectory-timeline" aria-label="Trajectory overview">
      <div className="timeline-heading"><span>OVERVIEW</span><span>Drag to focus · right click to clear</span></div>
      <div className="timeline-body">
        <div className="timeline-labels">{lanes.map((lane) => <span key={lane}>{lane}</span>)}</div>
        <div className="timeline-track" onContextMenu={(event) => { event.preventDefault(); onSelectionChange(null) }} onPointerDown={(event) => { start.current = setPosition(event); event.currentTarget.setPointerCapture(event.pointerId); onSelectionChange([start.current, start.current]) }} onPointerMove={(event) => { if (start.current !== null) onSelectionChange([start.current, setPosition(event)]) }} onPointerUp={() => { start.current = null }}>
          {lanes.map((lane) => <div className="timeline-lane" key={lane} />)}
          {timeline.map((item) => <button key={item.record.recordId} type="button" className={`timeline-mark mark-${item.lane}`} style={{ left: `${item.start * 100}%`, width: `${Math.max((item.end - item.start) * 100, 0.7)}%`, top: `${lanes.indexOf(item.lane) * 33.333 + 8}%` }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRecordSelect(item.record.recordId) }} aria-label={`Inspect ${item.record.kind === 'system' ? systemRecordLabel(item.record) : item.record.summary}`} />)}
          {selection !== null ? <div className="timeline-selection" style={{ left: `${Math.min(...selection) * 100}%`, width: `${Math.abs(selection[1] - selection[0]) * 100}%` }} /> : null}
        </div>
      </div>
    </section>
  )
}
