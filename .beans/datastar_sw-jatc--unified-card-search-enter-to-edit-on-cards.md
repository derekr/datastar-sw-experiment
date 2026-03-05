---
# datastar_sw-jatc
title: Unified card search + Enter-to-edit on cards
status: completed
type: task
priority: high
created_at: 2026-03-05T00:30:21Z
updated_at: 2026-03-05T00:36:40Z
---

1. Search always shows cards across all boards in a single Cards section, current board prioritized. 2. Selecting a card from command menu opens it for editing. 3. Enter on a focused card (arrow-key navigation) opens it for editing.

## Tasks

- [x] Merge This board / Other boards card sections into single Cards section
- [x] Current board cards first with column-only subtitle, cross-board with Board / Column
- [x] Command menu go route sets editingCard (not just highlightCard)
- [x] Command menu go-nav route sets editingCard for cross-board
- [x] eg-kanban.js emits kanban-card-open on Enter for focused card
- [x] Shell handles kanban-card-open event to POST /cards/:id/edit
- [x] Test: search on board shows cross-board cards, Enter opens edit


## Summary of Changes

Unified command menu card search into a single "Cards" section (current board cards first with column-only subtitle, cross-board cards with "Board / Column" subtitle). Command menu card selection now opens the card for editing (sets `editingCard` instead of just `highlightCard`). Added Enter-to-edit on focused cards via `kanban-card-open` custom event in eg-kanban.js, handled by Shell to POST to `/cards/:id/edit`. Fixed time travel exit route URL bug (`time-travel-exit` → `time-travel/exit`).
