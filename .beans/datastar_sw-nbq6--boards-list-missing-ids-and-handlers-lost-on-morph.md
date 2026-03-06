---
# datastar_sw-nbq6
title: 'Boards list: missing ids and handlers lost on morph'
status: todo
type: bug
priority: high
created_at: 2026-03-06T22:54:21Z
updated_at: 2026-03-06T22:54:21Z
---

boards-list.jsx has two related issues:\n\n1. BoardCard (line 7-22) renders without an id attribute. When the boards list is morphed via SSE (after creating/deleting a board), Idiomorph can't match board cards by id.\n\n2. Inline script handlers (lines 70, 96-161) for template cards, export, and import buttons are attached via querySelectorAll/getElementById. After an SSE morph replaces #boards-list, these DOM elements are replaced and handlers are lost. Template buttons and export/import become unresponsive.\n\n- [ ] Add id=board-{board.id} to BoardCard root div\n- [ ] Convert template card handlers to event delegation on #boards-list\n- [ ] Convert export/import handlers to event delegation\n- [ ] Test: create a board, verify template/export/import buttons still work after the morph
