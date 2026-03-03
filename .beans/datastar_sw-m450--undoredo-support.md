---
# datastar_sw-m450
title: Undo/redo support
status: completed
type: feature
priority: normal
created_at: 2026-03-03T01:32:25Z
updated_at: 2026-03-03T01:43:44Z
---

Leverage the event log to support undo/redo. Options: compensating events (reverse the last mutation) or projection rollback to a prior snapshot. Need UI affordance (Ctrl+Z / Ctrl+Shift+Z) and visual feedback. Should work across card moves, creates, deletes, column operations.

\n## Plan\n\nUse compensating events approach — each undo emits a reverse event.\n\n- [x] Add undo stack (in-memory array of { undoEvent, redoEvent } pairs) in the SW\n- [x] Implement reverse-event generators for each event type\n- [x] Add POST /undo and POST /redo routes\n- [x] Wire Ctrl+Z / Ctrl+Shift+Z keyboard shortcuts in Shell inline script\n- [x] Test: create card → undo (deletes) → redo (re-creates)

## Summary of Changes

- Per-board undo/redo stacks (in-memory, max 50 entries)
- `buildUndoEntry()` snapshots current state before mutation to generate reverse events for all event types
- `appendEventsWithUndo()` wraps `appendEvents` — auto-pushes undo entries, clears redo on new mutation
- All board command routes updated to use `appendEventsWithUndo`
- `POST /boards/:boardId/undo` and `POST /boards/:boardId/redo` routes
- Ctrl+Z / Ctrl+Shift+Z (Cmd on Mac) keyboard shortcuts in Shell inline script
- Helper functions `boardIdFromColumn()` and `boardIdFromCard()` for resolving board context
