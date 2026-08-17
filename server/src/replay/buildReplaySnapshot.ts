/**
 * Build a TrajectorySnapshot from a pi session JSONL file (replay mode).
 *
 * Reads the active branch via pi's `buildContextEntries`, walks it in
 * chronological order, and projects each entry to one or more
 * `TrajectoryRecord`s per `prd/03-data-model.md`.
 *
 * No pi SessionManager instance is needed — `parseSessionEntries` +
 * `buildContextEntries` are free functions, keeping replay stateless.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import {
  parseSessionEntries,
  buildContextEntries,
  type SessionEntry,
  type SessionHeader,
  type SessionMessageEntry,
  type CompactionEntry,
  type BranchSummaryEntry,
  type ModelChangeEntry,
  type ThinkingLevelChangeEntry,
  type CustomEntry,
  type CustomMessageEntry,
  type SessionInfoEntry,
  type FileEntry,
} from '@earendil-works/pi-coding-agent'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type {
  AssistantMessage,
  ToolResultMessage,
  UserMessage,
  ToolCall,
  TextContent,
  ImageContent,
  ThinkingContent,
} from '@earendil-works/pi-ai'
import type {
  TrajectorySnapshot,
  TrajectoryRecord,
  TrajectoryRequest,
  TrajectoryUsage,
  TrajectorySourceBlock,
  TrajectorySessionHeader,
  TrajectoryModelState,
  TrajectoryPromptAnatomy,
} from '@pi-trajectory/shared'
import { summarizeRecord } from './record-summary.ts'
import { resolveToolSchema } from './tool-schemas.ts'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a replay snapshot from a session file path.
 * @param sessionFile - Absolute path to a `.jsonl` session file.
 * @returns A TrajectorySnapshot; on parse failure, a snapshot with an error.
 */
export function buildReplaySnapshot(sessionFile: string): TrajectorySnapshot {
  let entries: FileEntry[]
  try {
    entries = loadReplayEntries(sessionFile)
  } catch (err) {
    return errorSnapshot(sessionFile, errorMessage(err), 'parse')
  }

  try {
    return project(sessionFile, entries)
  } catch (err) {
    return errorSnapshot(sessionFile, errorMessage(err), 'project')
  }
}

/** Read and parse raw session entries for the debug endpoint. */
export function loadReplayEntries(sessionFile: string): FileEntry[] {
  return parseSessionEntries(readFileSync(sessionFile, 'utf8'))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

interface ProjectionState {
  turn: number
  step: number
  provider: string
  modelId: string
  thinkingLevel: string
  /** Pending tool calls by callId, awaiting a matching ToolResultMessage. */
  pendingTools: Map<string, { call: ToolCall; assistantEntryId: string; turn: number; step: number; requestNumber: number }>
  /** Most recent prompt anatomy logged by the extension, for diffing. */
  lastPromptAnatomy: TrajectoryPromptAnatomy | undefined
  cumulativeUsage: TrajectoryUsage | undefined
}

function project(sessionFile: string, fileEntries: FileEntry[]): TrajectorySnapshot {
  const header = fileEntries.find((e): e is SessionHeader => e.type === 'session')
  if (header === undefined) return errorSnapshot(sessionFile, 'missing session header', 'parse')

  const entries = fileEntries.filter((e): e is SessionEntry => e.type !== 'session')
  const active = buildContextEntries(entries)

  const state: ProjectionState = {
    turn: 0,
    step: 0,
    provider: '',
    modelId: '',
    thinkingLevel: 'medium',
    pendingTools: new Map(),
    lastPromptAnatomy: undefined,
    cumulativeUsage: undefined,
  }

  const records: TrajectoryRecord[] = []
  const requests: TrajectoryRequest[] = []
  let requestNumber = 0
  let name: string | undefined
  let leafEntryId: string | null = null

  // Track the last entry id on the active branch for the header.
  if (active.length > 0) {
    leafEntryId = active[active.length - 1]!.id
  }

  for (const entry of active) {
    leafEntryId = entry.id

    // Non-message entries that carry metadata but no record of their own.
    if (entry.type === 'session_info') {
      name = (entry as SessionInfoEntry).name
      continue
    }
    if (entry.type === 'label') continue
    if (entry.type === 'custom') {
      // Extension state — emit a system record for the prompt-log extension.
      const custom = entry as CustomEntry
      if (custom.customType === 'trajectory-prompt') {
        const anatomy = custom.data as TrajectoryPromptAnatomy | undefined
        if (anatomy !== undefined) {
          pushSystemRecord(records, entry, anatomy, state)
          state.lastPromptAnatomy = anatomy
        }
      }
      continue
    }
    if (entry.type === 'custom_message') {
      const cm = entry as CustomMessageEntry
      if (cm.display) {
        pushContextRecord(records, entry, cm, state)
      }
      continue
    }
    if (entry.type === 'model_change') {
      const mc = entry as ModelChangeEntry
      pushModelChangeRecord(records, entry, mc, state)
      state.provider = mc.provider
      state.modelId = mc.modelId
      continue
    }
    if (entry.type === 'thinking_level_change') {
      const tc = entry as ThinkingLevelChangeEntry
      pushThinkingChangeRecord(records, entry, tc, state)
      state.thinkingLevel = tc.thinkingLevel
      continue
    }
    if (entry.type === 'compaction') {
      const ce = entry as CompactionEntry
      requestNumber += 1
      const usage = ce.usage !== undefined ? toTrajectoryUsage(ce.usage) : undefined
      state.cumulativeUsage = addUsage(state.cumulativeUsage, usage)
      requests.push({
        number: requestNumber,
        kind: 'compaction',
        turn: null,
        step: 0,
        entryId: ce.id,
        status: 'complete',
        completedAt: entryMs(ce),
        ...(ce.tokensBefore !== undefined ? { tokensBefore: ce.tokensBefore } : {}),
        summary: ce.summary,
        ...(usage !== undefined ? { usage } : {}),
        ...(state.cumulativeUsage !== undefined ? { cumulativeUsage: state.cumulativeUsage } : {}),
      })
      records.push({
        index: records.length + 1,
        recordId: `compacted\u0000entry\u0000${ce.id}`,
        kind: 'compacted',
        entryId: ce.id,
        timestamp: entryMs(ce),
        summary: summarizeRecord({ kind: 'compacted', tokensBefore: ce.tokensBefore, summary: ce.summary }),
        previewMarkdown: ce.summary.slice(0, 200),
        turn: null,
        step: 0,
        requestNumber,
        outputDetail: ce.summary,
        ...(ce.tokensBefore !== undefined ? { input: undefined } : {}),
        ...(usage !== undefined ? { usage } : {}),
        ...(state.cumulativeUsage !== undefined ? { cumulativeUsage: state.cumulativeUsage } : {}),
        timeSeconds: null,
        completedAt: entryMs(ce),
      })
      continue
    }
    if (entry.type === 'branch_summary') {
      const bs = entry as BranchSummaryEntry
      records.push({
        index: records.length + 1,
        recordId: `branch-summary\u0000entry\u0000${bs.id}`,
        kind: 'branch-summary',
        entryId: bs.id,
        timestamp: entryMs(bs),
        summary: summarizeRecord({ kind: 'branch-summary', summary: bs.summary }),
        previewMarkdown: bs.summary.slice(0, 200),
        turn: null,
        step: 0,
        outputDetail: bs.summary,
        timeSeconds: null,
        completedAt: entryMs(bs),
      })
      continue
    }

    if (entry.type !== 'message') continue
    const msgEntry = entry as SessionMessageEntry
    const msg = msgEntry.message
    const ts = messageTimestamp(msg, msgEntry)

    switch (msg.role) {
      case 'user': {
        state.turn += 1
        state.step = 0
        pushUserRecord(records, msgEntry, msg, ts, state)
        break
      }
      case 'assistant': {
        state.step += 1
        requestNumber += 1
        pushAssistantRecord(records, requests, msgEntry, msg, ts, state, requestNumber)
        // Register tool calls for later pairing with results.
        for (const block of msg.content) {
          if (block.type === 'toolCall') {
            state.pendingTools.set(block.id, {
              call: block,
              assistantEntryId: msgEntry.id,
              turn: state.turn,
              step: state.step,
              requestNumber,
            })
          }
        }
        break
      }
      case 'toolResult': {
        pairToolResult(records, requests, msgEntry, msg, ts, state)
        break
      }
      case 'bashExecution': {
        pushBashRecord(records, msgEntry, msg, ts, state)
        break
      }
      case 'custom': {
        if (msg.display) pushContextRecord(records, msgEntry, { content: msg.content, display: msg.display, customType: msg.customType }, state)
        break
      }
      case 'branchSummary':
      case 'compactionSummary':
        // These roles are in-context projections; the entries are the source of truth.
        // Skip — handled via their entry types above.
        break
      default:
        // Unknown role — skip rather than crash.
        break
    }
  }

  const snapshotHeader: TrajectorySessionHeader = {
    sessionId: header.id,
    sessionFile,
    cwd: header.cwd,
    ...(name !== undefined ? { name } : {}),
    ...(header.parentSession !== undefined ? { parentSessionPath: header.parentSession } : {}),
    createdAt: Date.parse(header.timestamp) || 0,
    leafEntryId,
    entryCount: active.length,
  }

  const model: TrajectoryModelState = {
    provider: state.provider,
    modelId: state.modelId,
    thinkingLevel: state.thinkingLevel,
  }

  return {
    header: snapshotHeader,
    records,
    requests,
    model,
    steering: [],
    followUp: [],
    partial: null,
    runningTools: [],
    hasOlderRecords: false,
    cumulativeUsage: state.cumulativeUsage ?? {},
  }
}

// ---------------------------------------------------------------------------
// Record builders
// ---------------------------------------------------------------------------

function pushUserRecord(
  records: TrajectoryRecord[],
  entry: SessionMessageEntry,
  msg: UserMessage,
  ts: number,
  state: ProjectionState,
): void {
  const text = messageText(msg)
  records.push({
    index: records.length + 1,
    recordId: `user\u0000entry\u0000${entry.id}`,
    kind: 'user',
    entryId: entry.id,
    timestamp: ts,
    summary: summarizeRecord({ kind: 'user', text }),
    previewMarkdown: text.slice(0, 500),
    opensTurn: true,
    turn: state.turn,
    step: 0,
    inputDetail: text,
    sourceBlocks: toSourceBlocks(msg),
    timeSeconds: null,
    completedAt: ts,
  })
}

function pushContextRecord(
  records: TrajectoryRecord[],
  entry: SessionMessageEntry | CustomMessageEntry,
  cm: { content: string | (TextContent | ImageContent)[]; display: boolean; customType?: string },
  state: ProjectionState,
): void {
  const text = typeof cm.content === 'string' ? cm.content : cm.content.map(blockText).join('\n')
  const customType = 'customType' in entry ? entry.customType : cm.customType
  records.push({
    index: records.length + 1,
    recordId: `context\u0000entry\u0000${entry.id}`,
    kind: 'context',
    entryId: entry.id,
    timestamp: entryMs(entry),
    summary: summarizeRecord({ kind: 'context', text, customType }),
    previewMarkdown: text.slice(0, 500),
    turn: state.turn,
    step: state.step,
    inputDetail: text,
    timeSeconds: null,
    completedAt: entryMs(entry),
  })
}

function pushAssistantRecord(
  records: TrajectoryRecord[],
  requests: TrajectoryRequest[],
  entry: SessionMessageEntry,
  msg: AssistantMessage,
  ts: number,
  state: ProjectionState,
  requestNumber: number,
): void {
  const usage = toTrajectoryUsage(msg.usage)
  state.cumulativeUsage = addUsage(state.cumulativeUsage, usage)
  const isError = msg.stopReason === 'error'
  const text = assistantText(msg)
  const thinking = assistantThinking(msg)
  const sourceBlocks = toSourceBlocks({ role: 'assistant', content: msg.content } as AssistantMessage)

  requests.push({
    number: requestNumber,
    kind: 'assistant',
    turn: state.turn,
    step: state.step,
    entryId: entry.id,
    status: isError ? 'error' : 'complete',
    completedAt: ts,
    ...(msg.errorMessage !== undefined ? { error: msg.errorMessage } : {}),
    provider: msg.provider,
    model: msg.model,
    ...(usage !== undefined ? { usage } : {}),
    ...(state.cumulativeUsage !== undefined ? { cumulativeUsage: state.cumulativeUsage } : {}),
  })

  records.push({
    index: records.length + 1,
    recordId: `message\u0000entry\u0000${entry.id}`,
    kind: isError ? 'error' : 'message',
    entryId: entry.id,
    timestamp: ts,
    summary: summarizeRecord({ kind: 'message', text, isError, errorMessage: msg.errorMessage }),
    previewMarkdown: text.slice(0, 500),
    turn: state.turn,
    step: state.step,
    requestNumber,
    inputDetail: undefined,
    outputDetail: text,
    thinkingDetail: thinking.length > 0 ? thinking : undefined,
    sourceBlocks,
    assistantMetrics: {
      timingRecorded: false,
      stepStartTime: null,
      firstTokenTime: null,
      completedTime: ts,
      usageProvided: usage !== undefined,
      outputTokens: msg.usage?.output ?? null,
    },
    usage,
    ...(state.cumulativeUsage !== undefined ? { cumulativeUsage: state.cumulativeUsage } : {}),
    timeSeconds: null,
    completedAt: ts,
    provider: msg.provider,
    model: msg.model,
    api: msg.api,
    stopReason: msg.stopReason,
  })
}

function pairToolResult(
  records: TrajectoryRecord[],
  _requests: TrajectoryRequest[],
  entry: SessionMessageEntry,
  msg: ToolResultMessage,
  ts: number,
  state: ProjectionState,
): void {
  const pending = state.pendingTools.get(msg.toolCallId)
  const call = pending?.call
  const resultText = msg.content.map(blockText).join('\n')
  const argsJson = call !== undefined ? JSON.stringify(call.arguments, null, 2) : ''
  const schema = resolveToolSchema(msg.toolName)

  records.push({
    index: records.length + 1,
    recordId: `tool\u0000call\u0000${msg.toolCallId}`,
    kind: 'tool',
    entryId: entry.id,
    timestamp: ts,
    summary: summarizeRecord({
      kind: 'tool',
      toolName: msg.toolName,
      args: call?.arguments,
      result: resultText,
      isError: msg.isError,
    }),
    previewMarkdown: call !== undefined ? `${msg.toolName} ${JSON.stringify(call.arguments)}` : msg.toolName,
    turn: pending?.turn ?? state.turn,
    step: pending?.step ?? state.step,
    requestNumber: pending?.requestNumber,
    callId: msg.toolCallId,
    toolName: msg.toolName,
    inputDetail: argsJson,
    outputDetail: resultText,
    outputBlocks: toSourceBlocks({ role: 'toolResult', content: msg.content } as ToolResultMessage),
    schemaDetail: schema,
    result: resultText.slice(0, 500),
    isError: msg.isError,
    ...(msg.usage !== undefined ? { usage: toTrajectoryUsage(msg.usage) } : {}),
    timeSeconds: null,
    completedAt: ts,
  })
  state.pendingTools.delete(msg.toolCallId)
}

function pushBashRecord(
  records: TrajectoryRecord[],
  entry: SessionMessageEntry,
  msg: AgentMessage & { role: 'bashExecution' },
  ts: number,
  _state: ProjectionState,
): void {
  records.push({
    index: records.length + 1,
    recordId: `bash\u0000entry\u0000${entry.id}`,
    kind: 'bash',
    entryId: entry.id,
    timestamp: ts,
    summary: summarizeRecord({ kind: 'bash', command: msg.command, exitCode: msg.exitCode, cancelled: msg.cancelled }),
    turn: _state.turn,
    step: _state.step,
    inputDetail: msg.command,
    outputDetail: msg.output,
    isError: msg.exitCode !== undefined && msg.exitCode !== 0,
    timeSeconds: null,
    completedAt: ts,
  })
}

function pushModelChangeRecord(
  records: TrajectoryRecord[],
  entry: ModelChangeEntry,
  mc: ModelChangeEntry,
  state: ProjectionState,
): void {
  records.push({
    index: records.length + 1,
    recordId: `model-change\u0000entry\u0000${entry.id}`,
    kind: 'model-change',
    entryId: entry.id,
    timestamp: entryMs(entry),
    summary: summarizeRecord({ kind: 'model-change', provider: mc.provider, modelId: mc.modelId }),
    turn: state.turn,
    step: state.step,
    provider: mc.provider,
    model: mc.modelId,
    previousProvider: state.provider || undefined,
    previousModelId: state.modelId || undefined,
    timeSeconds: null,
    completedAt: entryMs(entry),
  })
}

function pushThinkingChangeRecord(
  records: TrajectoryRecord[],
  entry: ThinkingLevelChangeEntry,
  tc: ThinkingLevelChangeEntry,
  state: ProjectionState,
): void {
  records.push({
    index: records.length + 1,
    recordId: `thinking-change\u0000entry\u0000${entry.id}`,
    kind: 'thinking-change',
    entryId: entry.id,
    timestamp: entryMs(entry),
    summary: summarizeRecord({ kind: 'thinking-change', level: tc.thinkingLevel }),
    turn: state.turn,
    step: state.step,
    previousThinkingLevel: state.thinkingLevel,
    timeSeconds: null,
    completedAt: entryMs(entry),
  })
}

function pushSystemRecord(
  records: TrajectoryRecord[],
  entry: CustomEntry,
  anatomy: TrajectoryPromptAnatomy,
  state: ProjectionState,
): void {
  records.push({
    index: records.length + 1,
    recordId: `system\u0000entry\u0000${entry.id}`,
    kind: 'system',
    entryId: entry.id,
    timestamp: entryMs(entry),
    summary: summarizeRecord({ kind: 'system', sections: anatomy.sections, tools: anatomy.tools }),
    turn: state.turn,
    step: state.step,
    promptAnatomy: anatomy,
    previousPromptAnatomy: state.lastPromptAnatomy,
    timeSeconds: null,
    completedAt: entryMs(entry),
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entryMs(entry: SessionEntry): number {
  return Date.parse(entry.timestamp) || 0
}

function messageTimestamp(msg: AgentMessage, entry: SessionMessageEntry): number {
  if (typeof (msg as { timestamp?: unknown }).timestamp === 'number') {
    return (msg as { timestamp: number }).timestamp
  }
  return entryMs(entry)
}

function blockText(block: TextContent | ImageContent | ThinkingContent | ToolCall): string {
  switch (block.type) {
    case 'text':
      return block.text
    case 'thinking':
      return block.thinking
    case 'image':
      return `[image ${block.mimeType}]`
    case 'toolCall':
      return `${block.name}(${JSON.stringify(block.arguments)})`
  }
}

function messageText(msg: UserMessage): string {
  return typeof msg.content === 'string' ? msg.content : msg.content.map(blockText).join('\n')
}

function assistantText(msg: AssistantMessage): string {
  return msg.content
    .filter((b): b is TextContent => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

function assistantThinking(msg: AssistantMessage): string {
  return msg.content
    .filter((b): b is ThinkingContent => b.type === 'thinking')
    .map((b) => b.thinking)
    .join('\n')
}

type ContentMessage = UserMessage | AssistantMessage | ToolResultMessage

function toSourceBlocks(msg: ContentMessage): TrajectorySourceBlock[] {
  if (typeof msg.content === 'string') {
    return [{ type: 'text', content: msg.content }]
  }
  if (!Array.isArray(msg.content)) return []
  return msg.content.map((block) => {
    switch (block.type) {
      case 'text':
        return { type: 'text', content: block.text }
      case 'thinking':
        return { type: 'thinking', content: block.thinking }
      case 'image':
        return {
          type: 'image',
          content: `[image ${block.mimeType}]`,
          imageSrc: `data:${block.mimeType};base64,${block.data}`,
          imageAlt: 'session image',
        }
      case 'toolCall':
        return {
          type: 'toolCall',
          content: JSON.stringify(block.arguments, null, 2),
          callId: block.id,
          toolName: block.name,
        }
    }
  })
}

function toTrajectoryUsage(u: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } } | undefined): TrajectoryUsage | undefined {
  if (u === undefined) return undefined
  return {
    input: u.input,
    output: u.output,
    cacheRead: u.cacheRead,
    cacheWrite: u.cacheWrite,
    totalTokens: u.totalTokens,
    cost: u.cost,
  }
}

function addUsage(total: TrajectoryUsage | undefined, add: TrajectoryUsage | undefined): TrajectoryUsage | undefined {
  if (add === undefined) return total
  if (total === undefined) return add
  return {
    input: (total.input ?? 0) + (add.input ?? 0),
    output: (total.output ?? 0) + (add.output ?? 0),
    cacheRead: (total.cacheRead ?? 0) + (add.cacheRead ?? 0),
    cacheWrite: (total.cacheWrite ?? 0) + (add.cacheWrite ?? 0),
    totalTokens: (total.totalTokens ?? 0) + (add.totalTokens ?? 0),
    cost: {
      input: (total.cost?.input ?? 0) + (add.cost?.input ?? 0),
      output: (total.cost?.output ?? 0) + (add.cost?.output ?? 0),
      cacheRead: (total.cost?.cacheRead ?? 0) + (add.cost?.cacheRead ?? 0),
      cacheWrite: (total.cost?.cacheWrite ?? 0) + (add.cost?.cacheWrite ?? 0),
      total: (total.cost?.total ?? 0) + (add.cost?.total ?? 0),
    },
  }
}

function errorSnapshot(sessionFile: string, message: string, stage: 'parse' | 'project'): TrajectorySnapshot {
  return {
    header: {
      sessionId: basename(sessionFile, '.jsonl'),
      sessionFile,
      cwd: '',
      createdAt: 0,
      leafEntryId: null,
      entryCount: 0,
    },
    records: [],
    requests: [],
    model: { provider: '', modelId: '', thinkingLevel: 'medium' },
    steering: [],
    followUp: [],
    partial: null,
    runningTools: [],
    hasOlderRecords: false,
    cumulativeUsage: {},
    error: { message, stage },
  }
}
