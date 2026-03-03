---
# datastar_sw-8g4v
title: 'Card editing: inline edit, descriptions'
status: todo
type: feature
priority: normal
created_at: 2026-03-03T01:32:22Z
updated_at: 2026-03-03T01:32:22Z
---

Cards currently only have titles. Add inline title editing (click to edit), and an optional description field. Mutations go through the event sourcing layer as new event types (card.titleUpdated, card.descriptionUpdated).
