---
# datastar_sw-qxtq
title: Bun runtime styles/icons mismatch
status: completed
type: bug
priority: normal
created_at: 2026-03-08T06:46:21Z
updated_at: 2026-03-08T06:51:20Z
---

Bun runtime currently has style/icon differences from SW runtime. This likely relates to runtime asset wiring (stellar CSS, kanban JS, lucide icon CSS) and should be resolved by asset decoupling work.

- [x] Verify differences after xwdh asset-manifest decoupling
- [x] Ensure Bun runtime includes lucide icon CSS and correct stylesheet paths
- [x] QA Bun visual parity for boards/docs/events pages


## Summary of Changes

Resolved by xwdh asset decoupling work:
- Bun runtime now injects generated lucide icon CSS via runtime asset config
- Templates use runtime asset paths rather than hardcoded Vite globals
- Verified Bun HTML output for board/docs/events includes icon CSS and expected stylesheet paths
- MCP smoke confirms Bun board interactions + command menu behavior continue to work
