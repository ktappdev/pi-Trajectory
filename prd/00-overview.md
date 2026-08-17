# Pi Trajectory — Overview

Pi Trajectory is a browser-based inspection surface for [pi](https://github.com/earendil-works/pi-mono), the coding agent CLI by Earendil Works. It renders a turn-aware event ledger — user prompts, assistant responses, tool calls, tool results, compactions, steering messages, model changes — with an interactive timing overview and a local inspector for payloads, usage, and timing.

It is a direct port of the **Trajectory** feature from DeepSeek Harness (`@deepseek-ai/dsh-client-ui-trajectory`) — both the data model and the UI — adapted to pi's runtime seams and message/entry types.

## Vision: Trajectory For All (for pi)

One phrase: **"Trajectory For All."** The DSH Trajectory UX is excellent — dense, virtualized, timing-aware, inspectable — and it shouldn't be locked inside one product. pi-Trajectory brings that inspection experience to **every pi session**: any project, any provider, any model, past or live. Anyone running pi gets a visual record of what their agent did, in a browser, with zero coupling to a specific harness.

Scope is pi (not a generic multi-agent framework). But the architecture — a stage-oriented snapshot fed by a pluggable source — is deliberately source-agnostic so the same view could later target other agent logs.

## Goal

Give pi a visual, inspectable record of what the agent did during a session: every turn, every tool call, every token cost, every compaction, every model switch — rendered in a browser, fed by a lightweight local server. Port DSH's UI components and interaction model, not just the concept.

## Non-goals (v1)

- Not a replacement for the pi TUI. Read-only inspection, not a new chat interface.
- Not a multi-user or remote-hosted product. Local first; one user, one machine.
- No editing of session history. Tree branching/labeling is display-only in v1.
- No model-visible output. Like DSH Trajectory, nothing here reaches a model request.

## Two delivery modes

The same browser view, fed by two snapshot sources:

1. **Replay mode (v1, ship first).** Parses pi session JSONL files from `~/.pi/agent/sessions/`. No live agent, no subprocess. A static Vite + React app backed by a tiny server that reads session files and serves them as a Trajectory snapshot. ~80% of the visual value, zero coupling to a running pi.

2. **Live mode (v2).** A Node server that either (a) imports pi's SDK (`createAgentSession`) and subscribes to events, or (b) spawns `pi --mode rpc` and forwards JSONL events. Projects events into the same Trajectory snapshot shape and pushes over WebSocket to the same React view.

Both modes share the React components and the snapshot data model. The only difference is the snapshot source.

## Why this is feasible

Pi already exposes nearly everything DSH Trajectory consumes:

| DSH Trajectory concept | Pi equivalent | Status |
|---|---|---|
| Session log (events) | `~/.pi/agent/sessions/**/*.jsonl` (tree, v3) | ✅ exists |
| Turn boundary | `turn_start` / `turn_end` events | ✅ exists |
| Assistant record + usage/timing | `AssistantMessage` (`usage`, `timestamp`, `provider`, `model`, `stopReason`) | ✅ exists |
| TTFT vs decoding split | derivable from `message_update` deltas + `message_end` | derivable |
| Tool record | `tool_execution_start/update/end` (`toolCallId`, `toolName`, `args`, `result`, `isError`) | ✅ exists |
| Compaction | `compaction_start/end` events + `CompactionEntry` in JSONL | ✅ exists |
| Steering / queue | `queue_update` (steering, followUp arrays) | ✅ exists |
| Model change | `ModelChangeEntry` + `model_select` event | ✅ exists |
| Thinking level change | `ThinkingLevelChangeEntry` + `thinking_level_select` | ✅ exists |
| Bash execution (! / !!) | `BashExecutionMessage` in JSONL | ✅ exists |
| Custom / extension messages | `CustomMessage`, `CustomEntry` | ✅ exists |
| Branch summary | `BranchSummaryEntry` / `BranchSummaryMessage` | ✅ exists |
| Prompt-diff / system-prompt change per request | **gap** — system prompt logged at build, not as versioned event stream | ⚠️ approximate |
| Per-request tool schemas | **gap** — schemas are static tool defs, not logged per call | ⚠️ show current catalog |

See `02-pi-reference.md` for the exact pi types, and `03-data-model.md` for the full mapping.

## Repo layout (target)

```
pi-Trajectory/
  prd/                      ← this folder
  server/                   ← Node server (replay + live), TypeScript, ESM
    src/
      replay/               ← JSONL parser → TrajectorySnapshot
      live/                 ← SDK subscriber / RPC bridge → TrajectorySnapshot
      http/                 ← REST + WebSocket endpoints
  web/                      ← Vite + React + Tailwind frontend
    src/
      components/           ← TrajectoryTable, TrajectoryTimeline, Inspector, Toolbar
      lib/                  ← snapshot types, layout, timeline, virtual-rows, search
  package.json              ← pnpm workspace root
```

Tech stack defaults (per Ken's preferences): **pnpm, Vite, React, Tailwind, TypeScript**. Zustand + React Query if state management needs grow. No Pocketbase/Clerk needed for a local-first inspection tool.

## Document index

- `00-overview.md` — this file
- `01-dsh-trajectory-reference.md` — what the DSH Trajectory feature is and does (the inspiration)
- `02-pi-reference.md` — pi platform facts: session format, SDK, RPC, extensions, message/entry types
- `03-data-model.md` — the TrajectorySnapshot shape and the pi → snapshot mapping
- `04-architecture.md` — server + web architecture, data flow, complexity
- `05-mvp-scope.md` — what v1 (replay) ships and explicitly skips
- `06-implementation-plan.md` — phased build order with file-level tasks
- `07-open-gaps-and-questions.md` — the two real gaps + unresolved decisions

## Source of facts

Everything in these docs is grounded in:
- pi installed at `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/` (v0.84.2)
- pi docs: `docs/session-format.md`, `docs/sdk.md`, `docs/rpc.md`, `docs/extensions.md`
- pi type definitions: `dist/core/session-manager.d.ts`, `dist/core/agent-session.d.ts`, `dist/core/messages.d.ts`, `@earendil-works/pi-agent-core/dist/types.d.ts`
- pi examples: `examples/sdk/*`, `examples/extensions/*`
- DSH Trajectory package: `packages/client/ui-trajectory/` (read during research)
- DSH agent notes: `.agents/notes/implemented/feature/2026-07-27-trajectory-inspection-ledger.md`, `.agents/notes/implemented/architecture/2026-08-11-trajectory-conversation-context-assembly.md`

Where a fact comes from pi source/docs, the doc cites the file. Where something is a design choice for this project (not a pi fact), it is marked **[design]**.
