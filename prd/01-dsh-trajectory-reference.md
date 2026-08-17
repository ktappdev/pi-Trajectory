# DSH Trajectory Reference — the inspiration

This documents the Trajectory feature in DeepSeek Harness (`packages/client/ui-trajectory/`) so the pi-Trajectory build can reuse its proven design decisions and skip its dead ends. It is a reference, not a spec to copy verbatim — pi's data model differs.

## What it is

`@deepseek-ai/dsh-client-ui-trajectory` is a **pure-consumer browser plugin**. It renders a turn-aware event ledger with an interactive timing overview. It registers one tab in a conversation view slot plus target-specific Event Definitions and a view builder. It defines **no service** and declares **no Context merge**.

Key file: `packages/client/ui-trajectory/src/client/index.ts` — the plugin body registers locale dict, 5 Definitions, a view builder, and one slot entry.

## Core UX (from the inspection-ledger agent note)

### The ledger

- Compact, turn-aware event ledger. Materialized business records in session-event order within the loaded window.
- **Two stable columns:** event kind + content. Token usage and duration stay in the inspector, not the ledger, so content gets the full width.
- **Turn boundaries:** a slightly heavier rule, the raw Turn id, and a continuous left rail.
- **Request boundaries:** small points integrated into the structure; one chronological numbering space across ordinary and compaction requests.
- **Role tags** align toward the content. Nested subtools get small indentation. CSS truncation preserves preview width.
- **Typography:** product prose uses the sans stack; turn ids, token counts, durations, tool calls, raw payloads use the code stack.
- **Theme:** existing tokens own light + dark. Neutral borders/surfaces form structure; distinct low-emphasis role hues support scanning without carrying success/failure meaning; business blue identifies selection, links, focus.

### The inspector (local, per-record)

- Selecting a record or Request opens an inspector **inside Trajectory**, independent from any conversation-wide details column.
- Tabs and Summary sections follow the selected entity:
  - **Markdown messages:** rendered content, source fields, provider/model fields, hierarchy views.
  - **Tools:** JSON payload, result, schema views.
  - **Requests:** options, usage, timing, result navigation.
- Scrollable Summary regions keep scrollbar thumbs transparent until hover or `focus-within`, while retaining the scrollbar reservation and scroll behavior.
- Images render as media, not serialized data.
- At narrow widths the inspector overlays the ledger and is dismissible by keyboard or pointer.

### The Overview (timing)

- A **fixed** overview above the ledger projects every loaded record with known `startedAt` onto three semantic timing lanes using its own duration.
- Assistant spans divide the recorded interval at the first non-empty token delta → distinct **TTFT** and **decoding** colors retain their actual ratio. Incomplete timing falls back to one Assistant color.
- **Hover 500ms** exposes exact start/end, total duration, TTFT, decoding time (not relying on browser tooltip delay).
- **Drag left/right** commits an inclusive interval filter: any record whose active interval overlaps either boundary stays visible; records without known timing leave the focused ledger; clearing selection restores the full loaded ledger.
- **Wheel** zooms the time domain.
- **Right-click** clears the interval selection; **right-drag** pans an already-zoomed viewport without mutating it.
- While an older prefix remains unloaded and the viewport includes the loaded domain's start, a neutral ellipsis control covers the truncated edge and loads one earlier page **without assigning unknown history a fabricated duration**. Hovering that control suppresses the ordinary timeline cursor.
- The Overview keeps the full time domain while focused so the selection can be resized or cleared without losing orientation.

### Folding

- **Turn folding** removes all rows after its first record, replacing them with a compact step/tool-call count.
- **Assistant folding** applies the same interaction to its tool-call descendants.
- Global controls fold or expand both levels.

### Virtualization + paging

- Long ledger opens at the **current tail** and mounts only the viewport's row window plus bounded overscan.
- **Tail-first paging:** load one older page when the user reaches the loaded range's top.
- Request-only separators join the next measurable virtual item; a terminal separator retains its own fixed clearance — the virtualizer never owns a zero-height item.
- **Semantic DOM-safe row keys** and ARIA indexes expose identity independently from mount position. Stable-key virtualizer anchoring preserves the visible item across prepends and appends.
- A tail with known older history virtualizes immediately even when its loaded projection is below the ordinary row threshold.
- An explicit loading row covers records until initial positioning finishes.
- While an older prefix remains unloaded, an interactive first row precedes the loaded records, requests one older page, and becomes a disabled loading status for a pending page; it disappears only when paging completes.

### Streaming + tail-following

- Live history updates retain the ledger's bottom position only while the user is already following its tail. Scrolling upward clears follow state → streamed chunks and new records don't interrupt inspection of earlier rows.
- Tail following and virtualizer measurement react to row keys and heights, not content identity → text-only stream frames neither discard the measurement cache nor repeat a DOM scroll write.
- Token streaming updates only the matching Assistant Context; publication coalesced to at most once per animation frame.

### Composer overlay (DSH-specific, may not apply to pi)

DSH Trajectory asks the conversation shell to float the composer over the full-height ledger. This is a DSH conversation-shell concept; pi-Trajectory is a standalone browser app, so this specific mechanism does not transfer. The lesson: keep the ledger full-height and don't let chrome steal row space.

## Architecture decisions worth keeping

1. **Pure-consumer, no service.** The view reads a target snapshot; it does not own mutable cross-plugin state. pi-Trajectory's web view should likewise be a pure function of a snapshot.

2. **Two views, one session window.** DSH's Chat and Trajectory register separate business Definitions against a shared assembler; Trajectory reads its own target snapshot, never Chat's. pi-Trajectory's analog: the web view is fed a `TrajectorySnapshot`; replay and live modes are just two snapshot sources producing the same shape.

3. **Stage-oriented snapshot, not raw events.** The builder converts materialized nodes into `eventNodes`, `requests`, `callSchemas`, `partial`, `runningCalls`. The view never touches raw events. pi-Trajectory should define a `TrajectorySnapshot` and have the server build it; the web client consumes only the snapshot.

4. **Complexity bounds are explicit.** The DSH note states the builder still does work proportional to materialized contributions on publication, and does not claim end-to-end O(1). pi-Trajectory should likewise state its complexity honestly (see `04-architecture.md`).

5. **Display memoization vs search indexing stay separate.** Display is immediate and viewport-bound; search covers the complete loaded record set and intentionally batches updates. A shared cache would couple correctness and scheduling across unrelated consumers.

6. **In-flight time stays blank.** `partial` and `runningCalls` rows show running state without a fabricated duration; the Overview renders a start marker rather than inventing a live span. Keep this — don't fabricate timing.

## DSH TrajectorySnapshot shape (the model to adapt)

From `packages/client/ui-trajectory/src/client/trajectory-contract.ts`:

```typescript
interface TrajectorySnapshot {
  eventNodes: readonly ConversationNode[]        // finalized records in seq order
  eventLocations: ReadonlyMap<number, ConversationLocation>
  requests: readonly RequestView[]               // assistant + compaction, one numbering space
  callSchemas: ReadonlyMap<string, ToolSchema>   // callId → schema
  partial: PartialAssistant | null               // in-flight assistant
  runningCalls: readonly RunningToolCall[]       // in-flight tools
}
```

pi-Trajectory's snapshot will be a pi-native version of this — see `03-data-model.md`.

## DSH Known Limitations (carry forward)

From the package README:
- **In-flight Time stays blank** — `partial`/`runningCalls` show running state without fabricated duration; Overview renders a start marker not a live span.
- **Record and timeline selection are local to Trajectory**, with no anchor deep links.

Both apply to pi-Trajectory too. Deep-linking to a specific record is a reasonable v2 feature.

## DSH Alternatives that were rejected (don't re-litigate)

- **One card per Turn/Step** — rejected: repeated card chrome reduced visible records.
- **Mount every projected record** — rejected: DOM scales with full session, not viewport.
- **Exhaust every history page on mount** — rejected: transporting old chunk-heavy pages delays the tail. On-demand backward paging.
- **Rebuild ledger for every streamed token** — rejected: keep finalized projections stable; structural events are the full-rebuild boundary.
- **Flatten everything without Turn/Request boundaries** — rejected: a trajectory is not a log stream; boundaries preserve causal structure.
- **Keep timing in a separate Waterfall tab** — rejected: forced users to switch away from the rows they wanted. A full-domain Overview keeps timing + filtered records in one context.

## DSH file inventory (for cross-reference if porting logic)

```
packages/client/ui-trajectory/src/client/
  index.ts                              plugin body (registers slot + definitions)
  trajectory-contract.ts                TrajectorySnapshot, TrajectoryContribution union
  trajectory-snapshot-builder.ts        keyed adapter: replace/apply → snapshot
  trajectory-record.ts                  TrajectoryCellProps, record id, duration formatters
  layout.ts                             deriveTrajectoryLayout: turns → groups → cells
  timeline.ts                           3-lane Overview projection, focus filter
  trajectory-virtual-rows.ts            pure projection to measurable rows
  trajectory-search-index.ts            throttled search over stable record ids
  TrajectoryView.tsx                    top-level view, state, selection
  TrajectoryTable.tsx (114KB)           the ledger table + inspector
  TrajectoryTimeline.tsx                the Overview
  TrajectoryToolbar.tsx                 fold/search/duration controls
  TrajectoryCell.tsx, TrajectoryGroupHeader.tsx, TrajectoryTurn.tsx, TrajectoryTurnHeader.tsx
```

The 114KB `TrajectoryTable.tsx` is the bulk of the surface. For pi-Trajectory, start simpler — a flat-ish table with turn/request separators — and grow toward DSH's density only if needed.
