---
# datastar_sw-xcd7
title: Add initialize() guard to command routes
status: completed
type: bug
priority: high
created_at: 2026-03-06T22:54:10Z
updated_at: 2026-03-06T23:05:19Z
---

sw.jsx — GET/SSE routes call await initialize() but POST/PUT/DELETE command routes do not. If the SW restarts (browser kills idle SWs after ~30s) and the first request is a command (e.g. card drag-move), actorId.value will be null, migrations won't have run, and the projection may be stale.\n\nIn practice the SSE reconnect (GET) usually runs first, but there's a race window.\n\nFix: Add initialize() as Hono middleware so every route is guaranteed initialized.\n\n- [ ] Add Hono middleware that calls await initialize() before all routes\n- [ ] Remove individual initialize() calls from GET routes\n- [ ] Test: verify app still works after SW restart

\n## Summary of Changes\n\nAdded Hono middleware (app.use) that calls initialize() before every route. Removed 7 individual initialize() calls from GET routes. Also removed unused clearUIState import.
