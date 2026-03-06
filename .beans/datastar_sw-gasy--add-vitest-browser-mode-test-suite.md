---
# datastar_sw-gasy
title: Add Vitest browser mode test suite
status: draft
type: task
priority: normal
created_at: 2026-03-06T23:03:44Z
updated_at: 2026-03-06T23:03:44Z
---

Set up Vitest browser mode for integration testing. The app runs in a service worker so Node.js tests can't cover the core paths (IndexedDB, SW fetch handler, SSE streams, Datastar morphs).\n\nVitest browser mode runs tests in a real browser context, which can:\n- Register the SW and wait for activation\n- Seed IndexedDB with test data\n- Hit Hono routes via fetch() and assert responses\n- Test SSE streams for correct morph output\n- Verify undo/redo, event sourcing, time travel\n\n- [ ] Install vitest + @vitest/browser\n- [ ] Configure vitest.config.ts for browser mode\n- [ ] Write test helpers (register SW, seed DB, wait for activation)\n- [ ] Test: board CRUD (create, read, update, delete)\n- [ ] Test: card CRUD + move between columns\n- [ ] Test: undo/redo (including board delete undo restoring columns/cards)\n- [ ] Test: import/export round-trip\n- [ ] Test: SSE stream pushes correct morph after mutation
