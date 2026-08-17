# Architecture

Server + web, ESM, TypeScript. Two snapshot sources (replay, live) feeding one UI through one `TrajectorySnapshot` contract.

## High-level

```
┌─────────────────────────────────────────────────────────────┐
│ Browser (web/) — Vite + React + Tailwind                     │
│                                                              │
│  TrajectoryView                                             │
│    ├─ TrajectoryToolbar (fold, search, duration)            │
│    ├─ TrajectoryTimeline (Overview, 3 lanes, drag-focus)    │
│    └─ TrajectoryTable (virtualized ledger + Inspector)      │
│                                                              │
│  data source: Zustand store / React Query                   │
│    ├─ replay:  GET /api/sessions/:id  → TrajectorySnapshot  │
│    └─ live:    WS /api/sessions/:id/live → TrajectorySnapshot│
└─────────────────────────────────────────────────────────────┘
                            │
                            │  HTTP / WebSocket (JSON)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Server (server/) — Node, ESM, TypeScript                     │
│                                                              │
│  http/                                                       │
│    ├─ GET  /api/sessions          → SessionInfo[]            │
│    ├─ GET  /api/sessions/:id      → TrajectorySnapshot       │
│    ├─ GET  /api/sessions/:id/raw  → FileEntry[] (debug)      │
│    └─ WS   /api/sessions/:id/live → subscribe to live feed   │
│                                                              │
│  replay/                                                     │
│    └─ buildReplaySnapshot(sessionFile): TrajectorySnapshot   │
│         ├─ loadEntriesFromFile (pi)                          │
│         ├─ buildContextEntries (pi, active branch)           │
│         └─ project → TrajectoryRecord[] + requests           │
│                                                              │
│  live/                                                       │
│    ├─ sdk-live.ts   (createAgentSession + subscribe)         │
│    └─ rpc-live.ts   (RpcClient spawn + onEvent)              │
│         └─ event → mutate in-memory snapshot → WS push       │
└─────────────────────────────────────────────────────────────┘
                            │
                            │  reads / spawns
                            ▼
                   pi (SDK import or `pi --mode rpc`)
                   ~/.pi/agent/sessions/**/*.jsonl
```

## The snapshot contract is the seam

`TrajectorySnapshot` (see `03-data-model.md`) is the only thing that crosses the server↔browser boundary. Consequences:

- **Replay and live share the UI.** The browser does not know which mode it's in; it just renders snapshots.
- **The browser never imports pi.** `@earendil-works/pi-coding-agent` is a server-only dependency. The web bundle stays small and pi-version-independent.
- **Live updates are snapshot replacements, not event patches.** The server holds the canonical in-memory snapshot for a live session; each event mutates it; the server pushes the full snapshot (or a diff — see below) over WS. This mirrors DSH's "stage-oriented snapshot, not raw events."

**[design] Full-snapshot vs diff over WS:** v1 pushes the full snapshot on each change, coalesced to one push per animation frame (20ms minimum, mirroring DSH's `SEARCH_INDEX_THROTTLE_MS`-style coalescing — actually DSH coalesces publication to ≤ once/animation frame). For a single session this is fine (snapshots are small: a few hundred records). Optimize to diffs only if profiling shows a problem. State this as a known ceiling with an upgrade path, like DSH does.

## Server: replay mode

```
server/src/replay/buildReplaySnapshot.ts
  input:  sessionFile path
  output: TrajectorySnapshot
```

Steps:
1. `loadEntriesFromFile(sessionFile)` → `FileEntry[]` (pi export).
2. `buildContextEntries(entries, leafId)` → active branch `SessionEntry[]` (pi export). Leaf defaults to the file's current leaf (`getLeafEntry` equivalent — for a closed file, the last entry).
3. Walk entries in order, maintaining turn/step/model/thinking state, projecting each to `TrajectoryRecord`(s) per the mapping in `03-data-model.md`.
4. Build `requests` (one per assistant message + one per compaction), numbered globally.
5. Accumulate `cumulativeUsage`.
6. `partial = null`, `runningTools = []`, `steering = []`, `followUp = []`, `hasOlderRecords = false`.

**No pi SessionManager instance needed** — `loadEntriesFromFile` + `buildContextEntries` are free functions. This keeps replay stateless and cheap.

### Session listing

`server/src/replay/listSessions.ts`:
- `SessionManager.listAll()` → all sessions across all projects (or scope to a cwd with `SessionManager.list(cwd)`).
- Map each `SessionInfo` to a list item: `{ path, id, cwd, name, created, modified, messageCount, firstMessage, provider/model hint }`.
- The browser's session picker renders this.

**[design]** v1 lists all sessions (`listAll`). A cwd filter is a trivial add later.

## Server: live mode

Two implementations behind one interface:

```typescript
interface LiveSource {
  /** Current snapshot (mutated in place by events). */
  snapshot(): TrajectorySnapshot
  /** Subscribe to snapshot changes (coalesced). */
  onChange(listener: (snapshot: TrajectorySnapshot) => void): () => void
  /** Tear down the agent session / rpc client. */
  dispose(): void
}
```

### `sdk-live.ts` — in-process (preferred for "launch from Trajectory")

```typescript
import { createAgentSession, SessionManager, ModelRuntime } from "@earendil-works/pi-coding-agent"

// Create or resume a session
const { session } = await createAgentSession({
  sessionManager: SessionManager.open(sessionFile),   // or .create(cwd) for new
  modelRuntime: await ModelRuntime.create(),
})
session.subscribe((event) => projectEvent(event, snapshot))   // mutate in-memory snapshot
```

`projectEvent` maps each `AgentSessionEvent` to snapshot mutations per `03-data-model.md` §5 + the live timing capture. On `agent_settled`, reconcile from `session.sessionManager.buildContextEntries()` to catch anything the event stream missed (defensive; the event stream should be complete).

**Session replacement:** if the user switches sessions via the UI, use `AgentSessionRuntime` (see `02-pi-reference.md` §4) and **re-subscribe** to the new `runtime.session`.

### `rpc-live.ts` — arm's length (preferred for "use installed pi as-is")

```typescript
import { RpcClient } from "@earendil-works/pi-coding-agent"
const client = new RpcClient()
await client.start()
client.onEvent((event) => projectEvent(event, snapshot))
```

Same `projectEvent`, different event source. No in-process agent; pi runs as a subprocess. Useful when you don't want to load the SDK's full runtime in the server, or when the user's pi has env/auth setup the server shouldn't replicate.

**[design]** v1 live mode: pick **one**. SDK-live is cleaner (no subprocess framing quirks, direct `sessionManager` access for reconciliation). Ship SDK-live first; add rpc-live as an alternative if subprocess isolation is wanted.

### Coalescing + WS push

```
event arrives → projectEvent mutates snapshot → schedulePush()
schedulePush: if (!pending) pending = setTimeout(flushPush, 16ms)
flushPush: listeners.forEach(l => l(snapshot)); pending = null
```

16ms ≈ one animation frame. This is DSH's "at most once per animation frame" publication rule.

## Server: HTTP

Minimal. Use whatever's already in the stack — **[design]** `hono` (lightweight, ESM, TypeScript-native) is a good fit and aligns with "lightweight server." No Express unless there's a reason.

```
GET  /api/sessions                  → SessionListItem[]
GET  /api/sessions/:id              → TrajectorySnapshot          (replay)
GET  /api/sessions/:id/raw          → FileEntry[]                 (debug, optional)
WS   /api/sessions/:id/live         → TrajectorySnapshot stream   (live)
POST /api/sessions/:id/prompt       → { ok }                      (live, optional drive)
```

`:id` = session file path (URL-encoded) or a short id resolved against `SessionManager.listAll()`.

**Static serving:** the server also serves the built `web/dist` at `/` so the whole thing is one process. `vite dev` proxies `/api` to the server during development.

## Web: state management

**[design]** Zustand for the snapshot + UI state (selection, fold, search, timeline). React Query is overkill for a single-snapshot view but fine if session listing/prefetching wants it. Start with Zustand + plain fetch/WS; add React Query only if caching needs grow.

```typescript
// web/src/store.ts
interface TrajectoryStore {
  snapshot: TrajectorySnapshot | null
  selectedRecordId: string | null
  collapsedTurns: Set<number>
  collapsedAssistants: Set<string>
  timelineSelection: TrajectoryTimeRange | null
  actualDuration: boolean
  searchQuery: string
  // actions...
}
```

The snapshot arrives via fetch (replay) or WS (live) and replaces `state.snapshot`. Selection/fold/search live in the store and survive snapshot replacement (they key by stable id, not index — see `08-ui-porting-guide.md`).

## Web: routing

```
/                          → session picker (lists all sessions)
/s/:sessionId              → TrajectoryView for one session (replay)
/s/:sessionId/live         → TrajectoryView, WS live mode
```

`react-router` or a tiny custom router. **[design]** `react-router-dom` v6+ is fine; it's already in the React ecosystem Ken uses.

## Complexity bounds (state honestly, like DSH)

| Path | Cost |
|---|---|
| Replay snapshot build | O(E) where E = entries on the active branch. One walk, one projection. No re-scan per record. |
| Live event projection | O(1) per event for append/update; O(E) on `agent_settled` reconciliation (rare). |
| WS push | O(snapshot size) per push, coalesced to ≤ 1/16ms. Snapshot is O(records) — a few hundred typically. |
| UI layout (`deriveTrajectoryLayout`) | O(records). Runs on each snapshot. |
| UI virtualization | O(visible rows + overscan). Mounts ~12–30 rows regardless of record count. |
| Search index update | O(records) signature pass; expensive Markdown normalization only for changed records (port DSH's `TrajectorySearchIndex`). |

**Not claimed:** end-to-end O(1) updates. The retained layout walk is O(records) per snapshot. This matches DSH's honest stance. Optimize only if profiling on real long sessions shows a problem.

## Security + trust boundaries

- **Local only.** Server binds to `127.0.0.1` (or `localhost`). Do not expose on `0.0.0.0` without auth. **[design]** v1 binds loopback; a `--host` flag + auth is a later, explicit decision.
- **Read-only replay** has no agent control surface — no prompt injection risk from the UI.
- **Live mode** that can `prompt`/`steer` is a trust boundary: the browser → server → agent path must validate inputs. v1 live is observation-only (subscribe); drive-the-agent (`POST /prompt`) is v2 and needs a confirmation surface.
- **Session file paths** from the browser are a path-traversal surface. Resolve `:id` against `SessionManager.listAll()` and reject paths not under `~/.pi/agent/sessions/`. Never `readFileSync` a raw browser-supplied path.

## Failure modes

- **Corrupt/old JSONL:** `migrateSessionEntries` runs on load; if parse fails, return a snapshot with an error header and empty records. Don't crash the server.
- **Missing session file:** 404 from the listing path; the picker shows it as unavailable.
- **Live agent crash:** WS closes; the browser shows the last snapshot with a "disconnected" banner. `getStderr()` (rpc) or the SDK error surfaces in the banner.
- **Huge session (10k+ entries):** v1 loads the full active branch. If this is slow, add backward paging (port DSH's tail-first paging) — but only when needed. State the ceiling.

## Why this architecture (vs alternatives)

- **Not a pi extension.** An extension would tie Trajectory to a running pi and force TUI-context constraints. A standalone server reads the same JSONL any extension can read, and can attach to live sessions via SDK/RPC without being loaded *inside* pi. This matches "Trajectory For All" — works on any session, running or not.
- **Not a static site only.** A pure static site can't do live mode. The server is small but necessary for WS + SDK.
- **Not two apps.** One UI, one snapshot contract, two sources. Splitting replay and live into separate UIs would duplicate the ported DSH components.
- **Server builds the snapshot, not the browser.** Keeps pi types out of the browser bundle and the projection logic in one place (testable in Node, no DOM needed).
