import { Icon } from './Icon.tsx'

interface TrajectoryToolbarProps {
  readonly query: string
  readonly turnCount: number
  readonly requestCount: number
  readonly allTurnsCollapsed: boolean
  readonly allCallsCollapsed: boolean
  readonly hasTimelineFilter: boolean
  onQueryChange(query: string): void
  onToggleTurns(): void
  onToggleCalls(): void
  onClearTimelineFilter(): void
}

export function TrajectoryToolbar(props: TrajectoryToolbarProps): React.JSX.Element {
  return (
    <div className="trajectory-toolbar" role="toolbar" aria-label="Trajectory controls">
      <label className="trajectory-search">
        <Icon name="search" />
        <span className="sr-only">Search trajectory</span>
        <input type="search" value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="Filter trace" />
      </label>
      <div className="toolbar-actions">
        <button type="button" onClick={props.onToggleTurns} aria-pressed={props.allTurnsCollapsed} title="Collapse or expand turns"><Icon name={props.allTurnsCollapsed ? 'unfold' : 'fold'} /> <span>{props.allTurnsCollapsed ? 'Expand' : 'Fold'} turns</span><b>{props.turnCount}</b></button>
        <button type="button" onClick={props.onToggleCalls} aria-pressed={props.allCallsCollapsed} title="Collapse or expand tool calls"><Icon name={props.allCallsCollapsed ? 'unfold' : 'fold'} /> <span>{props.allCallsCollapsed ? 'Expand' : 'Fold'} calls</span><b>{props.requestCount}</b></button>
        {props.hasTimelineFilter ? <button type="button" className="toolbar-clear" onClick={props.onClearTimelineFilter}><Icon name="close" /> Clear focus</button> : null}
      </div>
    </div>
  )
}
