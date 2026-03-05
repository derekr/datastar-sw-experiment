---
# datastar_sw-u0bs
title: Unify icon button styling and hover treatment
status: completed
type: task
priority: normal
created_at: 2026-03-05T19:47:07Z
updated_at: 2026-03-05T19:52:45Z
---

Create shared .icon-btn class for all icon-only buttons. Fix optical sizing differences between pencil/arrow/x on cards. Add hover background to all icon buttons consistently.

## Summary of Changes\n\nCreated shared `.icon-btn` base class with consistent: inline-flex layout, padding, border-radius, color, transitions, and hover background. Applied to all 7 icon-only buttons (card edit/expand/delete, column delete, board delete, board title edit, help overlay close). Reduced pencil icon to 0.85em optical correction. Removed ~60 lines of redundant per-class CSS.
