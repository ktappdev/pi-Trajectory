# Implementation Plan

Phased build order. Each phase ends with something runnable. v1 = replay (see `05-mvp-scope.md`); v2 = live.

## Phase 0 — Scaffold (half day)

```
pi-Trajectory/
  package.json          ← pnpm workspace root, "type": "module", scripts: dev, build, typecheck
  pnpm-workspace.yaml   ← packages: server, web
  tsconfig.base.json    ← strict, ESM, NodeNext
  server/
    package.json        ← deps: @earendil-works/pi-coding-agent, hono, tsx
    tsconfig.json
    src/index.ts        ← entry: start HTTP server (hono) + static serve
  web/
    package.json        ← deps: react, react-dom, react-router-dom, zustand, @tanstack/react-virtual, tailwindcss, vite
    tsconfig.json
    vite.config.ts      ← proxy /api → server, /ws → server
    index.html
    src/main.tsx        ← router mount
    src/index.css       ← Tailwind + @layer for virtualizer spacers
    tailwind.config.ts  ← theme tokens (mirroring DSH roles — see 08-ui-porting-guide.md)
```

**Done when:** `pnpm dev` starts both server (stub `/api/sessions` → `[]`) and Vite; `http://localhost:5173` loads a blank page without errors.

## Phase 1 — Shared types + replay projection (1–2 days)

`server/src/types.ts` — copy the `TrajectorySnapshot` + `TrajectoryRecord` + `TrajectoryRequest` + in-flight types from `03-data-model.md`. These are the contract; both server and web import them (export from a shared `shared/` package or a `shared/types.ts` that both workspaces depend on — **[design]** a `shared/` workspace package is cleanest, avoids duplicating types).

**Decision point:** shared workspace package (`pi-trajectory-shared`) vs duplicating types in `web/src/lib/types.ts`. Shared is DRY; duplicating keeps web pi-free more obviously. **[design]** use a `shared/` workspace — it contains *only* the snapshot types, no pi imports, so web stays pi-free while sharing one source of truth.

`server/src/replay/listSessions.ts`:
- `SessionManager.listAll()` → `SessionListItem[]` (path, id, cwd, name, created, modified, messageCount, firstMessage).
- Sort by modified desc.

`server/src/replay/buildReplaySnapshot.ts`:
- `loadEntriesFromFile` → `buildContextEntries` (default leaf = last entry) → walk + project.
- Implement the turn/step derivation (data model §5).
- Implement the entry→record mapping table (data model §5).
- Implement tool-call↔result pairing by `toolCallId`.
- Implement `requests` numbering + `cumulativeUsage`.
- `partial = null`, `runningTools = []`, `steering/followUp = []`, `hasOlderRecords = false`.
- Resolve `schemaDetail` from the static tool catalog (import pi tool factories or call `getAllTools()` equivalent — **[design]** for replay, since there's no running agent, derive schemas from the known built-in tool names: `bash`, `read`, `edit`, `write`, `grep`, `find`, `ls`. Map `toolName` → schema. Custom/extension tools won't resolve; empty state.)

`server/src/replay/record-summary.ts`:
- `summarize(record)` — single-line summaries per kind (user: first line of content; assistant: first text block; tool: `toolName {args preview} → result preview`; compaction: `Compacted N tokens`; model-change: `provider/modelId`; etc.). Port DSH's preview logic where it exists.

**Tests (Node, vitest):**
- Fixture: a small hand-written JSONL with user/assistant/tool/compaction/model-change. Assert the snapshot's records/requests/cumulativeUsage.
- Fixture: a real session from `~/.pi/agent/sessions/` (copy one in). Assert no crash, sane counts.
- Path-traversal: `:id` outside sessions dir → rejected.
- Corrupt JSONL → error snapshot, no throw.

**Done when:** `GET /api/sessions` returns real sessions; `GET /api/sessions/:id` returns a well-formed `TrajectorySnapshot` for a real session; tests pass.

## Phase 2 — Web shell + session picker (half day)

`web/src/main.tsx` — `react-router-dom` with `/` and `/s/:sessionId`.
`web/src/api.ts` — `fetchSessions()`, `fetchSnapshot(id)`.
`web/src/pages/SessionPicker.tsx` — searchable list (filter by cwd/name/firstMessage). Sort by modified. Click → navigate to `/s/:id`.
`web/src/store.ts` — Zustand store skeleton (snapshot, selection, fold, search, timeline).

**Done when:** picker lists real sessions; clicking one navigates to `/s/:id` (page renders "loading" then the snapshot fetch resolves — even if TrajectoryView is a stub for now).

## Phase 3 — Port DSH lib logic (1 day)

Port these verbatim (retyping only), from `packages/client/ui-trajectory/src/client/` → `web/src/lib/`:

- `record.ts` ← `trajectory-record.ts` — `TrajectoryRecord` is already pi-native (shared types); port `trajectoryRecordId`, `formatDurationMillis`, `formatElapsedSeconds`.
- `layout.ts` ← `layout.ts` — `deriveTrajectoryLayout`, `appendTrajectoryPartialLayout`. Retype `TrajectoryLayoutInput` to take pi `TrajectorySnapshot.records` instead of DSH `ConversationSnapshot.nodes`. Keep the fold logic.
- `timeline.ts` ← `timeline.ts` — `deriveTrajectoryTimeline`, `trajectoryTimelineFocusIndexes`, `TrajectoryTimelineMode`, `laneFor`.
- `virtual-rows.ts` ← `trajectory-virtual-rows.ts` — `groupTrajectoryVirtualRows`, `trajectoryVirtualRecordKey`, the height constants.
- `search-index.ts` ← `trajectory-search-index.ts` — `TrajectorySearchIndex`. Port the 3s throttle constant from `TrajectoryView.tsx`.

**Tests (vitest, jsdom not needed — these are pure):**
- `record.test.ts` — id rule priority.
- `layout.test.ts` — a flat record list groups into expected turns/steps.
- `timeline.test.ts` — sequence mode spans; timed mode with a couple of `startedAt` records.
- `virtual-rows.test.ts` — request-only records attach to next content row; terminal separator keeps its height.
- `search-index.test.ts` — update + search; changed-only normalization (port DSH's test if it exists).

**Done when:** all lib tests pass; the types line up with the shared snapshot types.

## Phase 4 — Port the components (2–3 days)

Port in dependency order. Each component: copy from DSH, strip plugin glue (`useSession`/`useDuration`/`TranslateNS`/`inject`), rebind to Zustand store + props.

1. `TrajectoryCell.tsx` ← one record row. Tailwind classes for the ~5 layout classes; inline the rest.
2. `TrajectoryGroupHeader.tsx`, `TrajectoryTurnHeader.tsx`, `TrajectoryTurn.tsx` — separators/headers.
3. `TrajectoryToolbar.tsx` — fold/search/duration. Wire to store actions.
4. `TrajectoryTimeline.tsx` — the Overview. Port the drag/zoom/pan/tooltip interaction. This is the most intricate; port carefully, test interaction with a small fixture.
5. `TrajectoryTable.tsx` — the ledger + virtualizer. Port `useVirtualizer` setup (constants from `08-ui-porting-guide.md`), `flattenRecords`, `filterRecords`, selection/focus orchestration. **Split the inspector out** into `Inspector.tsx` + `inspector-tabs/` per the porting guide.
6. `TrajectoryView.tsx` — top-level; owns fold/selection/search/timeline state in the Zustand store; composes Toolbar + Timeline + Table.

**CSS porting:** for each component, identify the ~5–20 classes that carry real layout/interaction (virtualizer spacers, scroll geometry, the `--trajectory-*` custom properties, scrollbar transparency) → put those in `index.css` `@layer`. Everything else → Tailwind utilities inline. Define theme tokens in `tailwind.config.ts` (see porting guide §CSS).

**Tests (vitest + jsdom or @testing-library/react):**
- `TrajectoryCell.test.tsx` — renders summary, kind tag, selected state.
- `TrajectoryTable.test.tsx` — virtualization mounts only visible rows (assert on rendered row count for a 300-record fixture); selection by id survives a snapshot replacement.
- `TrajectoryTimeline.test.tsx` — drag produces a `TrajectoryTimeRange`; focus indexes filter records.
- `Inspector.test.tsx` — tabs render correct content per kind; tab history restores recent tab.
- Accessibility snapshot: mirror DSH's `navigation-panes/trajectory.expected.md` — assert `role="toolbar"`, `role="tablist"`, `aria-pressed`, etc.

**Done when:** a real session renders the full TrajectoryView with working virtualization, selection, inspector, timeline drag-focus, search, and fold. Light + dark both look right.

## Phase 5 — Polish + gates (1 day)

- Empty states: no sessions, no records, corrupt session, missing file.
- Error banner: fetch failure, 404.
- Keyboard: Esc clears timeline selection; inspector split keyboard resize (`DETAILS_RESIZE_STEP`).
- Loading states: session list loading, snapshot loading.
- `pnpm typecheck` clean (strict).
- `pnpm lint` (eslint + the TS rules Ken likes — no `any`, etc.).
- Grep gate: `web/` has zero `@earendil-works/pi-` imports.
- README at repo root: how to run, what it does, the "Trajectory For All" framing.
- A `.pi/extensions/` note or README pointing at the future live extension (v2).

**Done when:** all v1 done criteria (`05-mvp-scope.md`) checked.

## Phase 6 — v2: Live mode (later, separate effort)

1. `server/src/live/sdk-live.ts` — `createAgentSession` + `subscribe` + `projectEvent` + coalesced push.
2. `WS /api/sessions/:id/live` — push snapshots.
3. `web/src/api.ts` — WS client; store subscribes and replaces `snapshot` on each message.
4. `projectEvent` — map `AgentSessionEvent` → snapshot mutations (data model §5 live timing).
5. In-flight `partial` + `runningTools` rows; tail-follow; streaming publication coalescing.
6. Reconcile on `agent_settled` from `sessionManager.buildContextEntries()`.
7. Disconnected banner on WS close.
8. Optional: `rpc-live.ts` as an alternative source.
9. Optional: `POST /api/sessions/:id/prompt` with a confirmation surface (drive the agent).

## Phase 7 — v2+: Gaps + nice-to-haves

- Tree view (abandoned branches) — `header.tree` is reserved; render with `getTree()`.
- Deep links to a record (`/s/:id/r/:recordId`).
- Per-request system prompt + diff — requires a pi extension that logs prompt snapshots (see `07-open-gaps-and-questions.md`).
- Per-call tool schemas — same, requires logging.
- i18n.
- cwd filter in picker.
- Backward paging for huge sessions.

## File-level task checklist (v1)

- [ ] `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`
- [ ] `shared/` workspace: `TrajectorySnapshot`, `TrajectoryRecord`, `TrajectoryRequest`, in-flight types
- [ ] `server/src/index.ts` — hono server, loopback, static serve
- [ ] `server/src/replay/listSessions.ts`
- [ ] `server/src/replay/buildReplaySnapshot.ts` — projection + turn/step derivation
- [ ] `server/src/replay/record-summary.ts`
- [ ] `server/src/replay/tool-schemas.ts` — static catalog lookup
- [ ] `server/src/http/routes.ts` — sessions list, snapshot, raw, path validation
- [ ] `server/src/replay/buildReplaySnapshot.test.ts` + fixtures
- [ ] `web/vite.config.ts` — proxy
- [ ] `web/src/main.tsx`, router
- [ ] `web/src/api.ts`
- [ ] `web/src/store.ts` — Zustand
- [ ] `web/src/pages/SessionPicker.tsx`
- [ ] `web/src/lib/record.ts`, `layout.ts`, `timeline.ts`, `virtual-rows.ts`, `search-index.ts`
- [ ] `web/src/lib/*.test.ts`
- [ ] `web/src/components/TrajectoryCell.tsx`
- [ ] `web/src/components/TrajectoryGroupHeader.tsx`, `TrajectoryTurnHeader.tsx`, `TrajectoryTurn.tsx`
- [ ] `web/src/components/TrajectoryToolbar.tsx`
- [ ] `web/src/components/TrajectoryTimeline.tsx`
- [ ] `web/src/components/TrajectoryTable.tsx` (without inspector)
- [ ] `web/src/components/Inspector.tsx` + `inspector-tabs/*.tsx`
- [ ] `web/src/components/TrajectoryView.tsx`
- [ ] `web/src/index.css` — Tailwind + `@layer` for spacers/scrollbars
- [ ] `web/tailwind.config.ts` — tokens
- [ ] Component tests + a11y snapshot
- [ ] README
- [ ] typecheck + lint + grep gate green
