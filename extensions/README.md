# Pi Trajectory extension

`trajectory-prompt-log.ts` does two things:

1. **Prompt logging** — writes hash-gated system-prompt snapshots to session JSONL via `before_agent_start`, so Trajectory can render prompt anatomy.
2. **`/trajectory` slash command** — opens the browser to the current session's trajectory page at `http://127.0.0.1:8787/s/<id>`. Pass an optional session id argument to inspect a different session.

## Install

As a pi package (recommended):

```bash
pi install git:github.com/ktappdev/pi-Trajectory
```

Or manually copy the single file:

```bash
mkdir -p ~/.pi/agent/extensions
cp trajectory-prompt-log.ts ~/.pi/agent/extensions/
```

Reload pi. Then:

```
/trajectory           # current session
/trajectory <id>      # specific session
```

## Requirements

**The replay server must be running separately.** The command does not spawn the server — it only opens the browser. Start the server from the repo:

```bash
pnpm dev    # development (Vite + API)
pnpm start  # production (built UI + API)
```

If the server isn't running, the command shows an error with instructions. Set `PI_TRAJECTORY_PORT` to override the default port (8787).

## Why no server spawning

Extensions load via [jiti](https://github.com/unjs/jiti) and pi installs packages with `npm install --omit=dev`. The server is TypeScript that depends on `tsx` (a devDependency) for execution — it's not available in a pi-installed clone. Spawning it from the extension would fail silently. Keeping the server as a separate process is simpler and more robust.

Prompt entries contain full system prompts including project context. Treat session files as sensitive local data.
