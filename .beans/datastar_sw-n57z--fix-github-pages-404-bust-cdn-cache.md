---
# datastar_sw-n57z
title: Fix GitHub Pages 404 — bust CDN cache
status: completed
type: bug
priority: high
created_at: 2026-03-03T00:48:00Z
updated_at: 2026-03-03T00:59:58Z
---

The deployed GitHub Pages site returns 404 for main-BIQ9p-xU.js and sw.js from the browser, even though the files exist on the origin. This is due to GitHub Pages CDN caching stale 404 responses from the initial deploy. Fix: add workflow_dispatch trigger, bust the Vite content hash, and redeploy.

## Additional Issue\n\n- sw.js:1319 TypeError: Cannot construct Request with mode 'navigate' — need to fix the fetch handler's Request construction when stripping scope prefix.

## Summary of Changes\n\n- Added `.nojekyll` to `public/` so GitHub Pages skips Jekyll processing\n- Added `workflow_dispatch` trigger to deploy workflow for manual re-deploys\n- Fixed SW fetch handler: avoid `mode:'navigate'` in Request constructor (not settable via RequestInit)\n- Fixed SW fetch handler: add `duplex:'half'` when body is a ReadableStream\n- Prefixed all client-side URLs with `base()`: Datastar `@get`/`@post`/`@delete` actions, SSE endpoints, `fetch()` calls for drag/move, `<script src>` for eg-kanban.js\n- Changed `index.html` SW registration to bust Vite content hash (new filename bypasses stale CDN 404 cache)
