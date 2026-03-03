---
# datastar_sw-m450
title: Undo/redo support
status: todo
type: feature
priority: normal
created_at: 2026-03-03T01:32:25Z
updated_at: 2026-03-03T01:32:25Z
---

Leverage the event log to support undo/redo. Options: compensating events (reverse the last mutation) or projection rollback to a prior snapshot. Need UI affordance (Ctrl+Z / Ctrl+Shift+Z) and visual feedback. Should work across card moves, creates, deletes, column operations.
