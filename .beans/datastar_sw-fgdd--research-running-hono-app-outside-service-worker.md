---
# datastar_sw-fgdd
title: Research running Hono app outside Service Worker
status: completed
type: task
priority: high
created_at: 2026-03-07T00:59:06Z
updated_at: 2026-03-07T01:00:28Z
---

Investigate what it would take to run the current Hono server in a non-SW runtime (e.g. Bun) and reduce/avoid Vite dependency for runtime builds.\n\nFocus areas:\n- [x] Inventory SW-specific APIs and coupling points\n- [x] Propose static asset sharing strategy for SW + Bun\n- [x] Propose DB adapter abstraction (IndexedDB/idb vs SQLite)\n- [x] Evaluate Bun migration (package manager/runtime)\n- [x] Identify route/runtime split and bootstrapping changes\n- [x] Document risks, migration phases, and recommendation


## Research Notes

### Current SW Coupling Points
- `lib/base.js` uses `self.registration.scope` (SW-only)
- `lib/tabs.js` uses `self.clients.matchAll()` and `self` online/offline listeners
- `sw.jsx` owns SW lifecycle and fetch interception (`install`, `activate`, `fetch`)
- `lib/db.js` is hard-wired to `idb`/IndexedDB schema and APIs
- Shell/index scripts assume SW registration/update flow

### What to Extract for Multi-Runtime
- Create `createApp(runtime)` factory that returns Hono app + routes only
- Keep runtime adapters thin:
  - `runtime/sw-entry.js` for lifecycle/fetch interception
  - `runtime/bun-entry.ts` for `Bun.serve({ fetch: app.fetch })`
- Abstract `base()` behind runtime config (`basePath`) instead of `self.registration.scope`

### Static Asset Strategy
- Move runtime-independent assets to `public/` (icons, manifest, non-hashed files)
- Replace Vite define globals (`__STELLAR_CSS__`, `__KANBAN_JS__`) with an asset manifest object injected at startup
- For Bun runtime, use `serveStatic` from `hono/bun` for CSS/JS/files
- If hash busting still desired, generate a small manifest during optional build step; runtime should not require Vite internals

### Generic DB Adapter
- Introduce interface layer (EventStore + ProjectionStore + transaction/unit-of-work)
- Keep domain logic in `lib/events.js`, `lib/init.js`, `lib/undo.js` against adapter interfaces
- Implement adapters:
  - `db/idb-adapter.ts` (current behavior in SW/browser)
  - `db/sqlite-adapter.ts` (Bun `bun:sqlite`)
- Map IDB indexes to SQL indexes (`events(id unique, seq pk)`, `columns(board_id)`, `cards(column_id)`, `events(synced)`)

### Presence/Tab Count Abstraction
- Add `presence` adapter:
  - SW provider: `clients.matchAll()`
  - Bun provider: in-memory SSE connection registry by boardId (optionally pluggable pub/sub for multi-instance)

### Bun + Package Manager Evaluation
- Bun runtime support is straightforward for Hono (`Bun.serve` + `app.fetch`) and static serving (`hono/bun` `serveStatic`)
- Switching package manager from pnpm to bun is optional; can decouple runtime migration from package-manager migration
- Recommendation: keep pnpm initially, add Bun runtime first; migrate package manager later if desired

### Other Considerations
- Migrations: translate existing IDB schema/history expectations to SQLite schema + migration scripts
- Actor identity: replace browser-persisted `meta.actorId` strategy with server runtime equivalent
- Offline/local-first semantics differ: Bun server is no longer browser-local by default
- SSE reconnection and tab counting semantics differ between SW and server runtime
- Testing split: browser-mode tests for SW path, integration tests for Bun path

### Proposed Migration Phases
1. **Refactor-only**: extract app factory + adapters while keeping SW behavior unchanged
2. **Add Bun runtime**: run same routes against SQLite adapter
3. **Asset decoupling**: remove Vite-define dependency from runtime code (optional manifest build)
4. **Optional package-manager switch**: pnpm -> bun if team wants

### Recommendation
Proceed with a dual-runtime architecture (SW + Bun) using adapter boundaries for base path, DB, and presence. Keep Vite only where it adds value (dev UX / optional asset hashing), not as a runtime requirement.

## Summary of Changes
Created a concrete feasibility plan for running the Hono app outside Service Worker, including adapter boundaries, static asset strategy, DB migration path (IndexedDB -> SQLite), and phased rollout with risk controls.
