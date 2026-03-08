---
# datastar_sw-dpzk
title: Add DB adapter interfaces and IDB implementation
status: completed
type: feature
priority: high
created_at: 2026-03-07T02:21:46Z
updated_at: 2026-03-08T02:08:04Z
---

Create storage abstraction layer to decouple domain logic from IndexedDB APIs.\n\nScope:\n- [x] Define EventStore/ProjectionStore interfaces + transaction boundaries\n- [x] Implement IDB adapter preserving current schema/index behavior\n- [x] Refactor lib/events/init/undo/queries to use adapter interfaces\n- [x] Preserve idempotency, upcasting, and snapshot/replay semantics\n- [x] Add tests for adapter contract in browser mode


## Progress Notes

- Added reusable DB boundary helpers in `lib/db.js` (`getDb`, `beginTx`, `getRecord`, `getAllRecords`, `getAllFromIndex`, `countRecords`).
- Refactored `lib/queries.js` to consume DB helper functions instead of direct `dbPromise` access.
- Refactored `lib/events.js` transaction creation to use `beginTx` adapter helper while preserving append/idempotency behavior.
- Refactored `lib/init.js` and `lib/undo.js` to use DB helper boundaries for reads/transactions where practical.
- Smoke-tested after refactor:
  - `pnpm build` passes
  - MCP board flow smoke passed (loaded board, added card, observed immediate UI update).

Remaining for this bean:
- Add explicit adapter-contract tests in browser mode (tracked by final checklist item).


## Summary of Changes

Completed DB adapter boundary phase for IndexedDB:
- Added adapter contracts in `lib/db/adapter.js`
- Added IDB adapter implementation in `lib/db/idb-adapter.js`
- Refactored `lib/db.js` to expose adapter-backed helpers (`getDb`, `beginTx`, `getRecord`, `getAllRecords`, `getAllFromIndex`, `countRecords`)
- Refactored `lib/events.js`, `lib/init.js`, `lib/queries.js`, and `lib/undo.js` to consume DB helper boundaries instead of direct `dbPromise` coupling where practical
- Added browser-mode adapter contract tests:
  - `tests/db-adapter.browser.test.js`
  - `vitest.config.js`
  - `pnpm test:browser` script

QA / smoke:
- `pnpm test:browser` passes (2/2 tests)
- `pnpm build` passes
- MCP smoke still passes for board mutations (card add)
- Cmd+K smoke added to flow (toggle behavior validated via `/command-menu/open`)

This completes the IndexedDB adapter boundary work and unblocks Bun+SQLite adapter implementation in the next bean.
