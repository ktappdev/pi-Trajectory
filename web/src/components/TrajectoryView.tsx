import { useEffect, useMemo, useState } from 'react'
import { useTrajectoryStore } from '../store.ts'
import { visibleRecords } from '../lib/layout.ts'
import { TrajectorySearchIndex } from '../lib/search-index.ts'
import { deriveTrajectoryTimeline, focusedRecordIds } from '../lib/timeline.ts'
import { Inspector } from './Inspector.tsx'
import { TrajectoryTable } from './TrajectoryTable.tsx'
import { TrajectoryTimeline } from './TrajectoryTimeline.tsx'
import { TrajectoryToolbar } from './TrajectoryToolbar.tsx'

export function TrajectoryView(): React.JSX.Element {
  const snapshot = useTrajectoryStore((state) => state.snapshot)
  const selectedRecordId = useTrajectoryStore((state) => state.selectedRecordId)
  const collapsedTurns = useTrajectoryStore((state) => state.collapsedTurns)
  const collapsedAssistants = useTrajectoryStore((state) => state.collapsedAssistants)
  const query = useTrajectoryStore((state) => state.searchQuery)
  const setQuery = useTrajectoryStore((state) => state.setSearchQuery)
  const selectRecord = useTrajectoryStore((state) => state.selectRecord)
  const setCollapsedTurns = useTrajectoryStore((state) => state.setCollapsedTurns)
  const toggleAssistant = useTrajectoryStore((state) => state.toggleAssistant)
  const setCollapsedAssistants = useTrajectoryStore((state) => state.setCollapsedAssistants)
  const [range, setRange] = useState<readonly [number, number] | null>(null)
  const searchIndex = useMemo(() => new TrajectorySearchIndex(), [])

  useEffect(() => { if (snapshot !== null) searchIndex.update(snapshot.records) }, [searchIndex, snapshot])
  if (snapshot === null) return <></>

  const timeline = deriveTrajectoryTimeline(snapshot.records)
  const searchMatches = searchIndex.search(query)
  const timelineMatches = focusedRecordIds(timeline, range)
  const records = visibleRecords(snapshot.records, collapsedTurns, collapsedAssistants)
    .filter((record) => (searchMatches === null || searchMatches.has(record.recordId)) && (timelineMatches === null || timelineMatches.has(record.recordId)))
  const turns = new Set(snapshot.records.flatMap((record) => record.turn === null ? [] : [record.turn]))
  const requests = new Set(snapshot.records.flatMap((record) => record.requestNumber === undefined ? [] : [record.requestNumber]))
  const allTurnsCollapsed = turns.size > 0 && [...turns].every((turn) => collapsedTurns.has(turn))
  const allCallsCollapsed = requests.size > 0 && [...requests].every((request) => collapsedAssistants.has(`request:${request}`))
  const selected = snapshot.records.find((record) => record.recordId === selectedRecordId) ?? null

  return <div className="trajectory-view">
    {snapshot.error !== undefined ? <div className="projection-error"><b>Replay warning</b><span>{snapshot.error.message}</span></div> : null}
    <TrajectoryToolbar
      query={query}
      turnCount={turns.size}
      requestCount={requests.size}
      allTurnsCollapsed={allTurnsCollapsed}
      allCallsCollapsed={allCallsCollapsed}
      hasTimelineFilter={range !== null}
      onQueryChange={setQuery}
      onToggleTurns={() => setCollapsedTurns(allTurnsCollapsed ? new Set() : turns)}
      onToggleCalls={() => setCollapsedAssistants(allCallsCollapsed ? new Set() : new Set([...requests].map((request) => `request:${request}`)))}
      onClearTimelineFilter={() => setRange(null)}
    />
    <TrajectoryTimeline timeline={timeline} selection={range} onSelectionChange={setRange} onRecordSelect={selectRecord} />
    <div className="trajectory-workspace">
      <TrajectoryTable records={records} selectedRecordId={selectedRecordId} focusedRecordIds={timelineMatches} collapsedAssistants={collapsedAssistants} onSelect={selectRecord} onToggleAssistant={(request) => toggleAssistant(`request:${request}`)} />
      <Inspector record={selected} />
    </div>
  </div>
}
