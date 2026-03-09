---
# datastar_sw-z8md
title: Session isolation for Bun deploy
status: completed
type: task
priority: normal
created_at: 2026-03-09T04:40:23Z
updated_at: 2026-03-09T14:32:32Z
---

Add session cookie middleware and filter board data by sessionId so concurrent visitors on a shared Render instance can't see each other's boards. Single SQLite, session-scoped at the query level.

## Summary of Changes\n\nAdded session-scoped board isolation for the Bun runtime:\n\n- `lib/runtime.js`: Added `resolveSessionId` hook to runtime config\n- `runtime/bun-entry.ts`: Session cookie middleware via `hono/cookie` — sets httpOnly cookie with 24h maxAge\n- `sw.jsx`: Middleware resolves sessionId on every request. Board creation stamps sessionId. Import stamps sessionId. Board access middleware rejects cross-session access. Board listing and command menu pass sessionId for filtering.\n- `lib/queries.js`: `getBoards(sessionId)` filters by sessionId when provided\n- `lib/command-menu.js`: Accepts sessionId param, filters boards\n\nSW path is unaffected — no sessionId means no filtering (single user).
