---
# datastar_sw-ifxz
title: Card labels/colors
status: completed
type: feature
priority: low
created_at: 2026-03-04T04:36:29Z
updated_at: 2026-03-04T16:15:19Z
---

Color tags on cards. Visually breaks up the monochrome card list and demonstrates event sourcing handling more complex state.

## Tasks
- [x] Add card.labelUpdated event (set or clear a color label)
- [x] Projection: label field on card object (no extra store needed)
- [x] Render colored top border on labeled cards
- [x] Label picker in edit form + action sheet (7 color swatches)
- [x] QA (assign, change, remove, undo/redo)
- [x] Build + commit


## Summary of Changes

Card labels with 7 color options (red, orange, yellow, green, blue, purple, pink). Labels rendered as colored border-top on cards. Label picker swatches in both the edit form and the mobile action sheet. Full event sourcing: card.labelUpdated event, applyEvent case, undo/redo support, time travel label.
