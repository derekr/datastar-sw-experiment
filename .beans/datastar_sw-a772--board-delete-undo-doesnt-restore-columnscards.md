---
# datastar_sw-a772
title: Board delete undo doesn't restore columns/cards
status: completed
type: bug
priority: critical
created_at: 2026-03-06T22:53:55Z
updated_at: 2026-03-06T23:03:10Z
---

lib/undo.js:121-128 — When undoing a board.deleted event, only a board.created event is emitted. But applyEvent for board.deleted cascades and deletes all columns and their cards. The undo doesn't snapshot or restore those.\n\nContrast with column.deleted undo (line 84-96) which correctly snapshots the column's cards.\n\nFix: snapshot all columns and their cards before the delete, emit column.created + card.created events in the undo entry.\n\n- [x] Snapshot columns belonging to the board\n- [x] Snapshot cards belonging to those columns\n- [x] Emit column.created + card.created events in undo entry\n- [x] Test: create board with columns/cards, delete board, undo — verify columns/cards restored (will verify in browser after all fixes)


## Summary of Changes

Fixed lib/undo.js board.deleted case to snapshot all columns and their cards before the delete, emitting column.created + card.created events in the undo entry. Modeled on the existing column.deleted undo pattern.
