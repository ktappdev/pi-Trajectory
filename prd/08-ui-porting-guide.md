# UI Porting Guide — DSH Trajectory → pi-Trajectory

This is a direct port of the DSH Trajectory UI (`packages/client/ui-trajectory/src/client/`) to a standalone Vite + React + Tailwind app. The DSH UI is React + CSS Modules + `@tanstack/react-virtual`; we port to React + Tailwind, keeping the structure, props, and interaction model intact.

**Why port rather than rebuild:** the DSH UI encodes ~20 non-obvious decisions (virtualizer anchoring, zero-height separator grouping, tail-follow semantics, TTFT/decode span split, inclusive drag-focus, transparent-until-hover scrollbars). Rebuilding from scratch re-litigates all of them. Porting preserves them.

## Source files to port (DSH → pi-Trajectory)

| DSH file | Port to | Role |
|---|---|---|
| `trajectory-record.ts` | `web/src/lib/record.ts` | `TrajectoryCellProps`, `trajectoryRecordId`, duration formatters |
| `layout.ts` | `web/src/lib/layout.ts` | `deriveTrajectoryLayout`: turns → groups → cells |
| `timeline.ts` | `web/src/lib/timeline.ts` | 3-lane Overview projection, `deriveTrajectoryTimeline`, focus filter |
| `trajectory-virtual-rows.ts` | `web/src/lib/virtual-rows.ts` | `groupTrajectoryVirtualRows`, row keys |
| `trajectory-search-index.ts` | `web/src/lib/search-index.ts` | `TrajectorySearchIndex` class |
| `TrajectoryView.tsx` | `web/src/components/TrajectoryView.tsx` | top-level view, state, selection |
| `TrajectoryTable.tsx` (114KB) | `web/src/components/TrajectoryTable.tsx` | the ledger + inspector (split if sensible) |
| `TrajectoryTimeline.tsx` | `web/src/components/TrajectoryTimeline.tsx` | the Overview |
| `TrajectoryToolbar.tsx` | `web/src/components/TrajectoryToolbar.tsx` | fold/search/duration controls |
| `TrajectoryCell.tsx` | `web/src/components/TrajectoryCell.tsx` | one record row |
| `TrajectoryGroupHeader.tsx` | `web/src/components/TrajectoryGroupHeader.tsx` | step/request group header |
| `TrajectoryTurn.tsx` | `web/src/components/TrajectoryTurn.tsx` | turn section |
| `TrajectoryTurnHeader.tsx` | `web/src/components/TrajectoryTurnHeader.tsx` | turn boundary row |
| `*.module.css` (7 files) | `web/src/**/*.css` → Tailwind utilities + a small CSS layer for virtualizer spacers | styling |

## What does NOT port (DSH-specific)

- **`conversation.view` slot registration, `inject`, `ctx.slots.register`** — DSH plugin glue. pi-Trajectory is a standalone app; `TrajectoryView` becomes a top-level route component, not a slot entry.
- **`ConversationNodeAssembler`, `ConversationViewBuilder`, target Definitions** — DSH's shared assembler. pi-Trajectory builds the snapshot server-side (see `04-architecture.md`); the web client just consumes `TrajectorySnapshot`.
- **`ctx.locale`, `TranslateNS`, locale dictionaries** — DSH i18n. v1 ships English-only; add i18n later if needed.
- **`data-conversation-composer-overlay`, composer height reservation** — DSH conversation shell. pi-Trajectory has no composer in v1 (read-only). Drop the `--dsh-composer-height` clearance; the ledger owns full height.
- **`SnapshotStore<boolean>` duration store, `useDuration`** — DSH runtime store. Replace with a plain React state hook (`useState`/Zustand) for the actual-duration toggle.

## The data contract the UI consumes

The UI is a pure function of a `TrajectorySnapshot` (pi-native version — see `03-data-model.md`). The port keeps this boundary: **the web client never parses pi JSONL or subscribes to pi events directly.** It receives `TrajectorySnapshot` over HTTP (replay) or WebSocket (live) and renders it.

This is the single most important porting invariant. It is what lets replay and live modes share one UI.

## Component contracts (from DSH source)

### `TrajectoryView` — top-level view

Props (from `TrajectoryView.tsx:120`):
```typescript
interface TrajectoryViewProps {
  useSession: <T>(selector: (snapshot: TrajectorySnapshot) => T) => T
  useDuration: (selector: (value: boolean) => boolean) => boolean
  loadOlder: () => Promise<boolean>
  setActualDuration: (actual: boolean) => void
  inspect: ...        // DSH inspect plumbing — replace with local selection state
  onInspectDone: ...
  t: TranslateNS<...> // DSH locale — replace with plain strings or a t() stub
}
```

State owned here:
- `collapsedTurns: ReadonlySet<number>`
- `collapsedAssistants: ReadonlySet<string>`
- `timelineSelection: TrajectoryTimeRange | null`
- `actualDuration: boolean`, `actualTime: boolean`
- `searchQuery: string`, `searchIndex: TrajectorySearchIndex`, `searchIndexRevision: number`
- `selectedTimelineIndex`, `timelineRecordSelection`, `timelineRecordFocus`
- `inspectCallId` (cross-view inspect — v1: local only)

**Port change:** replace `useSession`/`useDuration` (DSH runtime stores) with a Zustand store or React Query + WebSocket subscription that yields `TrajectorySnapshot`. The selection/fold/search state stays in the component as-is.

### `TrajectoryTable` — the ledger + inspector

Props (from `TrajectoryTable.tsx:347`):
```typescript
interface TrajectoryTableProps {
  requestNumbers?: readonly TrajectoryRequestNumber[]
  turns: readonly TrajectoryTurnModel[]
  streamingCells?: readonly TrajectoryCellProps[]
  timelineFocusIndexes?: ReadonlySet<number> | null
  searchMatchIndexes?: ReadonlySet<number> | null
  onSelectedIndexChange?: (index: number | null) => void
  onRecordSelect?: (index: number) => void
  recordSelection?: { readonly index: number } | null
  recordFocus?: { readonly index: number } | null
  historyLoading?: boolean
  olderHistoryLoading?: boolean
  historyStartSeq?: number | undefined
  hasOlderRecords?: boolean
  onLoadOlder?: () => Promise<boolean>
  onClearSelection?: () => void
  collapsedTurns: ReadonlySet<number>
  onToggleTurn: (turn: number) => void
  collapsedAssistants: ReadonlySet<string>
  onToggleAssistant: (id: string) => void
  inspectCallId?: string | null
  onInspectApplied?: (() => void) | undefined
}
```

Virtualizer setup (from `TrajectoryTable.tsx:1786`):
```typescript
const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
  count: virtualizationEnabled ? virtualRowStructure.length : 0,
  enabled: virtualizationEnabled,
  estimateSize: estimateVirtualRowSize,
  getItemKey: getVirtualRowKey,
  getScrollElement: getTableScrollElement,
  initialRect: { width: 0, height: VIRTUAL_INITIAL_VIEWPORT_HEIGHT_PX },
  anchorTo: 'end',                          // tail-first
  overscan: VIRTUAL_OVERSCAN_ROWS,          // 12
  scrollMargin: virtualScrollMargin,
  scrollEndThreshold: BOTTOM_FOLLOW_THRESHOLD_PX,  // 2px
})
```

Constants (`TrajectoryTable.tsx`):
- `VIRTUAL_OVERSCAN_ROWS = 12`
- `VIRTUAL_INITIAL_VIEWPORT_HEIGHT_PX = 600`
- `BOTTOM_FOLLOW_THRESHOLD_PX = 2`
- `DETAILS_MIN_WIDTH = 320`, `DETAILS_MAX_WIDTH = 720`, `TABLE_MIN_WIDTH = 280`
- `DETAILS_RESIZE_STEP = 16` (keyboard resize)
- `TOOL_REQUEST_SHARE = 0.58` (inspector split)

**Keep `@tanstack/react-virtual`** as a dependency. It is the one DSH dep worth carrying over verbatim — the virtualizer anchoring and `getItemKey` semantics are load-bearing.

### Inspector tabs (from `TrajectoryTable.tsx:155`)

```typescript
type DetailTab =
  | 'system-prompt' | 'tools'      // SYSTEM records
  | 'overview' | 'rendered' | 'raw' | 'source'  // messages
  | 'input' | 'output' | 'schema' | 'diff'      // tools
  | 'options' | 'usage' | 'timing'              // requests
```

Tab sets:
```typescript
const SYSTEM_PROMPT_TABS = [{ id: 'system-prompt', label: 'System Prompt' }, { id: 'tools', label: 'Tools' }]
const SYSTEM_UPDATE_TABS = [{ id: 'diff', label: 'Diff' }, ...SYSTEM_PROMPT_TABS]
const REQUEST_TABS = [
  { id: 'overview', label: 'Summary' },
  { id: 'options', label: 'Options' },
  { id: 'usage', label: 'Usage' },
  { id: 'timing', label: 'Timing' },
]
```

`detailTabs(record)` selects the tab set by record kind. Tab history is a `Set<DetailTab>` ref so re-opening an entity restores the most-recent tab. The tablist is `role="tablist"` with `aria-selected`, panels are `role="tabpanel"`.

**Port note:** pi has no per-request system-prompt-diff event (see `07-open-gaps-and-questions.md`). The `diff` tab for SYSTEM updates may be empty/N-A in v1. Keep the tab slot; populate when the gap is closed.

### `TrajectoryTimeline` — the Overview

Props (from `TrajectoryTimeline.tsx:131`):
```typescript
interface TrajectoryTimelineProps {
  turns: readonly TrajectoryTurnModel[]
  mode: TrajectoryTimelineMode          // 'sequence' | 'duration' | 'time' | 'actual'
  range: TrajectoryTimeRange | null
  hasEarlierRecords?: boolean
  onLoadEarlier?: () => Promise<boolean>
  selectedIndex?: number | null
  searchMatchIndexes?: ReadonlySet<number> | null
  onRangeChange: (range: TrajectoryTimeRange | null) => void
  onRecordSelect?: (index: number) => void
  onRecordFocus?: (index: number) => void
}
```

Three lanes (from `LaneLabels`):
- **Input** (lane 0): user, system, context
- **Model** (lane 1): assistant messages, compacted
- **Tools** (lane 2): tool, subtool

`laneFor(kind)` in `timeline.ts:51`:
```typescript
function laneFor(kind: TrajectoryCellKind): number {
  if (kind === 'tool' || kind === 'subtool') return 2
  if (kind === 'message' || kind === 'compacted') return 1
  return 0
}
```

Interaction (from the inspection-ledger note, confirmed in source):
- **500ms hover** → tooltip with exact start/end, total, TTFT, decoding (constant `TIMELINE_TOOLTIP_DELAY_MS`)
- **Drag** → inclusive interval filter via `trajectoryTimelineFocusIndexes`
- **Wheel** → zoom time domain
- **Right-click** → clear selection; **right-drag** → pan zoomed viewport
- **EarlierHistoryBoundary** control (the `…` ellipsis) loads one older page; suppresses cursor on hover

### `TrajectoryToolbar`

Controls (from `TrajectoryToolbar.tsx`):
- "Use actual duration" toggle (`actualDuration` / `onActualDurationChange`) — clock icon, `aria-pressed`
- "Actual time" switch (`actualTime` / `onActualTimeChange`) — currently `hidden` in DSH (a `hidden` attribute on the button); port as hidden too unless we expose it
- "Collapse/Expand turns" (`allTurnsCollapsed` / `onToggleAllTurns`) — ⊞/⊟ icon
- "Collapse/Expand calls" (`allAssistantsCollapsed` / `onToggleAllAssistants`)
- Search input (`searchQuery` / `onSearchQueryChange`) — `type="search"`, search icon

## Record + layout model (port verbatim)

### `TrajectoryCellKind` (from `trajectory-record.ts:9`)
```typescript
type TrajectoryCellKind =
  | 'system' | 'user' | 'context' | 'compacted'
  | 'message' | 'tool' | 'subtool'
```

### `TrajectoryCellProps` (from `trajectory-record.ts`)

The full record shape. Key fields:
- `index` (1-based), `recordId?`, `kind`, `text` (summary), `previewMarkdown?`
- `opensTurn?`, `sourceSeq?`, `messageSource?`, `requestOnly?`
- `inputDetail?`, `promptDetail?`, `previousPromptDetail?`, `outputDetail?`, `thinkingDetail?`
- `sourceBlocks?`, `outputBlocks?`, `schemaDetail?`
- `assistantMetrics?: AssistantMetricDetail` (TTFT/decode facts)
- `result?`, `resultPreviewMarkdown?`, `callId?`, `isError?`
- `timeSeconds: number | null`, `startedAt?: number | null`
- `input?`, `cacheRead?`, `cacheWrite?`, `output?`, `think?` (token counts)
- `selected?`

### `trajectoryRecordId` (from `trajectory-record.ts`)
Stable identity surviving prepends:
```typescript
function trajectoryRecordId(cell: TrajectoryCellProps): string {
  if (cell.recordId !== undefined) return cell.recordId
  if (cell.callId !== undefined) return `${cell.kind}\u0000call\u0000${cell.callId}`
  if (cell.sourceSeq !== undefined) return `${cell.kind}\u0000seq\u0000${cell.sourceSeq}`
  return `${cell.kind}\u0000index\u0000${cell.index}`
}
```
**Port this exactly.** The `\u0000` separator and the priority (recordId → callId → sourceSeq → index) are what make prepend anchoring work.

### `AssistantMetricDetail` (from `trajectory-record.ts:17`)
```typescript
interface AssistantMetricDetail {
  timingRecorded: boolean
  stepStartTime: number | null
  firstTokenTime: number | null
  completedTime: number | null
  usageProvided: boolean
  outputTokens: number | null
}
```
This is what drives the TTFT/decode span split. `firstTokenTime - stepStartTime` = TTFT; `completedTime - firstTokenTime` = decoding.

### Layout model (`layout.ts`)
```typescript
interface TrajectoryGroupModel { title: string; description?: string; cells: readonly TrajectoryCellProps[] }
interface TrajectoryTurnModel { turn: number | null; groups: readonly TrajectoryGroupModel[] }
interface TrajectoryLayoutInput {
  nodes: ConversationSnapshot['nodes']     // → replace with pi TrajectorySnapshot.eventNodes
  eventLocations?: ...
  partial: ...
  runningCalls: ...
  requests?: readonly RequestView[]
  callSchemas?: ...
}
function deriveTrajectoryLayout(input: TrajectoryLayoutInput): readonly TrajectoryTurnModel[]
function appendTrajectoryPartialLayout(...): ...
```

**Port change:** `TrajectoryLayoutInput` references DSH's `ConversationSnapshot`. Retype it against pi's `TrajectorySnapshot` (see `03-data-model.md`). The fold logic (expand assistant blocks, attach usage to Message, own-duration times, in-flight partial/runningCalls, group descriptions) ports as-is — only the input type changes.

## Virtual rows (port verbatim)

From `trajectory-virtual-rows.ts`:
```typescript
const CONTENT_ROW_HEIGHT = 30
const COLLAPSED_SUMMARY_HEIGHT = 20
const TERMINAL_BOUNDARY_HEIGHT = 9

function trajectoryVirtualRecordKey(record): string {
  const identity = encodeURIComponent(trajectoryRecordId(record.cell))
  return record.collapsedSummaryKind === undefined
    ? identity
    : `${identity}\u0000summary\u0000${record.collapsedSummaryKind}`
}

function groupTrajectoryVirtualRows<T>(records: readonly T[]): readonly TrajectoryVirtualRow<T>[]
```

The grouping rule: request-only (`requestOnly === true`) records attach to the **next** content row so the virtualizer never owns a zero-height item. A terminal run of separators keeps its own `TERMINAL_BOUNDARY_HEIGHT`. **Port this exactly** — it is the fix for a real virtualizer bug.

## Search index (port verbatim)

From `trajectory-search-index.ts:76` — `TrajectorySearchIndex`:
- `update(layouts: readonly (readonly TrajectoryTurnModel[])[]): boolean` — incremental sync; reuses entries whose `sources` haven't changed; only normalizes Markdown for changed records
- `search(query: string): ReadonlySet<string> | null` — space-separated case-insensitive AND over `recordSources + markdownPreview + resultPreview`

The 3-second throttle lives in the **consumer** (`TrajectoryView`), not the index — `SEARCH_INDEX_THROTTLE_MS = 3_000` in `TrajectoryView.tsx`. Port both.

**Why keep display memoization and search separate** (DSH decision): display is immediate + viewport-bound; search covers all loaded records and batches. A shared cache couples correctness and scheduling. Keep them separate.

## Diff dependency

DSH uses `diff` (`structuredPatch` from `diff@9`) for the SYSTEM-update `diff` tab and possibly edit-tool result diffs. **Keep `diff` as a dependency** if porting those tabs. If the `diff` tab is dropped in v1 (pi has no system-prompt-diff event), `diff` can be deferred.

## CSS / theme strategy

DSH uses CSS Modules + DSH design-system tokens (`--dsw-alias-*`, `--ds-*`). pi-Trajectory uses **Tailwind**. Port approach:

1. **Layout-critical CSS** (virtualizer spacers, scroll geometry, the `--trajectory-virtual-spacer-height` and `--request-boundary-offset` custom properties) → a small `index.css` with `@layer` for the bits Tailwind utilities can't express (custom property bridges, scrollbar thumb transparency).
2. **Visual styling** (colors, spacing, borders, role hues) → Tailwind utilities + a small theme token set in `tailwind.config` mirroring the DSH token roles:
   - `--dsw-alias-label-primary/secondary/tertiary` → `text-{primary,secondary,tertiary}`
   - `--dsw-alias-bg-layer-1` → `bg-base`
   - `--dsw-alias-state-business-primary` → selection/focus blue
   - `--dsw-alias-state-error-primary` → error red
   - `--dsw-alias-state-success-primary` → success green (used sparingly — not for role color)
   - `--ds-font-family-code` → `font-mono` for machine data (turn ids, token counts, payloads)
   - `--dsw-font-family` → `font-sans` for prose
3. **Scrollbar thumbs transparent until hover/focus-within** — port this behavior; it's a real DSH decision. CSS: `scrollbar-color: transparent transparent; &:hover, &:focus-within { scrollbar-color: <thumb> <track> }`.
4. **Light + dark** — DSH tokens are paired. Define Tailwind tokens for both; use `prefers-color-scheme` or a manual toggle.

DSH CSS file sizes (for scope sense):
- `TrajectoryTable.module.css` — 34KB, 277 classes (the bulk)
- `TrajectoryTimeline.module.css` — 6.5KB
- `TrajectoryCell.module.css` — 2.9KB
- `TrajectoryToolbar.module.css` — 4.1KB
- Others small

**Don't translate 277 classes by hand.** Port the structure, write Tailwind for the ~20 classes that carry real layout/interaction, and let the rest be utility-classed inline. The 277 count includes state variants and one-off helpers.

## Snapshot → UI data flow (port)

```
TrajectorySnapshot (from server)
  ↓ deriveTrajectoryLayout(snapshot)        ← layout.ts, retyped for pi snapshot
TrajectoryTurnModel[] (turns → groups → cells)
  ↓ flattenRecords + filterRecords           ← TrajectoryTable.tsx
TableRecord[]
  ↓ groupTrajectoryVirtualRows               ← virtual-rows.ts
TrajectoryVirtualRow[] (measurable rows)
  ↓ useVirtualizer                           ← @tanstack/react-virtual
renderedRecords (viewport window + overscan)
  ↓ <TrajectoryCell> per record
DOM
```

Selection, fold, search, and timeline-focus all address records by **stable id** (`trajectoryRecordId`) or **index**, not DOM position — so they survive virtualization and prepends.

## What to simplify in v1 (with explicit deferral)

These DSH features can be stubbed or simplified for v1 replay, then grown back:

| DSH feature | v1 simplification | Restore when |
|---|---|---|
| Live streaming + tail-follow | Replay is static; no streaming | Live mode (v2) |
| Tail-first backward paging | Load full session (pi JSONL is small) | Sessions get huge |
| `partial` / `runningCalls` in-flight rows | None in replay | Live mode (v2) |
| Cross-view `inspectCallId` | Local selection only | Multiple panes exist |
| `actualTime` toggle (hidden in DSH anyway) | Keep hidden | Timing modes stabilize |
| SYSTEM `diff` tab | Empty state ("no prompt diff logged") | pi logs prompt changes |
| Per-request tool `schema` tab | Show current tool catalog | pi logs per-call schemas |

**Mark each simplification with a `TODO(v1)` comment** in the ported code so the restore points are grep-able.

## Accessibility to preserve

From DSH (confirmed in snapshot `navigation-panes/trajectory.expected.md`):
- `role="toolbar"` on the toolbar with `aria-label`
- `role="tablist"` / `role="tab"` / `role="tabpanel"` on the inspector
- `aria-pressed` on toggle buttons
- `aria-checked` on the switch
- `aria-label` on search input
- ARIA indexes on rows (identity independent of mount position)
- Keyboard: Esc clears timeline selection; keyboard resize for inspector split (`DETAILS_RESIZE_STEP`)

Port all of these. The snapshot test (`apps/web/tests/snapshots/navigation-panes/trajectory.expected.md`) is the accessibility contract — use it as a checklist.

## Suggested component split for the 114KB table

`TrajectoryTable.tsx` is 3074 lines. For maintainability, split on port:

```
TrajectoryTable.tsx        ← the virtualized ledger + selection/focus orchestration
Inspector.tsx              ← the right-hand details panel (tabs, panels, resize)
inspector-tabs/            ← one file per tab: Summary, Payload, Result, Schema, Timing, Usage, Options, SystemPrompt, Diff
record-utils.ts            ← flattenRecords, filterRecords, indexRequestBoundaryRuns, stateOf
```

This is a refactor, not a behavior change. Keep behavior identical; just give the inspector its own file and tab components.
