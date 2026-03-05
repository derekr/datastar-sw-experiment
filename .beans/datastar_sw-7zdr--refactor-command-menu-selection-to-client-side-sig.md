---
# datastar_sw-7zdr
title: Refactor command menu selection to client-side signal
status: completed
type: task
priority: normal
created_at: 2026-03-05T00:46:25Z
updated_at: 2026-03-05T00:49:43Z
---

Replace server-side selectedIndex tracking with a Datastar signal (cmdIdx). Arrow key navigation becomes instant (no SSE round-trip). Remove /command-menu/nav route.

\n## Summary of Changes\n\nReplaced server-side selectedIndex with client-side Datastar signals (cmdIdx, cmdCount). Arrow key navigation is now instant with no SSE round-trip. Removed /command-menu/nav route. data-class binding drives the active highlight reactively.
