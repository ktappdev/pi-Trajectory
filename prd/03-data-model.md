# Data Model — pi-native TrajectorySnapshot

The single contract between the server (replay or live) and the web UI. Both modes produce the same `TrajectorySnapshot`; the UI consumes only this. Adapted from DSH's `TrajectorySnapshot` (`packages/client/ui-trajectory/src/client/trajectory-contract.ts`), retyped for pi's `AgentMessage` / `SessionEntry`.

**Design rule:** the web client never imports pi types or parses JSONL. It imports only `TrajectorySnapshot` and the record/layout/timeline types in `web/src/lib/`. The server depends on pi; the web client does not.

## 1. The snapshot

```typescript
/** One pi session projected into a Trajectory view model. */
export interface TrajectorySnapshot {
  /** Session identity + metadata. */
  readonly header: TrajectorySessionHeader
  /** Finalized records in chronological order (active branch, compaction-aware). */
  readonly records: readonly TrajectoryRecord[]
  /** One chronological request numbering space (assistant + compaction). */
  readonly requests: readonly TrajectoryRequest[]
  /** Active model + thinking level as of the last entry on the branch. */
  readonly model: TrajectoryModelState
  /** Pending steering messages (live mode; empty in replay). */
  readonly steering: readonly string[]
  /** Pending follow-up messages (live mode; empty in replay). */
  readonly followUp: readonly string[]
  /** In-flight assistant partial (live mode; null in replay). */
  readonly partial: TrajectoryPartialAssistant | null
  /** In-flight tool calls (live mode; empty in replay). */
  readonly runningTools: readonly TrajectoryRunningTool[]
  /** Whether an older prefix exists beyond the loaded window (paging; false in v1 replay). */
  readonly hasOlderRecords: boolean
  /** Cumulative token usage across all requests on the loaded branch. */
  readonly cumulativeUsage: TrajectoryUsage
}

export interface TrajectorySessionHeader {
  readonly sessionId: string          // header.id (uuid)
  readonly sessionFile: string        // absolute path
  readonly cwd: string
  readonly name?: string              // from latest session_info entry
  readonly parentSessionPath?: string
  readonly createdAt: number          // ms
  readonly leafEntryId: string | null
  /** All known branches as tree nodes (for a future tree view; v1 may flatten). */
  readonly tree?: TrajectoryTreeNode
}

export interface TrajectoryModelState {
  readonly provider: string
  readonly modelId: string
  readonly thinkingLevel: string      // off|minimal|low|medium|high|xhigh|max
}

export interface TrajectoryUsage {
  readonly input?: number
  readonly output?: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
  readonly totalTokens?: number
  readonly cost?: {
    readonly input: number
    readonly output: number
    readonly cacheRead: number
    readonly cacheWrite: number
    readonly total: number
  }
}

export interface TrajectoryTreeNode {
  readonly entryId: string
  readonly label?: string
  readonly children: readonly TrajectoryTreeNode[]
}
```

## 2. The record — `TrajectoryRecord`

This is the pi-native equivalent of DSH's `TrajectoryCellProps` (`trajectory-record.ts`). One independently displayable row in the ledger. The server builds these; the UI renders them.

```typescript
export type TrajectoryRecordKind =
  | 'system'      // (v1: not emitted — pi has no per-request system-prompt event; reserved)
  | 'user'
  | 'context'     // custom_message with display, or context-injected
  | 'compacted'   // compaction summary as a chronological record
  | 'message'     // assistant message
  | 'tool'        // tool call + its result, paired by toolCallId
  | 'subtool'     // (v1: not emitted unless a tool nests; reserved)
  | 'steering'    // queued steering/follow-up message (from queue_update / custom_message reminder)
  | 'model-change'
  | 'thinking-change'
  | 'bash'        // user ! / !! bash execution
  | 'branch-summary'
  | 'error'       // assistant stopReason error, surfaced inline

export interface TrajectoryRecord {
  /** 1-based index in the loaded window, stable across prepends. */
  readonly index: number
  /** Stable identity surviving prepends (see id rule below). */
  readonly recordId: string
  readonly kind: TrajectoryRecordKind
  /** Source session entry id (8-char hex), when the record owns one. */
  readonly entryId?: string
  /** Source message timestamp (Unix ms) for ordering + timing. */
  readonly timestamp: number
  /** Single-line summary for the ledger cell. */
  readonly summary: string
  /** Raw Markdown source for the summary (rendered to single line by the UI). */
  readonly previewMarkdown?: string
  /** Whether this user/context record opens a new turn. */
  readonly opensTurn?: boolean
  /** Turn number this record belongs to (1-based; null for between-turns compaction). */
  readonly turn: number | null
  /** Step number within the turn (1-based; 0 for compaction/between-turns). */
  readonly step: number
  /** Request number (from the global requests array) this record belongs to, if any. */
  readonly requestNumber?: number

  // --- content for the inspector ---
  readonly inputDetail?: string
  readonly outputDetail?: string
  readonly thinkingDetail?: string
  readonly sourceBlocks?: readonly TrajectorySourceBlock[]
  readonly outputBlocks?: readonly TrajectorySourceBlock[]
  readonly schemaDetail?: string        // tool schema (v1: current catalog; gap doc)
  readonly promptDetail?: string        // (v1: not populated; reserved for system-prompt gap)

  // --- tool-specific ---
  readonly callId?: string
  readonly toolName?: string
  readonly result?: string
  readonly resultPreviewMarkdown?: string
  readonly isError?: boolean

  // --- assistant metrics (TTFT / decode) ---
  readonly assistantMetrics?: TrajectoryAssistantMetrics

  // --- usage (assistant messages + compactions carry usage) ---
  readonly usage?: TrajectoryUsage
  readonly cumulativeUsage?: TrajectoryUsage

  // --- timing ---
  /** Own duration in seconds, or null when unknown. */
  readonly timeSeconds: number | null
  /** Unix epoch ms when the operation started, when known. */
  readonly startedAt?: number | null
  /** Unix epoch ms when the operation completed, when known. */
  readonly completedAt?: number | null

  // --- provider/model provenance (assistant) ---
  readonly provider?: string
  readonly model?: string
  readonly api?: string
  readonly stopReason?: string

  // --- model/thinking change specifics ---
  readonly previousProvider?: string
  readonly previousModelId?: string
  readonly previousThinkingLevel?: string
}

export interface TrajectorySourceBlock {
  readonly type: string              // 'text' | 'thinking' | 'image' | 'toolCall'
  readonly content: string
  readonly imageSrc?: string         // data: URL for images
  readonly imageAlt?: string
  readonly callId?: string
  readonly toolName?: string
}

export interface TrajectoryAssistantMetrics {
  readonly timingRecorded: boolean
  readonly stepStartTime: number | null
  readonly firstTokenTime: number | null
  readonly completedTime: number | null
  readonly usageProvided: boolean
  readonly outputTokens: number | null
}
```

### Record id rule (port from DSH `trajectoryRecordId`)

Stable across prepends. Priority:
1. `recordId` if explicitly set
2. `kind\0call\0{callId}` if `callId` present
3. `kind\0entry\0{entryId}` if `entryId` present
4. `kind\0index\0{index}` fallback

`\0` = the U+0000 separator. **Port this exactly** — it is what makes virtualizer prepend anchoring work.

## 3. The request — `TrajectoryRequest`

One chronological numbering space across ordinary assistant requests and compactions (mirrors DSH).

```typescript
export type TrajectoryRequestKind = 'assistant' | 'compaction'

export interface TrajectoryRequest {
  readonly number: number             // 1-based, global across kinds
  readonly kind: TrajectoryRequestKind
  readonly turn: number | null        // null for between-turns compaction
  readonly step: number               // 0 for compaction
  readonly entryId?: string           // anchor entry (assistant message entry or compaction entry)
  readonly status: 'complete' | 'running' | 'error'
  readonly startedAt?: number
  readonly completedAt?: number | null
  readonly error?: string
  readonly provider?: string
  readonly model?: string
  readonly requestConfig?: { /* thinking level, temperature, etc. — populate from message/entry */ }
  readonly usage?: TrajectoryUsage
  readonly cumulativeUsage?: TrajectoryUsage
  // compaction-only:
  readonly tokensBefore?: number
  readonly summary?: string
  // assistant-only retry:
  readonly retry?: number
  readonly maxRetries?: number
  readonly retryDelayMs?: number
}
```

## 4. In-flight (live mode only)

```typescript
export interface TrajectoryPartialAssistant {
  readonly turn: number
  readonly step: number
  /** Assembled blocks from message_start + deltas (UI renders these live). */
  readonly blocks: readonly TrajectorySourceBlock[]
  readonly startedAt: number
  /** firstTokenTime once a text/thinking delta arrives; null until then. */
  readonly firstTokenTime: number | null
}

export interface TrajectoryRunningTool {
  readonly callId: string
  readonly toolName: string
  readonly args: unknown
  readonly startedAt: number
  /** Latest partialResult content (replace-on-update, per pi semantics). */
  readonly partialPreview?: string
}
```

In replay mode, `partial` is `null` and `runningTools` is `[]`. The UI shows no in-flight rows.

## 5. Mapping: pi entries/messages → records

The server walks the active branch (`buildContextEntries`) in chronological order and emits records. Turn/step numbering is derived from the assistant message sequence (each assistant message that follows a user/toolResult starts a new step; a user message that follows an assistant/toolResult starts a new turn).

### Turn/step derivation **[design]**

pi does not persist explicit turn/step numbers on messages (unlike DSH). Derive them:
- **Turn N** starts at the first user message (or the session start) and runs until the next user message that is *not* a steering/queued continuation.
- **Step S** within a turn increments on each assistant message (one LLM response = one step). Tool results do not start new steps; they belong to the step whose assistant message issued the call.
- Compaction between turns gets `turn = null`, `step = 0`.
- `auto_retry` does not start a new step; it retries the same step (track via `auto_retry_*` events in live mode; in replay, retries are not separately visible — the final assistant message is what's stored).

State the derivation rule in the server code comments. This is the main place pi-Trajectory invents structure pi doesn't persist.

### Entry/message → record table

| pi source | Record kind | Notes |
|---|---|---|
| `UserMessage` (first in turn) | `user` | `opensTurn = true` |
| `UserMessage` (continuation) | `user` | same turn |
| `CustomMessage` (`display: true`) | `context` | extension-injected, visible |
| `CustomMessage` (`display: false`) | (skip) | hidden, do not render |
| `CustomMessageEntry` (`display: true`) | `context` | same as above, from entry |
| `AssistantMessage` | `message` | one record per assistant message; carries usage, metrics, provider/model |
| `AssistantMessage` with `stopReason: "error"` | `message` + `error` flag | `isError`-like; surface error inline + in inspector |
| `ToolCall` block inside assistant content | `tool` | paired with the matching `ToolResultMessage` by `toolCallId` |
| `ToolResultMessage` | (merged into the `tool` record) | result text, `isError`, `details`, nested `usage` |
| `CompactionEntry` | `compacted` + a `TrajectoryRequest{kind:'compaction'}` | `tokensBefore`, `summary`, `usage` |
| `CompactionSummaryMessage` | `compacted` | in-context projection (rare in replay; entry is the source) |
| `BranchSummaryEntry` / `BranchSummaryMessage` | `branch-summary` | `fromId`, `summary` |
| `BashExecutionMessage` | `bash` | `command`, `output`, `exitCode`, `cancelled`, `truncated` |
| `ModelChangeEntry` | `model-change` | `previousProvider/previousModelId` from the prior state |
| `ThinkingLevelChangeEntry` | `thinking-change` | `previousThinkingLevel` from prior state |
| `LabelEntry` | (no record) | applied to the labeled entry's record as `label` metadata |
| `SessionInfoEntry` | (no record) | feeds `header.name` |
| `CustomEntry` (non-message) | (no record by default) | extension state; **[design]** optionally render known `customType`s (e.g. `web-search-results`) as `context` records in v2 |

### Tool call ↔ result pairing

An assistant message may contain multiple `ToolCall` blocks. Each has a `toolCallId`. The subsequent `ToolResultMessage`(s) carry matching `toolCallId`. Pair them:
- For each `ToolCall` in an assistant message → one `tool` record with `callId`, `toolName`, args as `inputDetail`, args summary as `summary`.
- Find the `ToolResultMessage` with the same `toolCallId` → merge `content` into `outputDetail`/`result`, `isError`, `details`, nested `usage`.
- If no result yet (live mode) → the record stays in `runningTools`; promote to a finalized `tool` record on `tool_execution_end`.

### Assistant metrics (TTFT / decode)

**Replay:** `AssistantMessage.timestamp` gives `completedTime`. `stepStartTime` and `firstTokenTime` are **not in the JSONL** — pi doesn't persist per-delta timing. So in replay:
- `timingRecorded = false`
- `completedTime = message.timestamp`
- `stepStartTime = null`, `firstTokenTime = null`
- `timeSeconds = null` (no start time to diff against) — **or** approximate from the preceding entry's timestamp. **[design]** v1: leave `timeSeconds = null` (honest, matches DSH's "in-flight time stays blank" ethos). v2: approximate `startedAt` from the prior record's `completedAt`.

**Live:** capture from events:
- `message_start` arrival → `stepStartTime`
- first `text_delta`/`thinking_delta` → `firstTokenTime`
- `message_end` → `completedTime`
- `timeSeconds = (completedTime - stepStartTime) / 1000`

This is the one place replay is genuinely poorer than live. The Overview in replay will show completion markers but not real durations unless we approximate. Document this honestly.

## 6. What the snapshot does NOT include (gaps)

1. **Per-request system prompt + diff.** pi builds the system prompt per call but does not log it as an event stream. v1: no `system` records, no `promptDetail`, no `diff` tab content. See `07-open-gaps-and-questions.md`.
2. **Per-call tool schemas.** pi's tool definitions are static (registered at startup). v1: `schemaDetail` shows the current tool's schema from the static catalog if the server can resolve it (the server imports pi and can call `pi.getAllTools()`-equivalent); otherwise empty.
3. **Per-delta timing in replay.** Above.
4. **Abandoned branches.** v1 shows the active branch only. `tree` is reserved on the header for v2.

## 7. JSON transport shape

Over HTTP (replay) and WebSocket (live), the snapshot is sent as JSON. `readonly` arrays become plain arrays; `Map`/`Set` become arrays/objects. Define a serialized sibling type if needed, but prefer keeping the snapshot JSON-serializable as-is (use arrays + plain objects, no `Map`/`Set`).

**[design]** Keep `records` as a flat array in chronological order. The UI's `deriveTrajectoryLayout` groups them into turns/groups — mirroring DSH. Do not pre-group on the server; the UI owns layout.

## 8. Why this shape (tracing back to DSH)

| pi-Trajectory field | DSH `TrajectorySnapshot` field | Reason |
|---|---|---|
| `records` | `eventNodes` | finalized records in order |
| `requests` | `requests` | one numbering space |
| `partial` | `partial` | in-flight assistant |
| `runningTools` | `runningCalls` | in-flight tools |
| `cumulativeUsage` | (derived in UI) | precompute on server, simpler for UI |
| `hasOlderRecords` | (DSH paging signal) | v1 always false; reserved |
| `header`, `model`, `steering`, `followUp` | (DSH had these via runtime) | pi-specific surfaces |

`callSchemas` (DSH) → folded into each `tool` record's `schemaDetail` (resolved server-side from the static catalog). `eventLocations` (DSH) → not needed; pi records carry `turn`/`step` directly.
