# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

pnpm workspace: TypeScript, Node/Hono, Vite, React, Tailwind, Zustand, and TanStack Virtual.

## Users

Pi coding-agent users inspecting their own local sessions: debugging behavior, tracing tool use, reviewing costs, and recovering context after compaction.

## Product Purpose

Pi Trajectory turns pi session JSONL into a local, read-only browser inspection surface. Success means a user can find a session, understand its turns and tool work, and inspect exact payload, output, usage, and prompt context without leaving their machine.

## Positioning

Trajectory For All: dense, timing-aware session inspection for every pi session, not only a proprietary harness or an active run.

## Operating Context

Desktop browser, used beside or after pi. Server binds loopback and reads `~/.pi/agent/sessions/`; no remote hosting, authentication, or session editing in v1.

## Capabilities and Constraints

Replay mode ships first. It lists all local sessions and projects active branches into one shared snapshot consumed by browser UI. Live observation, agent control, branch navigation, and historical prompt timing are deferred. Prompt logging extension is opt-in because prompts can contain sensitive project context.

## Brand Commitments

Product name: Pi Trajectory. Voice: precise, honest, developer-native. Do not fabricate session data, performance claims, customers, or remote capabilities.

## Evidence on Hand

Real local pi session JSONL available through server API. Product design and data mapping live in `prd/`. No logos, photography, testimonials, or external proof assets supplied.

## Product Principles

- Inspect without changing agent state.
- Keep pi runtime details out of browser bundle.
- Prefer dense, scannable evidence over chat-like presentation.
- Preserve uncertainty: replay timing stays unknown when pi did not record it.
- Make local session history usable across projects.

## Accessibility & Inclusion

Desktop-first interface must retain semantic controls, visible keyboard focus, ARIA labels, contrast, and reduced-motion support.
