---
# datastar_sw-m2os
title: Switch docs command menu to server-driven SSE morph
status: completed
type: task
priority: high
created_at: 2026-03-05T21:12:04Z
updated_at: 2026-03-05T21:17:32Z
parent: datastar_sw-9bz9
---

Replace client-side docs command menu with server-driven pattern. Add SSE connection to docs pages, subscribe to global:ui bus event, use existing command menu routes and CommandMenu JSX component. Docs pages plug into the same globalUIState pipeline as the main app.

## Summary of Changes\n\nReplaced client-side docs command menu (HTML dialog + JS event handlers + custom CSS) with the server-driven SSE morph pattern used by the main app.\n\n- DocsShell: Cmd+K/Escape keyboard listeners POST to existing /command-menu/open and /command-menu/close routes. MutationObserver auto-focuses command menu input. Includes main CSS constant for command menu styles.\n- DocsLayout: Added SSE data-init connection on #docs-app, conditional CommandMenu rendering.\n- Routes: GET /docs and GET /docs/:slug SSE branches subscribe to global:ui bus event and push morphs on command menu state changes.\n- Removed ~133 lines of client-side command menu CSS and JS. Net -80 lines.
