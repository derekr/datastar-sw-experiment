---
# datastar_sw-444i
title: Extract createApp(runtime) and runtime adapters
status: completed
type: feature
priority: high
created_at: 2026-03-07T02:21:46Z
updated_at: 2026-03-07T02:25:50Z
---

Refactor app bootstrapping so Hono routes/domain logic are runtime-agnostic and SW/Bun entries are thin adapters.\n\nScope:\n- [x] Introduce createApp(runtime) factory that returns configured Hono app\n- [x] Move SW lifecycle/fetch interception to runtime/sw-entry\n- [x] Add runtime/bun-entry with Bun.serve({ fetch: app.fetch })\n- [x] Replace direct self/scope dependencies with runtime config (basePath, environment hooks)\n- [x] Keep behavior parity in SW mode


## Summary of Changes

Implemented first-phase runtime extraction:
- Added `createApp(runtimeConfig)` in `sw.jsx` to initialize shared Hono app with runtime config
- Moved SW lifecycle/fetch interception into `runtime/sw-entry.js`
- Added `runtime/bun-entry.ts` with Bun adapter and static serving scaffold
- Added runtime abstraction (`lib/runtime.js`) and refactored base path, tab client matching, and online status to use runtime hooks instead of hard-coded `self`/`navigator` usage
- Updated `lib/tabs.js` to register connection listeners via runtime adapter
- Added `dev:bun` script in `package.json`

Vite build still passes after refactor (`pnpm build`).

Note: this is the adapter boundary extraction phase; full Bun+SQLite parity is tracked in follow-on beans (`datastar_sw-dpzk`, `datastar_sw-9vxx`, `datastar_sw-xwdh`).
