---
# datastar_sw-9vxx
title: Add Bun runtime with SQLite adapter
status: completed
type: feature
priority: high
created_at: 2026-03-07T02:21:46Z
updated_at: 2026-03-08T06:43:00Z
---

Run the same Hono app outside SW using Bun + SQLite backend.\n\nScope:\n- [x] Implement sqlite adapter (bun:sqlite) matching IDB behavior\n- [x] Add schema + migrations for events/boards/columns/cards/meta\n- [x] Add bun runtime entrypoint and dev command\n- [x] Implement presence adapter for board tab/connection counting in Bun\n- [x] Validate CQRS + SSE parity against SW runtime


## Summary of Changes

Implemented Bun runtime + SQLite adapter path with working CQRS/SSE behavior:

- Added SQLite adapter: `lib/db/sqlite-adapter.js`
  - IDB-like facade over `bun:sqlite` for stores/events/meta
  - Supports store operations used by existing domain code (`get`, `put`, `delete`, `clear`, `getAll`, `getAllKeys`, indexed lookups)
  - Added schema bootstrap for boards/columns/cards/meta/events + indexes
- Refactored DB bootstrap (`lib/db.js`) to support runtime-selected adapters via `useDbAdapter()`
- Updated Bun runtime entry (`runtime/bun-entry.ts`)
  - Configures SQLite adapter before loading shared app
  - Adds source-execution define fallbacks for asset globals
  - Serves static files and sets `idleTimeout: 255` for SSE stability
  - Adds in-memory board connection registry for tab-count presence
- Added runtime hooks for stream presence (`lib/runtime.js`) and wired board SSE connect/disconnect hooks in `sw.jsx`
- Updated `lib/tabs.js` to use runtime presence counter when available
- Added compression/decompression fallback (`lib/compression.js`) for runtimes without CompressionStream/DecompressionStream
- Made snapshot replay range runtime-agnostic in `lib/init.js` (removed direct IDBKeyRange dependency)

## QA / Smoke

SW runtime:
- `pnpm build` passes after changes

Bun runtime:
- `bun run runtime/bun-entry.ts` starts successfully
- HTTP smoke: `curl http://localhost:3000` returns 200
- MCP smoke on Bun:
  - Load index page, create board, navigate board
  - Add card and observe immediate board update
  - Command menu open returns 204 and menu appears
  - Open second tab on same board and tab count shows `2 tabs` (presence adapter working)
