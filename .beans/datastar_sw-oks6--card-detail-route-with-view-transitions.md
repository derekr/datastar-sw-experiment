---
# datastar_sw-oks6
title: Card detail route with view transitions
status: in-progress
type: feature
priority: high
created_at: 2026-03-05T00:55:33Z
updated_at: 2026-03-05T01:06:54Z
---

Dedicated card detail page at /boards/:boardId/cards/:cardId with expand icon on board cards, command menu navigation, and view transitions.

## Tasks

- [x] CardDetail component (title, description, label, column move, timestamps, card-scoped event history)
- [x] GET route and SSE stream for card detail page
- [x] Card mutation routes (update title/desc/label, move column, delete)
- [x] Expand icon on board cards linking to detail route
- [x] Command menu card results navigate to detail route
- [ ] View transition animation (card expands from board into detail)
- [x] CSS for card detail layout
