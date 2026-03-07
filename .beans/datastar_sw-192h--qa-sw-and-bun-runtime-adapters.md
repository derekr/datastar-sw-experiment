---
# datastar_sw-192h
title: QA SW and Bun runtime adapters
status: completed
type: task
priority: high
created_at: 2026-03-07T02:39:56Z
updated_at: 2026-03-07T03:20:11Z
---

Run manual QA for both runtime paths after adapter extraction.\n\n- [x] Start Vite dev server and verify app loads\n- [x] QA key flows in Chrome DevTools MCP (index/board/cmd+k/SSE behavior)\n- [x] Start Bun server runtime scaffold and verify startup behavior\n- [x] If Bun starts, test in Chrome DevTools MCP (not applicable: Bun fails at startup before binding a port)\n- [x] Document results and update bean


## QA Results

- Vite dev server starts successfully (`curl http://localhost:5173` -> 200).
- Chrome DevTools MCP could not be used for strict browser smoke due repeated tool timeouts (`MCP error -32001`) on navigate/list/open-page calls.
- Bun runtime startup currently fails immediately with `ReferenceError: indexedDB is not defined` from `idb` in `lib/db.js`.
- Therefore Bun browser smoke test is blocked until DB adapter work lands (`datastar_sw-dpzk` / `datastar_sw-9vxx`).

Error excerpt:
`ReferenceError: indexedDB is not defined at openDB (...) at lib/db.js:5`

## MCP Retry (Strict Smoke)\n\n- Retried Chrome DevTools MCP successfully for initial steps: loaded http://localhost:5173, saw boards UI, and verified POST /command-menu/open returns 204 from page context.\n- Network panel showed GET /?datastar=%7B%7D and POST /command-menu/open.\n- MCP became unstable again mid-run (multiple MCP error -32001 timeouts for snapshot/list/evaluate), so strict end-to-end browser assertions could not be fully completed.\n- Retried Bun startup: still fails immediately with ReferenceError: indexedDB is not defined (from idb in lib/db.js).


## Strict Smoke (MCP Successful Run)

SW/Vite runtime:
- Loaded index page and verified boards list renders.
- Verified SSE request exists on index: GET /?datastar=%7B%7D (200).
- Navigated to board page and verified board UI renders.
- Verified SSE request exists on board page: GET /boards/:id?datastar=%7B%7D (200).
- Triggered command-menu open route from page context; POST /command-menu/open returned 204.
- Added a new card ("MCP QA card") and confirmed it appears immediately after submit (SSE update path working).
- Console check: no warnings/errors.

Bun runtime:
- Startup still fails before binding port due to IDB dependency in shared DB module:
  - ReferenceError: indexedDB is not defined
  - Source: idb/openDB via lib/db.js
- Conclusion: Bun browser smoke remains blocked until DB adapter separation is implemented (tracked by datastar_sw-dpzk and datastar_sw-9vxx).

Overall: SW runtime strict smoke passed; Bun runtime startup smoke failed with expected current blocker.
