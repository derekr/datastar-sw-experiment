---
# datastar_sw-r1ap
title: Board title editing
status: todo
type: feature
priority: normal
created_at: 2026-03-04T04:36:29Z
updated_at: 2026-03-04T04:36:29Z
---

Board title is currently read-only. Add inline editing matching the card title pattern — server-tracked editingBoardTitle state.

## Tasks
- [ ] Add editingBoardTitle to boardUIState
- [ ] Add click-to-edit on board h1 (POST to toggle edit mode)
- [ ] Render input with current title when editing
- [ ] Add PUT route to save title (board.titleUpdated event)
- [ ] QA
- [ ] Build + commit
