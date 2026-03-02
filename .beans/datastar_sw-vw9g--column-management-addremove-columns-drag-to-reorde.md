---
# datastar_sw-vw9g
title: 'Column management: add/remove columns, drag-to-reorder'
status: completed
type: feature
priority: normal
tags:
    - kanban
    - drag-and-drop
created_at: 2026-03-02T18:43:10Z
updated_at: 2026-03-02T18:51:35Z
---

Add full column CRUD and drag-to-reorder.

## Add/Remove Columns
- Add column creation UI (button or input after the last column)
- Add column delete button (with confirmation if column has cards)
- Event sourcing: column.deleted event type + upcaster slot
- Handle card orphaning on column delete (move to first column? delete cards?)

## Drag-to-Reorder Columns
- Make columns draggable with drag handles
- Drop indicator between columns (vertical line, similar to card indicator)
- column.moved event type for reordering
- FLIP animation for reordered columns (reuse __setDropFlip pattern or adapt)
- View transitions for column reflow during drag

## Notes
- Columns already have view-transition-name: col-{id} — VT infrastructure is in place
- Card drag and column drag need to coexist (distinguish by drag data type)
- Column reorder is a position update on the columns store
- Follow existing CQRS pattern: POST/PUT/DELETE → event → morph via SSE
