# MVP Scope (v1 — Replay)

v1 ships **replay mode only**: read pi session JSONL, render the ported DSH Trajectory UI in a browser, served by a lightweight local server. No live agent, no driving the agent, no streaming.

## v1 ships

### Server
- `GET /api/sessions` — list all sessions (`SessionManager.listAll()`), mapped to `SessionListItem[]`.
- `GET /api/sessions/:id` — build + return `TrajectorySnapshot` from the session file (replay).
- `GET /api/sessions/:id/raw` — return the raw `FileEntry[]` (debug aid; optional but cheap).
- Static serve `web/dist` at `/`.
- Bind to `127.0.0.1` only.
- `buildReplaySnapshot(sessionFile)` — `loadEntriesFromFile` + `buildContextEntries` + projection (see `03-data-model.md`).
- Path resolution: `:id` resolved against the session list; reject paths outside `~/.pi/agent/sessions/`.

### Web
- **Session picker** at `/` — searchable list of all sessions (cwd, name, first message, timestamp, message count).
- **TrajectoryView** at `/s/:sessionId` — the ported DSH UI:
  - `TrajectoryToolbar` — fold turns, fold calls, search, actual-duration toggle.
  - `TrajectoryTimeline` (Overview) — 3 lanes, drag-focus interval filter, wheel zoom, right-click clear, right-drag pan, 500ms hover tooltip. **In replay, durations are null** (see data model §5), so the Overview shows completion markers + sequence mode by default; duration/actual modes render what timing exists.
  - `TrajectoryTable` — virtualized ledger (`@tanstack/react-virtual`), turn/request separators, stable record ids, ARIA roles.
  - **Inspector** — local, per-record; tabs by kind (Summary/Payload/Result/Schema/Timing/Usage/Options/System Prompt/Diff as applicable). Resizable split.
- Zustand store for snapshot + selection/fold/search state.
- `react-router-dom` for `/` and `/s/:sessionId`.
- Tailwind + small `index.css` for virtualizer spacers + scrollbar transparency.

### Ported from DSH (verbatim logic, retyped)
- `record.ts` — `TrajectoryRecord` (pi-native, per `03-data-model.md`), `trajectoryRecordId`, duration formatters.
- `layout.ts` — `deriveTrajectoryLayout` (retyped input for pi snapshot).
- `timeline.ts` — `deriveTrajectoryTimeline`, focus filter.
- `virtual-rows.ts` — `groupTrajectoryVirtualRows`, row keys.
- `search-index.ts` — `TrajectorySearchIndex` + 3s throttle.
- All `Trajectory*.tsx` components, retyped, DSH plugin glue removed (see `08-ui-porting-guide.md`).

### Inspector tabs (v1 behavior)
| Tab | v1 content |
|---|---|
| Summary | Rendered Markdown for messages; tool call + result summary for tools |
| Payload (input) | Tool args as JSON |
| Result (output) | Tool result content (text; images as media) |
| Schema | Current tool schema from static catalog, if resolvable server-side; else empty state |
| Timing | `completedAt` from message timestamp; TTFT/decode blank in replay (honest) |
| Usage | Token counts + cost from `AssistantMessage.usage` / compaction `usage` |
| Options | `requestConfig` if present (thinking level, etc.) |
| System Prompt | Empty state — "pi does not log per-request system prompts" (see gaps) |
| Diff | Empty state — same gap |

## v1 explicitly skips (with deferral)

| Skipped | Restore when | Tracking |
|---|---|---|
| Live mode (SDK/RPC subscribe, WS push) | v2 | `07-open-gaps-and-questions.md` |
| Driving the agent (`POST /prompt`, steer) | v2, with confirmation surface | architecture §security |
| In-flight `partial` / `runningTools` rows | v2 (live) | data model §4 |
| Tail-first backward paging | Sessions get huge | DSH virtual-rows port is ready; wire when needed |
| Streaming + tail-follow | v2 (live) | DSH logic ports with the table |
| TTFT/decode timing | v2 (live events) | data model §5 |
| Tree view (abandoned branches) | v2 | `header.tree` reserved |
| Branch navigation (`/tree`, fork) | v2 | read-only display first |
| Per-request system prompt + diff | pi exposes it (gap) | `07-open-gaps-and-questions.md` |
| Per-call tool schemas | pi logs them (gap) | show static catalog meanwhile |
| i18n | Need arises | DSH locale glue dropped |
| Deep links to a record | v2 | DSH limitation carried |
| `actualTime` toggle | Keep hidden (DSH does) | port as hidden |
| Multi-user / remote host | Never (local-first) | non-goal |

Each skip gets a `TODO(v1)` comment in code at the restore point.

## v1 done criteria

- [ ] `pnpm dev` starts server + Vite; opening `http://localhost:<port>/` shows the session picker.
- [ ] Picker lists real sessions from `~/.pi/agent/sessions/` with correct cwd/name/counts.
- [ ] Selecting a session renders `TrajectoryView` with the active branch's records.
- [ ] Ledger shows user/assistant/tool/compaction/model-change/thinking-change/bash records with correct summaries.
- [ ] Tool records pair call + result by `toolCallId`; `isError` surfaces.
- [ ] Turn/request separators render; request numbering is one space across assistant + compaction.
- [ ] Virtualization works: a 500-record session mounts only the visible window + overscan; scroll is smooth.
- [ ] Inspector opens on record click; tabs render the right content per kind.
- [ ] Overview renders in sequence mode; drag-focus filters the ledger; wheel zooms; right-click clears.
- [ ] Search filters records by query (throttled index).
- [ ] Fold turns / fold calls work.
- [ ] Light + dark themes both render correctly.
- [ ] Server binds loopback only; a path-traversal attempt on `:id` is rejected.
- [ ] A corrupt JSONL returns an error snapshot, not a crash.
- [ ] No `@earendil-works/pi-*` imports in `web/` (verified by a bundler check or grep gate).

## v1 non-criteria (won't measure)

- Performance on 10k+ entry sessions (state the ceiling; optimize in v2 if needed).
- Pixel-perfect DSH visual match (port the structure + interaction; Tailwind theme is its own thing).
- Mobile/responsive (desktop browser first).
