# Open Gaps and Questions

Two real gaps where pi doesn't expose what DSH Trajectory consumes, plus unresolved design decisions. The user's stance is "what we don't have we can add" — so each gap includes a concrete path to close it by adding to pi (an extension or an SDK contribution), not just a workaround.

## Gap 1: Per-request system prompt + diff

**What DSH has:** system-prompt state is a versioned event stream. Each request header carries the effective prompt + the change since the previous one. The inspector's `System Prompt` and `Diff` tabs render this. A SYSTEM record marks when the prompt changed.

**What pi has:** the system prompt is built per call from `before_agent_start` / `systemPromptOptions` (`docs/extensions.md` `before_agent_start`). It is **not** persisted to the session JSONL as an entry, and there is no `system_prompt_change` event in `AgentEvent` / `AgentSessionEvent` (`02-pi-reference.md` §5). `ctx.getSystemPrompt()` returns the current string but nothing logs its history.

**v1 behavior:** no `system` records; `promptDetail` empty; `System Prompt` and `Diff` tabs show an empty state: "pi does not log per-request system prompts." Mark with `TODO(v1)`.

**Path to close it (add to pi):**

Option A — **pi extension that logs prompt snapshots** (no pi core change):
- A `~/.pi/agent/extensions/trajectory-prompt-log.ts` extension.
- `pi.on("before_agent_start", (event, ctx) => { ... })` — read `event.systemPrompt` + `event.systemPromptOptions`; compute a diff against the last logged prompt; `pi.appendEntry("trajectory-prompt", { provider, modelId, promptHash, prompt, previousPromptHash, diff })` via `pi.appendEntry`.
- The replay projection then reads `CustomEntry{customType:"trajectory-prompt"}` entries and emits `system` records with `promptDetail` + `previousPromptDetail`.
- Cost: an extra entry per assistant request. Hash-gated so no entry is written when the prompt is unchanged.
- This keeps pi core untouched and makes prompt logging opt-in (install the extension). It fits "Trajectory For All" — the extension ships with pi-Trajectory and users drop it in `~/.pi/agent/extensions/`.

Option B — **contribute a `system_prompt_change` event + entry to pi core**:
- Add `SystemPromptChangeEntry` to `session-manager.ts` and a `system_prompt_change` event to `AgentSessionEvent`.
- Larger change, upstream PR to pi-mono. Higher fidelity (no extension needed) but depends on pi maintainers.

**Recommendation:** Option A first (ships now, no upstream dependency); revisit Option B if pi maintainers want it native. **[decision needed]**.

## Gap 2: Per-call tool schemas

**What DSH has:** each request header carries the tool catalog sent to the model; `callSchemas` maps `callId` → the exact schema the model saw for that call. The inspector `Schema` tab shows it.

**What pi has:** tool definitions are static (registered at startup via `pi.registerTool` / built-in factories). `AgentTool` objects live in `agent.state.tools` but are **not** persisted per-call in the JSONL. The `tool_execution_*` events carry `toolName` + `args`, not the schema.

**v1 behavior:** `schemaDetail` is resolved from the **static** built-in catalog (`bash`, `read`, `edit`, `write`, `grep`, `find`, `ls`) by `toolName`. Custom/extension tools won't resolve → empty state. This is correct for built-in tools (their schemas don't change) and a reasonable approximation for custom tools (show the current schema, not the historical one). Mark with `TODO(v1)`.

**Path to close it (add to pi):**

Option A — **same extension as Gap 1** logs the active tool catalog:
- In `before_agent_start`, snapshot `event.systemPromptOptions.selectedTools` + their schemas → `pi.appendEntry("trajectory-tool-catalog", { tools: [...] })`.
- Replay pairs the nearest preceding catalog entry with each tool call.
- Cost: one entry per prompt change (hash-gated). Custom tools captured.

Option B — **contribute per-call schema to the `tool_execution_start` event** upstream:
- Add an optional `schema` field to the `tool_execution_start` event + `ToolCall` block.
- Upstream PR; higher fidelity but depends on pi maintainers.

**Recommendation:** Option A first (same extension, same ship-now logic). **[decision needed]**.

## Unresolved design decisions

### D1. Replay `startedAt` / duration approximation

Replay has no per-delta timing (data model §5). Options:
- **(a) Leave `timeSeconds = null`, `startedAt = null`** — honest, Overview shows completion markers only in duration/actual modes. Sequence mode still works. Matches DSH's "in-flight time stays blank" ethos.
- **(b) Approximate `startedAt`** from the prior record's `completedAt` (or timestamp) — gives fake durations that look like a timeline but aren't real wall-clock.

**Recommendation:** (a) for v1. Approximation risks looking authoritative when it's a guess. If users want a timeline in replay, the Gap-1-style extension can log real `message_start`/`message_end` times for future sessions. **[decision needed]**.

### D2. Live mode source: SDK vs RPC

- **SDK (`createAgentSession` in server)** — in-process, direct `sessionManager` access for reconciliation, no subprocess framing. Server loads the full pi runtime.
- **RPC (`RpcClient` spawn)** — pi runs as a subprocess; server forwards events. Cleaner isolation; server doesn't load pi runtime; user's env/auth are pi's problem. But subprocess lifecycle + the LF-only framing quirk + extension-UI sub-protocol to handle if driving.

**Recommendation:** SDK-live for v2 first (cleaner, direct reconciliation). Add rpc-live if isolation is wanted. **[decision needed]** but not blocking v1.

### D3. Shared types package vs duplicate

- **`shared/` workspace** — one source of truth for `TrajectorySnapshot`; both `server` and `web` depend on it. DRY.
- **Duplicate in `web/src/lib/types.ts`** — web is more obviously pi-free; types drift risk.

**Recommendation:** `shared/` workspace containing only the snapshot types (no pi imports). Keeps web pi-free via a clean boundary while sharing one definition. **[decision needed]**.

### D4. HTTP framework

- **`hono`** — lightweight, ESM, TypeScript-native, fits "lightweight server."
- **Express** — familiar, heavier.
- **Node raw `http`** — zero deps, more code.

**Recommendation:** hono. Aligns with the stack and the "lightweight" framing. **[decision needed]**.

### D5. Session picker scope

- List all sessions across all projects (`SessionManager.listAll`) — "Trajectory For All."
- Scope to a cwd (`SessionManager.list(cwd)`) — needs a project picker first.

**Recommendation:** list all, with a cwd filter UI (facet). Matches the vision. **[decision needed]**.

### D6. Does v1 need the `diff` npm dep?

DSH uses `diff` (`structuredPatch`) for the SYSTEM-update `diff` tab. If Gap 1 ships via the extension, the `diff` tab renders real diffs and we need `diff`. If Gap 1 is deferred, the tab is empty and `diff` can wait.

**Recommendation:** add `diff` when Gap 1 Option A is implemented; not a v1 dependency otherwise. **[decision needed]**.

## Questions for Ken (to confirm before implementation)

1. **Gap 1 + 2 approach:** ship the logging extension (Option A) alongside v1, or defer to v2 and ship v1 with the empty states? The extension is small and makes v1 immediately richer.
2. **Replay timing (D1):** honest nulls, or approximate? My rec: honest nulls.
3. **Live source (D2):** SDK first? (Not blocking v1.)
4. **Shared types (D3):** `shared/` workspace, yes?
5. **HTTP framework (D4):** hono, yes?
6. **Picker scope (D5):** all sessions + cwd facet, yes?
7. **Theme:** match DSH's token roles in Tailwind, or define a fresh pi-Trajectory visual identity? My rec: start with DSH roles (proven), diverge later if desired.

## What is NOT a gap (confirmed available)

For completeness — these were verified present in pi and need no addition:
- Turn/step boundaries → derivable from message order (data model §5). Not a gap; just not pre-numbered.
- Tool call ↔ result pairing → `toolCallId` is on both. Not a gap.
- Usage/cost → `AssistantMessage.usage` + compaction `usage`. Not a gap.
- Compaction → `CompactionEntry` + `compaction_start/end`. Not a gap.
- Steering/follow-up → `queue_update` + `CustomMessage` reminders. Not a gap.
- Model/thinking changes → `ModelChangeEntry` / `ThinkingLevelChangeEntry` + events. Not a gap.
- Bash executions → `BashExecutionMessage`. Not a gap.
- Branch summaries → `BranchSummaryEntry`. Not a gap.
- Session tree → `getTree()`. Not a gap (v1 just doesn't render it).
- Live event stream → `AgentSession.subscribe` / RPC events. Not a gap (v2).
