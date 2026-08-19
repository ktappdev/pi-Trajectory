import { structuredPatch } from 'diff'
import { useEffect, useState } from 'react'
import type { TrajectoryPromptAnatomy, TrajectoryToolSchema, TrajectoryRecord } from '@pi-trajectory/shared'
import { formatCost, formatTimestamp, formatTokens, kindLabel, prettyJson } from '../lib/record.ts'

interface InspectorProps { readonly record: TrajectoryRecord | null }
type DetailTab = 'summary' | 'input' | 'output' | 'schema' | 'prompt' | 'tools' | 'diff' | 'usage' | 'timing' | 'raw'

export function Inspector({ record }: InspectorProps): React.JSX.Element {
  const tabs = record === null ? [] : tabsFor(record)
  const [tab, setTab] = useState<DetailTab>('summary')
  useEffect(() => setTab(tabs[0] ?? 'summary'), [record?.recordId])
  if (record === null) return <aside className="inspector inspector-empty"><p>Select trace record</p><span>Payload, output, timing, and usage appear here.</span></aside>
  return <aside className="inspector" aria-label="Record inspector"><header className="inspector-header"><span className="kind-chip">{kindLabel(record.kind)}</span><h2>{record.toolName ?? record.summary}</h2></header><div className="inspector-tabs" role="tablist" aria-label="Inspector tabs">{tabs.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>{labelFor(item)}</button>)}</div><div className="inspector-panel" role="tabpanel">{contentFor(record, tab)}</div></aside>
}
function tabsFor(record: TrajectoryRecord): readonly DetailTab[] { if (record.kind === 'system') return record.previousPromptAnatomy === undefined ? ['prompt', 'tools', 'raw'] : ['diff', 'prompt', 'tools', 'raw']; if (record.kind === 'tool') return ['summary', 'input', 'output', 'schema', 'raw']; if (record.kind === 'message' || record.kind === 'error') return ['summary', 'output', 'usage', 'timing', 'raw']; return ['summary', 'raw'] }
function labelFor(tab: DetailTab): string { return { summary: 'Summary', input: 'Input', output: 'Output', schema: 'Schema', prompt: 'System prompt', tools: 'Tools', diff: 'Diff', usage: 'Usage', timing: 'Timing', raw: 'Raw' }[tab] }
function contentFor(record: TrajectoryRecord, tab: DetailTab): React.JSX.Element {
  if (tab === 'summary') return <div className="inspector-copy"><p>{record.summary}</p><dl><dt>Recorded</dt><dd>{formatTimestamp(record.completedAt ?? record.timestamp)}</dd><dt>Turn / step</dt><dd>{record.turn ?? '—'} / {record.step}</dd>{record.stopReason !== undefined ? <><dt>Stop reason</dt><dd>{record.stopReason}</dd></> : null}</dl></div>
  if (tab === 'input') return <Code value={record.inputDetail} empty="No input payload recorded." />
  if (tab === 'output') return <Code value={record.outputDetail ?? record.result} empty="No output payload recorded." />
  if (tab === 'schema') return <Code value={record.schemaDetail} empty="Schema unavailable for this tool." />
  if (tab === 'prompt') return <PromptSections anatomy={record.promptAnatomy} />
  if (tab === 'tools') return <ToolCatalog tools={record.promptAnatomy?.tools} />
  if (tab === 'diff') return <SystemPromptDiff current={record.promptAnatomy} previous={record.previousPromptAnatomy} />
  if (tab === 'usage') return <div className="inspector-copy"><dl><dt>Input</dt><dd>{formatTokens(record.usage?.input)}</dd><dt>Output</dt><dd>{formatTokens(record.usage?.output)}</dd><dt>Total</dt><dd>{formatTokens(record.usage?.totalTokens)}</dd><dt>Cost</dt><dd>{formatCost(record.usage?.cost?.total)}</dd></dl></div>
  if (tab === 'timing') return <div className="inspector-copy"><dl><dt>Started</dt><dd>{formatTimestamp(record.startedAt)}</dd><dt>Completed</dt><dd>{formatTimestamp(record.completedAt)}</dd><dt>Duration</dt><dd>{record.timeSeconds === null ? 'Not recorded in replay' : `${record.timeSeconds?.toFixed(2)}s`}</dd></dl></div>
  return <Code value={JSON.stringify(record, null, 2)} empty="" />
}
function Code({ value, empty }: { readonly value: string | undefined; readonly empty: string }): React.JSX.Element { return value === undefined || value.length === 0 ? <p className="inspector-empty-copy">{empty}</p> : <pre>{value}</pre> }
function PromptSections({ anatomy }: { readonly anatomy?: TrajectoryPromptAnatomy }): React.JSX.Element {
  if (anatomy === undefined) return <p>No system prompt logged. Install trajectory-prompt-log for future sessions.</p>
  const hasSections = Boolean(anatomy.sections?.length)
  return <div>{anatomy.promptHash ? <span className="hash-badge" title={anatomy.promptHash}>{anatomy.promptHash.slice(0, 12)}</span> : null}{anatomy.sections?.map((section, i) => <details className="system-section" key={section.id} open={i === 0}><summary>{section.label} ({section.length} bytes)</summary><Code value={section.content} empty="" /></details>)}<details className="system-section" open={!hasSections}><summary>Assembled prompt</summary><Code value={anatomy.prompt} empty="" /></details></div>
}
function ToolCatalog({ tools }: { readonly tools?: readonly TrajectoryToolSchema[] }): React.JSX.Element {
  if (!tools?.length) return <p>No tool catalog logged.</p>
  return <div>{tools.map((tool) => <details className="tool-card" key={tool.name}><summary>{tool.name}{tool.label ? ` — ${tool.label}` : ''}{tool.description ? `: ${tool.description}` : ''}</summary>{tool.parameters !== undefined ? <Code value={prettyJson(tool.parameters)} empty="" /> : null}{tool.promptGuidelines?.length ? <ul>{tool.promptGuidelines.map((g) => <li key={g}>{g}</li>)}</ul> : null}{tool.promptSnippet ? <Code value={tool.promptSnippet} empty="" /> : null}</details>)}</div>
}
function diffGrid(a: string, b: string): React.JSX.Element { const patch = structuredPatch('system', 'system', a, b, undefined, undefined, { context: 3 }); if (!patch.hunks.length) return <p>No changes.</p>; return <div className="diff-grid">{patch.hunks.map((hunk) => <div key={`${hunk.oldStart}-${hunk.newStart}`}><div className="diff-row meta">@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</div>{hunk.lines.map((line, i) => <div className={`diff-row ${line[0] === '+' ? 'added' : line[0] === '-' ? 'removed' : 'context'}`} key={`${i}-${line}`}>{line}</div>)}</div>)}</div> }
function SystemPromptDiff({ current, previous }: { readonly current?: TrajectoryPromptAnatomy; readonly previous?: TrajectoryPromptAnatomy }): React.JSX.Element { if (!previous) return <Code value={current?.prompt} empty="No previous prompt recorded." />; return <div><h3>System Prompt</h3>{diffGrid(previous.prompt ?? '', current?.prompt ?? '')}<h3>Tools</h3>{diffGrid(JSON.stringify(previous.tools ?? [], null, 2), JSON.stringify(current?.tools ?? [], null, 2))}</div> }
