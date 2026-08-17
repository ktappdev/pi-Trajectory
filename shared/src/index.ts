/**
 * Shared types between the pi-Trajectory server and web client.
 *
 * The web client imports ONLY from this package — never from
 * `@earendil-works/pi-*`. The server builds these shapes from pi's
 * session JSONL and event stream; the web client renders them.
 *
 * See `prd/03-data-model.md` for the design rationale.
 */

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/** One pi session projected into a Trajectory view model. */
export interface TrajectorySnapshot {
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
  /** Non-fatal projection error, when the session loaded but could not be fully parsed. */
  readonly error?: TrajectoryProjectionError
}

export interface TrajectoryProjectionError {
  readonly message: string
  readonly stage: 'parse' | 'project'
}

export interface TrajectorySessionHeader {
  readonly sessionId: string
  readonly sessionFile: string
  readonly cwd: string
  readonly name?: string
  readonly parentSessionPath?: string
  readonly createdAt: number
  readonly leafEntryId: string | null
  /** Entry count on the active branch. */
  readonly entryCount: number
  /** All known branches as a tree (reserved for v2 tree view; v1 may omit). */
  readonly tree?: TrajectoryTreeNode
}

export interface TrajectoryModelState {
  readonly provider: string
  readonly modelId: string
  readonly thinkingLevel: string
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

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

export type TrajectoryRecordKind =
  | 'system' // logged by the trajectory-prompt-log extension
  | 'user'
  | 'context' // custom_message with display, or context-injected
  | 'compacted' // compaction summary as a chronological record
  | 'message' // assistant message
  | 'tool' // tool call + its result, paired by toolCallId
  | 'subtool' // reserved for nested tools
  | 'steering' // queued steering/follow-up reminder
  | 'model-change'
  | 'thinking-change'
  | 'bash' // user ! / !! bash execution
  | 'branch-summary'
  | 'error' // assistant stopReason error, surfaced inline

export interface TrajectoryRecord {
  /** 1-based index in the loaded window, stable across prepends. */
  readonly index: number
  /** Stable identity surviving prepends (see trajectoryRecordId). */
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
  readonly schemaDetail?: string
  /** Full system-prompt anatomy (system records only, from the extension). */
  readonly promptAnatomy?: TrajectoryPromptAnatomy
  /** Previous system-prompt anatomy, for the Diff tab (system records only). */
  readonly previousPromptAnatomy?: TrajectoryPromptAnatomy

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
  readonly timeSeconds: number | null
  readonly startedAt?: number | null
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
  readonly type: string
  readonly content: string
  readonly imageSrc?: string
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

/**
 * Anatomy of a system prompt, logged by the trajectory-prompt-log
 * extension at each `before_agent_start`. Each section is collapsible
 * in the inspector's System Prompt tab.
 */
export interface TrajectoryPromptAnatomy {
  /** Full assembled system prompt string. */
  readonly prompt: string
  /** Structured sections that compose the prompt, when available. */
  readonly sections?: TrajectoryPromptSection[]
  /** Tool catalog active for this request, when logged. */
  readonly tools?: readonly TrajectoryToolSchema[]
  /** Provider/model that received this prompt. */
  readonly provider?: string
  readonly model?: string
  /** SHA-256 of the prompt, for diff gating. */
  readonly promptHash?: string
  readonly previousPromptHash?: string
}

export interface TrajectoryPromptSection {
  readonly id: string
  readonly label: string
  readonly content: string
  /** Byte length of this section in the assembled prompt. */
  readonly length: number
}

export interface TrajectoryToolSchema {
  readonly name: string
  readonly label?: string
  readonly description?: string
  readonly parameters?: string
  readonly promptSnippet?: string
  readonly promptGuidelines?: readonly string[]
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export type TrajectoryRequestKind = 'assistant' | 'compaction'

export interface TrajectoryRequest {
  readonly number: number
  readonly kind: TrajectoryRequestKind
  readonly turn: number | null
  readonly step: number
  readonly entryId?: string
  readonly status: 'complete' | 'running' | 'error'
  readonly startedAt?: number
  readonly completedAt?: number | null
  readonly error?: string
  readonly provider?: string
  readonly model?: string
  readonly usage?: TrajectoryUsage
  readonly cumulativeUsage?: TrajectoryUsage
  readonly tokensBefore?: number
  readonly summary?: string
  readonly retry?: number
  readonly maxRetries?: number
  readonly retryDelayMs?: number
}

// ---------------------------------------------------------------------------
// In-flight (live mode only)
// ---------------------------------------------------------------------------

export interface TrajectoryPartialAssistant {
  readonly turn: number
  readonly step: number
  readonly blocks: readonly TrajectorySourceBlock[]
  readonly startedAt: number
  readonly firstTokenTime: number | null
}

export interface TrajectoryRunningTool {
  readonly callId: string
  readonly toolName: string
  readonly args: unknown
  readonly startedAt: number
  readonly partialPreview?: string
}

// ---------------------------------------------------------------------------
// Session listing
// ---------------------------------------------------------------------------

export interface SessionListItem {
  readonly path: string
  readonly id: string
  readonly cwd: string
  readonly name?: string
  readonly parentSessionPath?: string
  readonly createdAt: number
  readonly modified: number
  readonly messageCount: number
  readonly firstMessage: string
  /** Provider/model hint from the last assistant message, if any. */
  readonly provider?: string
  readonly model?: string
}

// ---------------------------------------------------------------------------
// Record id rule (ported from DSH trajectory-record.ts)
// ---------------------------------------------------------------------------

/**
 * Resolve the identity that survives prepending older projected records.
 * Priority: explicit recordId → callId → entryId → index.
 * @param record - Projected trajectory record.
 * @returns Stable record identity with U+0000 separators.
 */
export function trajectoryRecordId(record: TrajectoryRecord): string {
  if (record.recordId) return record.recordId
  if (record.callId !== undefined) return `${record.kind}\u0000call\u0000${record.callId}`
  if (record.entryId !== undefined) return `${record.kind}\u0000entry\u0000${record.entryId}`
  return `${record.kind}\u0000index\u0000${record.index}`
}

// ---------------------------------------------------------------------------
// Duration formatting (ported from DSH trajectory-record.ts)
// ---------------------------------------------------------------------------

/**
 * Format a duration in milliseconds with thousands separators.
 * @param milliseconds - Duration in milliseconds, or `null` when absent.
 * @returns `—` when unknown, otherwise an integer-millisecond label.
 */
export function formatDurationMillis(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return '—'
  const integer = String(Math.round(milliseconds))
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ms`
}

/**
 * Format an elapsed duration given in seconds as a millisecond label.
 * @param seconds - Duration seconds, or `null` when absent.
 * @returns `—` when unknown, otherwise an integer-millisecond label.
 */
export function formatElapsedSeconds(seconds: number | null): string {
  return formatDurationMillis(seconds === null ? null : seconds * 1000)
}
