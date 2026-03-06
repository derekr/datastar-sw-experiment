---
# datastar_sw-4ivr
title: Rewrite sw.jsx as thin routes file
status: completed
type: task
priority: normal
created_at: 2026-03-06T22:13:25Z
updated_at: 2026-03-06T22:17:00Z
---

Extract ~5500 lines of helpers/components/CSS from sw.jsx into separate modules. Rewrite sw.jsx to contain only imports, Hono app, route definitions, and SW lifecycle handlers. Target ~1300-1500 lines.

## Summary of Changes\n\nRewrote sw.jsx from 6923 lines to 1183 lines. The new file contains only:\n- Imports from extracted modules (lib/ and components/)\n- Hono app instance\n- All 51 unique route definitions (preserved exactly from original)\n- SW lifecycle handlers (install, activate, fetch)\n\nRemoved 3 duplicate route definitions that existed in the original (select-mode, toggle-select, card sheet each appeared twice).\n\nAll route implementations preserved exactly — same paths, SSE streaming patterns, bus event listeners, streamSSE callbacks, and command route logic. Only inline function/component/CSS references replaced with imports.
