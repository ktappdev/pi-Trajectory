# Pi Platform Reference

Facts about pi (the coding agent CLI by Earendil Works) that pi-Trajectory depends on. Every claim cites a pi source file or doc. pi version referenced: **0.84.2** (`@earendil-works/pi-coding-agent`).

Install path on this machine: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/`

## 1. Session storage — JSONL on disk

Source: `docs/session-format.md`, `dist/core/session-manager.d.ts`.

### Location

```
~/.pi/agent/sessions/--<cwd-with-slashes-as-dashes>--/<timestamp>_<uuid>.jsonl
```

The cwd is encoded by replacing `/` with `-`. Example from this machine:
```
~/.pi/agent/sessions/--Users-kentaylor-developer-deepseek-harness--/2026-08-17T18-53-15-772Z_01a01112-207b-7ee8-ab0b-f1250ee93e1b.jsonl
```

The current session file is also exposed via the `PI_SESSION_FILE` env var inside a running pi process.

### Format

JSONL — one JSON object per line. First line is a `SessionHeader`; the rest are `SessionEntry` objects forming a **tree** via `id` / `parentId`.

**Session version: 3** (`CURRENT_SESSION_VERSION = 3`, `session-manager.d.ts:4`). v1 = linear, v2 = tree, v3 = renamed `hookMessage` role to `custom`. Old sessions auto-migrate on load.

### SessionHeader (`session-manager.d.ts:6`)

```typescript
interface SessionHeader {
  type: "session"
  version?: number
  id: string                  // uuid
  timestamp: string           // ISO 8601
  cwd: string
  parentSession?: string      // path to parent session (fork/clone)
}
```

Real example:
```json
{"type":"session","version":3,"id":"019fc451-2817-74b0-8669-8ea996a4b328","timestamp":"2026-08-02T21:11:20.855Z","cwd":"/Users/kentaylor/developer/test-j"}
```

### SessionEntryBase (`session-manager.d.ts:17`)

```typescript
interface SessionEntryBase {
  type: string
  id: string                  // 8-char hex
  parentId: string | null     // null for first entry
  timestamp: string           // ISO 8601
}
```

### Entry types (the union, `session-manager.d.ts:105`)

```typescript
type SessionEntry =
  | SessionMessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry
  | CustomMessageEntry
  | LabelEntry
  | SessionInfoEntry
```

#### `SessionMessageEntry` (`:23`)
```typescript
{ type: "message"; message: AgentMessage } extends SessionEntryBase
```
The `message` field is an `AgentMessage` (see §2 below).

#### `ModelChangeEntry` (`:31`)
```typescript
{ type: "model_change"; provider: string; modelId: string } extends SessionEntryBase
```
Real example:
```json
{"type":"model_change","id":"d63fe1fa","parentId":null,"timestamp":"2026-08-02T21:11:23.617Z","provider":"windsurf","modelId":"gpt-5-6-luna-medium"}
```

#### `ThinkingLevelChangeEntry` (`:27`)
```typescript
{ type: "thinking_level_change"; thinkingLevel: string } extends SessionEntryBase
```
Real example:
```json
{"type":"thinking_level_change","id":"5f7a6d36","parentId":"d63fe1fa","timestamp":"2026-08-02T21:11:23.617Z","thinkingLevel":"high"}
```
Thinking levels: `off | minimal | low | medium | high | xhigh | max` (from `docs/sdk.md`).

#### `CompactionEntry` (`:36`)
```typescript
interface CompactionEntry<T = unknown> extends SessionEntryBase {
  type: "compaction"
  summary: string
  firstKeptEntryId: string
  tokensBefore: number
  details?: T              // e.g. { readFiles: string[], modifiedFiles: string[] }
  usage?: Usage            // LLM usage from generating the summary
  fromHook?: boolean       // true = extension-generated
}
```
Real example:
```json
{"type":"compaction","id":"6ba4001f","parentId":"79b7a070","timestamp":"2026-08-02T19:08:04.509Z","firstKeptEntryId":"d8bacf08","tokensBefore":243475,"fromHook":true,"summary":"<5587 chars>"}
```
Newer compactions may include `retainedTail` (materialized `AgentMessage[]` kept after compaction) — see `docs/session-format.md`. Optional for backward compat.

#### `BranchSummaryEntry` (`:48`)
```typescript
interface BranchSummaryEntry<T = unknown> extends SessionEntryBase {
  type: "branch_summary"
  fromId: string
  summary: string
  details?: T
  usage?: Usage
  fromHook?: boolean
}
```

#### `CustomEntry` (`:69`) — extension state, NOT in LLM context
```typescript
interface CustomEntry<T = unknown> extends SessionEntryBase {
  type: "custom"
  customType: string
  data?: T
}
```
Real example (a web-search-results entry):
```json
{"type":"custom","customType":"web-search-results","data":{"id":"msc3xutgh6uamq","type":"search","timestamp":1785693728068,"queries":[...]}}
```

#### `CustomMessageEntry` (`:97`) — extension message, IN LLM context
```typescript
interface CustomMessageEntry<T = unknown> extends SessionEntryBase {
  type: "custom_message"
  customType: string
  content: string | (TextContent | ImageContent)[]
  details?: T
  display: boolean          // true = show in TUI; false = hidden
}
```
Real example (a steering reminder):
```json
{"type":"custom_message","customType":"picode-owed-reminder","content":"[picode-system] Automated reminder...","display":true,"id":"e54bd7e6","parentId":"...","timestamp":"..."}
```

#### `LabelEntry` (`:75`) — bookmark on an entry
```typescript
{ type: "label"; targetId: string; label: string | undefined } extends SessionEntryBase
```

#### `SessionInfoEntry` (`:81`) — display name
```typescript
{ type: "session_info"; name?: string } extends SessionEntryBase
```

### Tree structure

- First entry has `parentId: null`.
- Each subsequent entry points to its parent.
- Branching creates new children from an earlier entry.
- The "leaf" is the current position. `getLeafId()` / `getLeafEntry()`.

### Context building (how pi resolves the active branch)

`buildContextEntries(entries, leafId?)` (`session-manager.d.ts:160`) walks leaf → root, honoring compaction:
1. Collects all entries on the path.
2. If a `CompactionEntry` is on the path: includes the compaction entry first; if `retainedTail` present, it's a self-contained checkpoint; otherwise entries from `firstKeptEntryId` to the compaction are included; then entries after compaction.
3. Preserves non-message entries in range for TUI rendering.

`buildSessionContext(entries, leafId?)` (`:166`) builds on that to produce `{ messages, thinkingLevel, model }` for the LLM.

**For pi-Trajectory replay:** to show what the agent actually saw, use `buildContextEntries` with the current leaf. To show the **full raw history** (every entry ever written, including abandoned branches), use `getEntries()` (all entries excluding header) and walk the tree with `getTree()`. **[design]** pi-Trajectory v1 shows the active branch (`buildContextEntries`); a tree view is a v2 feature.

## 2. Message types — `AgentMessage`

Sources: `docs/session-format.md`, `dist/core/messages.d.ts`, `@earendil-works/pi-agent-core/dist/types.d.ts`.

```typescript
type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | BashExecutionMessage
  | CustomMessage
  | BranchSummaryMessage
  | CompactionSummaryMessage
```

### Content blocks (inside messages)

```typescript
interface TextContent { type: "text"; text: string }
interface ImageContent { type: "image"; data: string; mimeType: string }  // base64
interface ThinkingContent { type: "thinking"; thinking: string; thinkingSignature?: string }
interface ToolCall { type: "toolCall"; id: string; name: string; arguments: Record<string, any> }
```

### `UserMessage` (pi-ai)
```typescript
interface UserMessage {
  role: "user"
  content: string | (TextContent | ImageContent)[]
  timestamp: number   // Unix ms
}
```

### `AssistantMessage` (pi-ai)
```typescript
interface AssistantMessage {
  role: "assistant"
  content: (TextContent | ThinkingContent | ToolCall)[]
  api: string
  provider: string
  model: string
  usage: Usage
  stopReason: "stop" | "length" | "toolUse" | "error" | "aborted"
  errorMessage?: string
  timestamp: number   // Unix ms
}
```

Real example (error case, empty content):
```json
{"role":"assistant","content":[],"api":"openai-completions","provider":"windsurf","model":"gpt-5-6-luna-medium","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1785705155403,"errorMessage":"This model is only in Devin Local..."}
```

Real example (tool calls + thinking):
```json
{"role":"assistant","content":[{"type":"thinking","thinking":"Let me start by reading...","thinkingSignature":"reasoning_content"},{"type":"text","text":"Standing by — starting work now."},{"type":"toolCall","id":"call_00_WvFFAlCVsppT9iQWXjH14586","name":"read","arguments":{"path":"src/components/sections/VerticalListItem.astro"}},{"type":"toolCall","id":"call_01_YYkPK...","name":"read","arguments":{"path":"..."}}],"api":"anthropic-messages","provider":"opencode-go","model":"minimax-m3","usage":{...},"stopReason":"toolUse","timestamp":1785705472980}
```

**Note:** `"pending"` is in the exported `StopReason` type but reserved for partial streaming messages; it never appears in persisted JSONL.

### `ToolResultMessage` (pi-ai)
```typescript
interface ToolResultMessage {
  role: "toolResult"
  toolCallId: string
  toolName: string
  content: (TextContent | ImageContent)[]
  details?: any          // tool-specific metadata
  usage?: Usage          // nested LLM work by the tool
  isError: boolean
  timestamp: number
}
```

Real example:
```json
{"role":"toolResult","toolCallId":"call_00_WvFFAlCVsppT9iQWXjH14586","toolName":"read","content":[{"type":"text","text":"---\ninterface Props {\n\tnumber: string;..."}],"isError":false,"timestamp":1785705473405}
```

### `Usage` (pi-ai)
```typescript
interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
}
```

### `BashExecutionMessage` (`messages.d.ts:16`) — `!` / `!!` commands
```typescript
interface BashExecutionMessage {
  role: "bashExecution"
  command: string
  output: string
  exitCode: number | undefined
  cancelled: boolean
  truncated: boolean
  fullOutputPath?: string
  excludeFromContext?: boolean   // true for !! prefix
  timestamp: number
}
```

### `CustomMessage` (`messages.d.ts:32`) — extension-injected, in LLM context
```typescript
interface CustomMessage<T = unknown> {
  role: "custom"
  customType: string
  content: string | (TextContent | ImageContent)[]
  display: boolean
  details?: T
  timestamp: number
}
```

### `BranchSummaryMessage` / `CompactionSummaryMessage` (`messages.d.ts:40`, `:46`)
```typescript
interface BranchSummaryMessage { role: "branchSummary"; summary: string; fromId: string; timestamp: number }
interface CompactionSummaryMessage { role: "compactionSummary"; summary: string; tokensBefore: number; timestamp: number }
```

These are the **in-context** projections of `BranchSummaryEntry` / `CompactionEntry` when building LLM context. The entries carry the durable form; these messages are what the LLM sees (wrapped with prefixes from `COMPACTION_SUMMARY_PREFIX`/`BRANCH_SUMMARY_PREFIX`).

## 3. SessionManager API

Source: `dist/core/session-manager.d.ts`, `docs/session-format.md`.

### Static creation (`session-manager.d.ts`)
- `SessionManager.create(cwd, sessionDir?)` — new session
- `SessionManager.open(path, sessionDir?)` — open existing file
- `SessionManager.continueRecent(cwd, sessionDir?)` — most recent or new
- `SessionManager.inMemory(cwd?)` — no persistence
- `SessionManager.forkFrom(sourcePath, targetCwd, sessionDir?)` — fork from another project

### Static listing
- `SessionManager.list(cwd, sessionDir?, onProgress?)` → `SessionInfo[]`
- `SessionManager.listAll(onProgress?)` → all sessions across all projects

### `SessionInfo` (`:125`)
```typescript
interface SessionInfo {
  path: string
  id: string
  cwd: string
  name?: string               // from session_info entry
  parentSessionPath?: string
  created: Date
  modified: Date
  messageCount: number
  firstMessage: string
  allMessagesText: string
}
```

### Instance — reading
- `getEntries()` — all entries (excluding header)
- `getHeader()` — `SessionHeader`
- `getLeafId()` / `getLeafEntry()` — current position
- `getEntry(id)` — by id
- `getBranch(fromId?)` — walk entry → root
- `getTree()` — full tree (`SessionTreeNode[]`, each `{ entry, children, label?, labelTimestamp? }`)
- `getChildren(parentId)` — direct children
- `getLabel(id)` — label for entry
- `buildContextEntries()` — active branch, compaction-aware
- `buildSessionContext()` — `{ messages, thinkingLevel, model }` for LLM
- `getSessionName()` — display name
- `getCwd()` / `getSessionDir()` / `getSessionId()` / `getSessionFile()` / `isPersisted()`

### Instance — appending (all return entry id)
- `appendMessage(message)`
- `appendThinkingLevelChange(level)`
- `appendModelChange(provider, modelId)`
- `appendCompaction(summary, firstKeptEntryId, tokensBefore, details?, fromHook?, usage?)`
- `appendCustomEntry(customType, data?)`
- `appendCustomMessageEntry(customType, content, display, details?)`
- `appendSessionInfo(name)`
- `appendLabelChange(targetId, label)`

### Instance — tree navigation
- `newSession(options?)`, `setSessionFile(path)`, `createBranchedSession(leafId)`
- `branch(entryId)`, `branchWithSummary(entryId, summary, details?, fromHook?)`, `resetLeaf()`

### Free functions (exported, usable without an instance)
- `parseSessionEntries(content: string): FileEntry[]` — parse JSONL text
- `loadEntriesFromFile(filePath: string): FileEntry[]`
- `buildContextEntries(entries, leafId?, byId?): SessionEntry[]`
- `buildSessionContext(entries, leafId?, byId?): SessionContext`
- `migrateSessionEntries(entries: FileEntry[]): void`
- `getLatestCompactionEntry(entries: SessionEntry[]): CompactionEntry | null`
- `sessionEntryToContextMessages(entry: SessionEntry): AgentMessage[]`
- `findMostRecentSession(sessionDir, cwd?): string | null`
- `getDefaultSessionDir(cwd, agentDir?): string`

**For replay mode, `loadEntriesFromFile` + `buildContextEntries` is the core read path.** No need to instantiate `SessionManager` for read-only display.

## 4. SDK — in-process agent control

Source: `docs/sdk.md`, `dist/core/agent-session.d.ts`, `dist/index.d.ts`, `examples/sdk/*`.

### `createAgentSession` (`dist/index.d.ts:18`)

```typescript
import { createAgentSession, SessionManager, ModelRuntime } from "@earendil-works/pi-coding-agent"

const modelRuntime = await ModelRuntime.create()
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),   // or .create(cwd), .continueRecent(cwd), .open(path)
  modelRuntime,
  // model: opus,                  // optional; else restore-from-session → settings → first available
  // thinkingLevel: "medium",
  // cwd: process.cwd(),
  // agentDir: "~/.pi/agent",
  // tools: ["read", "bash"],      // restrict active tools
  // customTools: [...],
})
```

Returns `{ session, modelFallbackMessage? }`.

### `AgentSession` (`agent-session.d.ts:192`)

Key members:
- `agent: Agent` — core LLM interaction (`agent.state`: `{ messages, model, thinkingLevel, systemPrompt, tools, streamingMessage?, errorMessage? }`)
- `sessionManager: SessionManager`
- `model: Model | undefined`, `thinkingLevel: ThinkingLevel`, `messages: AgentMessage[]`, `isStreaming: boolean`
- `sessionFile: string | undefined`, `sessionId: string`
- `prompt(text, options?: PromptOptions): Promise<void>` — send prompt; resolves after full run
- `steer(text): Promise<void>` / `followUp(text): Promise<void>` — queue during streaming
- `compact(customInstructions?): Promise<CompactionResult>` / `abortCompaction()`
- `abort(): Promise<void>`
- `navigateTree(targetId, options?)` — in-place tree navigation
- `subscribe(listener: AgentSessionEventListener): () => void` — **the event stream**
- `dispose(): void`

### `PromptOptions`
```typescript
interface PromptOptions {
  expandPromptTemplates?: boolean
  images?: ImageContent[]
  streamingBehavior?: "steer" | "followUp"
  source?: InputSource
  preflightResult?: (success: boolean) => void
}
```

### `AgentSessionRuntime` — for session replacement

`createAgentSessionRuntime()` owns replacement across `newSession()`, `switchSession()`, `fork()`, `importFromJsonl()`. After replacement, `runtime.session` changes and you must **re-subscribe** (subscriptions attach to a specific `AgentSession`). See `docs/sdk.md` "createAgentSessionRuntime" section.

## 5. Events — `AgentSessionEvent`

Sources: `agent-session.d.ts:40`, `@earendil-works/pi-agent-core/dist/types.d.ts:374`, `docs/rpc.md` Events section.

### Core `AgentEvent` (`pi-agent-core/dist/types.d.ts:374`)

```typescript
type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean }
```

### `AgentSessionEvent` (extends the above, `agent-session.d.ts:40`)

Adds session-level events:
- `{ type: "agent_end"; messages; willRetry: boolean }` (replaces core `agent_end`)
- `{ type: "agent_settled" }` — no retry/compaction/follow-up remains
- `{ type: "queue_update"; steering: readonly string[]; followUp: readonly string[] }`
- `{ type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }`
- `{ type: "compaction_end"; reason; result: CompactionResult | undefined; aborted: boolean; willRetry: boolean; errorMessage?: string }`
- `{ type: "entry_appended"; entry: SessionEntry }`
- `{ type: "session_info_changed"; name: string | undefined }`
- `{ type: "thinking_level_changed"; level: ThinkingLevel }`
- `{ type: "auto_retry_start"; attempt; maxAttempts; delayMs; errorMessage }`
- `{ type: "auto_retry_end"; success; attempt; finalError? }`
- `{ type: "summarization_retry_scheduled"; attempt; maxAttempts; delayMs; errorMessage }`
- `{ type: "summarization_retry_attempt_start"; source: "branchSummary" | "compaction"; reason? }`
- `{ type: "summarization_retry_finished" }`
- `{ type: "bash_execution_update"; id?: string; delta: string }`

### `AssistantMessageEvent` (delta types, `docs/rpc.md`)

Carried on `message_update.assistantMessageEvent`:
| Type | Fields |
|---|---|
| `text_start` | `contentIndex` |
| `text_delta` | `contentIndex`, `delta` |
| `text_end` | `contentIndex`, `content` |
| `thinking_start` | `contentIndex` |
| `thinking_delta` | `contentIndex`, `delta` |
| `thinking_end` | `contentIndex`, `content` |
| `toolcall_start` | `contentIndex` |
| `toolcall_delta` | `contentIndex`, `delta` |
| `toolcall_end` | `contentIndex`, `toolCall` (full `ToolCall`) |

`message_update` also carries a top-level `usage` (cumulative provider-reported; may stay zero until completion for some providers). It intentionally **omits** the cumulative `message` and `assistantMessageEvent.partial` — clients assemble the live partial from `message_start` + subsequent deltas by `contentIndex`. `message_end.message` is authoritative.

**For TTFT/decode:** record `message_start` arrival time as `stepStartTime`; the first `text_delta` (or `thinking_delta`) arrival as `firstTokenTime`; `message_end` arrival as `completedTime`. This is exactly what DSH's `AssistantMetricDetail` needs.

### Event ordering (from `docs/extensions.md` lifecycle)

```
prompt → before_agent_start → agent_start
  → (turn loop while LLM calls tools)
    → turn_start → context → before_provider_headers → before_provider_request → after_provider_response
      → message_start / message_update / message_end
      → tool_execution_start → tool_call (can block) → tool_execution_update → tool_result → tool_execution_end
    → turn_end
  → agent_end → agent_settled
```

`auto_retry_*` and `compaction_*` fire around retries/compaction. `queue_update` fires when steering/followUp queue changes.

## 6. RPC mode — subprocess control

Source: `docs/rpc.md`, `dist/modes/rpc/rpc-client.d.ts`.

### Starting
```bash
pi --mode rpc [--provider <name>] [--model <pattern>] [-n <name>] [--no-session] [--session-dir <path>]
```

### Protocol
- **Commands** → stdin, one JSON object per line
- **Responses** → stdout, `{ type: "response", command, success, data?, id? }`
- **Events** → stdout, JSON lines (same events as SDK, see §5)
- Framing: **LF only**. Node `readline` is NOT protocol-compliant (splits on U+2028/U+2029). Split on `\n` only; strip optional trailing `\r`.

### Key commands (subset relevant to pi-Trajectory)
- `prompt` / `steer` / `follow_up` / `abort`
- `new_session` / `load_session` / `fork` / `clone`
- `get_state` → `{ model, thinkingLevel, isStreaming, isCompacting, steeringMode, followUpMode, sessionFile, sessionId, sessionName, autoCompactionEnabled, messageCount, pendingMessageCount }`
- `get_messages` → `{ messages: AgentMessage[] }`
- `set_model` / `cycle_model` / `get_available_models`
- `set_thinking_level` / `cycle_thinking_level`
- `bash` (direct, streams `bash_execution_update`)

### `RpcClient` (`rpc-client.d.ts:35`) — TypeScript client

```typescript
import { RpcClient } from "@earendil-works/pi-coding-agent"

const client = new RpcClient()
await client.start()                          // spawns `pi --mode rpc`
const unsub = client.onEvent((event) => {...})
await client.prompt("Hello")
await client.waitForIdle()
const state = await client.getState()
const msgs = await client.getMessages()
await client.stop()
```

Methods: `start()`, `stop()`, `onEvent(listener)`, `prompt(msg, images?)`, `steer(msg, images?)`, `followUp(msg, images?)`, `abort()`, `newSession(parentSession?)`, `getState()`, `setModel(provider, modelId)`, `cycleModel()`, `getAvailableModels()`, `setThinkingLevel(level)`, `cycleThinkingLevel()`, `getMessages()`, `waitForIdle()`, `promptAndWait(msg, images?, timeout?)` (returns all events), `getStderr()`.

### Extension UI sub-protocol

In RPC mode, `ctx.ui.select/confirm/input/editor` emit `extension_ui_request` on stdout and block until the client sends `extension_ui_response` on stdin with matching `id`. pi-Trajectory (read-only) can ignore these, but if it ever drives the agent it must handle them. See `docs/rpc.md` "Extension UI Protocol" and `examples/rpc-extension-ui.ts`.

## 7. Extensions — the event interception layer

Source: `docs/extensions.md`, `examples/extensions/*`.

### Placement
- Global: `~/.pi/agent/extensions/*.ts`
- Project: `.pi/extensions/*.ts`
- CLI: `pi -e ./path.ts`
- Auto-discovered locations support `/reload`

### Shape
```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

export default function (pi: ExtensionAPI) {
  pi.on("event", async (event, ctx) => { ... })
  pi.registerTool({ ... })
  pi.registerCommand("name", { description, handler })
}
```

### Events relevant to pi-Trajectory (full list in `docs/extensions.md`)

Lifecycle: `project_trust`, `session_start`, `resources_discover`, `session_before_switch`, `session_before_fork`, `session_before_compact` / `session_compact`, `session_before_tree` / `session_tree`, `session_shutdown`, `session_info_changed`.

Agent: `before_agent_start` (can inject message + modify system prompt), `agent_start` / `agent_end` / `agent_settled`, `turn_start` / `turn_end`, `message_start` / `message_update` / `message_end` (can replace finalized message), `tool_execution_start` / `tool_call` (can block) / `tool_execution_update` / `tool_result` (can modify) / `tool_execution_end`.

Provider: `context` (modify messages pre-call), `before_provider_headers`, `before_provider_request`, `after_provider_response`.

Model: `model_select`, `thinking_level_select`.
User bash: `user_bash`.

### `ExtensionContext` (`ctx`) highlights
- `ctx.ui` — `select/confirm/input/editor/notify/setStatus/setWidget/setTitle/setEditorText/custom`
- `ctx.mode` — `"tui" | "rpc" | "json" | "print"`
- `ctx.hasUI` — true in TUI/RPC
- `ctx.cwd`, `ctx.isProjectTrusted()`
- `ctx.sessionManager` — **read-only** `SessionManager` access (synced through current assistant message before `tool_call` runs)
- `ctx.modelRegistry`, `ctx.model`, `ctx.thinkingLevel`, `ctx.scopedModels`
- `ctx.signal` — current agent abort signal (defined during turn events)
- `ctx.isIdle()`, `ctx.abort()`, `ctx.hasPendingMessages()`, `ctx.shutdown()`
- `ctx.getContextUsage()`, `ctx.compact()`, `ctx.getSystemPrompt()`

### `ExtensionAPI` (`pi`) highlights
- `pi.on(event, handler)`
- `pi.registerTool(definition)`, `pi.setActiveTools()`, `pi.getAllTools()`
- `pi.sendMessage(message, options?)` — inject custom message (in context)
- `pi.sendUserMessage(content, options?)`
- `pi.appendEntry(customType, data?)` — durable, NOT in context
- `pi.setSessionName(name)`, `pi.getSessionName()`, `pi.setLabel(entryId, label)`
- `pi.registerCommand(name, options)`, `pi.getCommands()`
- `pi.registerMessageRenderer(customType, renderer)` — TUI rendering for custom messages
- `pi.registerMarkdownTransformer(transformer)`
- `pi.registerEntryRenderer(customType, renderer)` — TUI rendering for custom entries
- `pi.registerProvider(name, config)` — dynamic model provider
- `pi.events` — inter-extension event bus (`on`/`emit`)

### Why this matters for pi-Trajectory

**[design]** pi-Trajectory does NOT need to be a pi extension to do replay (it just reads JSONL). But for **live mode**, two options:
1. **SDK in server** — `createAgentSession` + `subscribe`. Cleanest, in-process. No extension needed.
2. **Extension that emits to a local server** — a pi extension that subscribes to events and POSTs them to the pi-Trajectory server over HTTP. This lets a **running interactive pi** feed Trajectory without the user launching pi through Trajectory's server. This is the "attach to a live session" path and is worth considering for v2.

## 8. Exported symbols pi-Trajectory will import

From `dist/index.d.ts` (confirmed):
- `createAgentSession`, `createAgentSessionRuntime`, `createAgentSessionServices`, `createAgentSessionFromServices`
- `AgentSession`, `AgentSessionEvent`, `AgentSessionEventListener`, `AgentSessionConfig`, `PromptOptions`
- `SessionManager`, `SessionEntry`, `SessionHeader`, `SessionInfo`, `SessionMessageEntry`, `CompactionEntry`, `BranchSummaryEntry`, `CustomEntry`, `CustomMessageEntry`, `LabelEntry`, `SessionInfoEntry`, `ModelChangeEntry`, `ThinkingLevelChangeEntry`, `SessionTreeNode`, `SessionContext`, `FileEntry`, `CURRENT_SESSION_VERSION`
- `parseSessionEntries`, `loadEntriesFromFile`, `buildContextEntries`, `buildSessionContext`, `migrateSessionEntries`, `getLatestCompactionEntry`, `sessionEntryToContextMessages`, `findMostRecentSession`, `getDefaultSessionDir`
- `ModelRuntime`, `ModelRegistry`, `getModel` (from pi-ai), `resolveCliModel`, `resolveModelScopeWithDiagnostics`
- `RpcClient`, `RpcClientOptions`, `RpcEventListener`, `RpcResponse`, `RpcSessionState`, `JsonAgentSessionEvent`
- `convertToLlm` — `AgentMessage[]` → `Message[]` (LLM-compatible)
- `serializeConversation`, `estimateTokens`, `calculateContextTokens`
- `Theme` (TUI theme — not needed for web)
- Tool factories: `createBashTool`, `createReadTool`, `createEditTool`, `createWriteTool`, `createGrepTool`, `createFindTool`, `createLsTool`, `createCodingTools`, `createReadOnlyTools`
- Type guards: `isToolCallEventType`, `isBashToolResult`, etc.

### Types from `@earendil-works/pi-agent-core`
- `AgentMessage`, `AgentEvent`, `Agent`, `AgentState`, `AgentTool`, `AgentToolResult`
- `ToolCall`, `ToolResultMessage` (re-exported via pi-ai)

### Types from `@earendil-works/pi-ai`
- `UserMessage`, `AssistantMessage`, `Usage`, `TextContent`, `ImageContent`, `ThinkingContent`, `Model`, `Message`
- `getModel`, `createProvider`, `openAICompletionsApi`

## 9. Node version + ESM

- pi requires Node `^22.19 || >=24` (from DSH AGENTS.md; pi's own engines similar).
- ESM only (`"type": "module"`). pi-Trajectory server should be ESM.
- The pi SDK is imported as `@earendil-works/pi-coding-agent` — installed as a normal npm dep.

## 10. Auth + models

`ModelRuntime.create()` restores cached catalogs without network by default. Opt into network refresh:
```typescript
const runtime = await ModelRuntime.create({ allowModelNetwork: true, modelRefreshTimeoutMs: 15_000 })
```
Auth resolution: runtime overrides → `auth.json` → env vars (`ANTHROPIC_API_KEY`, etc.) → fallback resolver. Set `PI_OFFLINE` to disable model network access.

For pi-Trajectory **replay**, no model/auth is needed — it reads files. For **live SDK mode**, the server needs the same auth the user's pi has (it reads the same `~/.pi/agent/auth.json`).
