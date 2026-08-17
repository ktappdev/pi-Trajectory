import { useEffect, useState } from 'react'
import type { TrajectoryRecord } from '@pi-trajectory/shared'
import { formatCost, formatTimestamp, formatTokens, kindLabel } from '../lib/record.ts'

interface InspectorProps { readonly record: TrajectoryRecord | null }
type DetailTab = 'summary' | 'input' | 'output' | 'schema' | 'prompt' | 'tools' | 'diff' | 'usage' | 'timing' | 'raw'

export function Inspector({ record }: InspectorProps): React.JSX.Element {
  const tabs = record === null ? [] : tabsFor(record)
  const [tab, setTab] = useState<DetailTab>('summary')
  useEffect(() => setTab(tabs[0] ?? 'summary'), [record?.recordId])
  if (record === null) return <aside className="inspector inspector-empty"><p>Select trace record</p><span>Payload, output, timing, and usage appear here.</span></aside>
  return <aside className="inspector" aria-label="Record inspector">
    <header className="inspector-header"><span className="kind-chip">{kindLabel(record.kind)}</span><h2>{record.toolName ?? record.summary}</h2></header>
    <div className="inspector-tabs" role="tablist" aria-label="Inspector tabs">
      {tabs.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>{labelFor(item)}</button>)}
    </div>
    <div className="inspector-panel" role="tabpanel">{contentFor(record, tab)}</div>
  </aside>
}

function tabsFor(record: TrajectoryRecord): readonly DetailTab[] {
  if (record.kind === 'system') return record.previousPromptAnatomy === undefined ? ['prompt', 'tools', 'raw'] : ['diff', 'prompt', 'tools', 'raw']
  if (record.kind === 'tool') return ['summary', 'input', 'output', 'schema', 'raw']
  if (record.kind === 'message' || record.kind === 'error') return ['summary', 'output', 'usage', 'timing', 'raw']
  return ['summary', 'raw']
}

function labelFor(tab: DetailTab): string {
  return { summary: 'Summary', input: 'Input', output: 'Output', schema: 'Schema', prompt: 'System prompt', tools: 'Tools', diff: 'Diff', usage: 'Usage', timing: 'Timing', raw: 'Raw' }[tab]
}

function contentFor(record: TrajectoryRecord, tab: DetailTab): React.JSX.Element {
  if (tab === 'summary') return <div className="inspector-copy"><p>{record.summary}</p><dl><dt>Recorded</dt><dd>{formatTimestamp(record.completedAt ?? record.timestamp)}</dd><dt>Turn / step</dt><dd>{record.turn ?? '—'} / {record.step}</dd>{record.stopReason !== undefined ? <><dt>Stop reason</dt><dd>{record.stopReason}</dd></> : null}</dl></div>
  if (tab === 'input') return <Code value={record.inputDetail} empty="No input payload recorded." />
  if (tab === 'output') return <Code value={record.outputDetail ?? record.result} empty="No output payload recorded." />
  if (tab === 'schema') return <Code value={record.schemaDetail} empty="Schema unavailable for this tool." />
  if (tab === 'prompt') return <Code value={record.promptAnatomy?.prompt} empty="No system prompt logged. Install trajectory-prompt-log for future sessions." />
  if (tab === 'tools') return <div className="inspector-copy">{record.promptAnatomy?.tools?.length ? <ul className="tool-catalog">{record.promptAnatomy.tools.map((tool) => <li key={tool.name}><b>{tool.name}</b>{tool.description !== undefined ? <span>{tool.description}</span> : null}</li>)}</ul> : <p>No tool catalog logged.</p>}</div>
  if (tab === 'diff') return <Code value={diffText(record.promptAnatomy?.prompt, record.previousPromptAnatomy?.prompt)} empty="No previous prompt recorded." />
  if (tab === 'usage') return <div className="inspector-copy"><dl><dt>Input</dt><dd>{formatTokens(record.usage?.input)}</dd><dt>Output</dt><dd>{formatTokens(record.usage?.output)}</dd><dt>Total</dt><dd>{formatTokens(record.usage?.totalTokens)}</dd><dt>Cost</dt><dd>{formatCost(record.usage?.cost?.total)}</dd></dl></div>
  if (tab === 'timing') return <div className="inspector-copy"><dl><dt>Started</dt><dd>{formatTimestamp(record.startedAt)}</dd><dt>Completed</dt><dd>{formatTimestamp(record.completedAt)}</dd><dt>Duration</dt><dd>{record.timeSeconds === null ? 'Not recorded in replay' : `${record.timeSeconds.toFixed(2)}s`}</dd></dl></div>
  return <Code value={JSON.stringify(record, null, 2)} empty="" />
}

function Code({ value, empty }: { readonly value: string | undefined; readonly empty: string }): React.JSX.Element { return value === undefined || value.length === 0 ? <p className="inspector-empty-copy">{empty}</p> : <pre>{value}</pre> }

function diffText(current: string | undefined, previous: string | undefined): string | undefined {
  if (current === undefined || previous === undefined) return undefined
  if (current === previous) return 'No changes.'
  return `Previous\n${previous}\n\nCurrent\n${current}`
}
