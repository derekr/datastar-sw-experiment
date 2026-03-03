---
# datastar_sw-8g4v
title: 'Card editing: inline edit, descriptions'
status: completed
type: feature
priority: normal
created_at: 2026-03-03T01:32:22Z
updated_at: 2026-03-03T01:40:16Z
---

Cards currently only have titles. Add inline title editing (click to edit), and an optional description field. Mutations go through the event sourcing layer as new event types (card.titleUpdated, card.descriptionUpdated).

\n## Plan\n\n- [x] Add `card.titleUpdated` event type + upcaster registration\n- [x] Add inline title editing UI (click-to-edit on card title)\n- [x] Add PUT route for title update\n- [x] Add `card.descriptionUpdated` event type\n- [x] Add description field to card UI (expandable/collapsible)\n- [x] Add PUT route for description update\n- [x] Test locally

## Summary of Changes

- Added `card.titleUpdated` and `card.descriptionUpdated` event types with projection handlers
- Added `PUT /cards/:cardId` route that emits title/description events via `appendEvents`
- Card component: pencil edit button toggles inline form with title input + description textarea
- `$editingCard` Datastar signal tracks which card is being edited
- Fixed `boardIdForEvent` to look up card→column→board for events without `columnId`
- CSS: `.card-content`, `.card-desc`, `.card-edit-form`, `.card-edit-actions` styles
