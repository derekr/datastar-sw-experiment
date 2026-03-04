---
# datastar_sw-r1ap
title: Board title editing
status: completed
type: feature
priority: normal
created_at: 2026-03-04T04:36:29Z
updated_at: 2026-03-04T05:31:41Z
---

Board title is currently read-only. Add inline editing matching the card title pattern — server-tracked editingBoardTitle state.

## Tasks
- [x] Add editingBoardTitle to boardUIState
- [x] Add click-to-edit on board h1 (POST to toggle edit mode)
- [x] Render input with current title when editing
- [x] Add PUT route to save title (board.titleUpdated event)
- [x] QA (edit, save, cancel, undo, redo, boards list)
- [x] Build + commit


## Summary of Changes

Inline board title editing following the same pattern as card editing: click the h1 to enter edit mode (server-tracked via editingBoardTitle in boardUIState), form with Save/Cancel, PUT route creates board.titleUpdated event with undo/redo support.
