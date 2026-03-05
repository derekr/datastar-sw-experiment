---
# datastar_sw-sj9n
title: Cross-board card movement in select mode
status: draft
type: feature
priority: normal
created_at: 2026-03-04T23:21:49Z
updated_at: 2026-03-04T23:21:49Z
---

In select mode, allow moving selected cards to a different board. Could also support drag-and-drop between two browser windows of different boards using the HTML Drag and Drop API (dataTransfer). Events would be created on the target board and deletion events on the source board.

## Open Questions

- Cross-window drag: use dataTransfer with serialized card data? Or clipboard-based?
- Select mode flow: select cards → pick target board from a list → confirm?
- Should this create new card IDs on the target board or preserve them?
- How to handle labels/columns that don't exist on the target board?

## Tasks

- [ ] Add 'Move to board' option in select mode action bar
- [ ] Create board picker UI (list of other boards)
- [ ] Implement cross-board card move (create events on target, delete on source)
- [ ] Explore cross-window drag via HTML Drag and Drop API dataTransfer
- [ ] Handle column mapping (pick target column or create new one)
- [ ] Handle label preservation
