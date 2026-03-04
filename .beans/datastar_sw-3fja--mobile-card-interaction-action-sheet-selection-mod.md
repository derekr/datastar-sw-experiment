---
# datastar_sw-3fja
title: 'Mobile card interaction: action sheet + selection mode'
status: completed
type: feature
priority: high
created_at: 2026-03-03T23:47:25Z
updated_at: 2026-03-04T00:13:02Z
---

Mobile card interaction: action sheet + selection mode + CSS scroll snapping

## Approach

Server-tracked state (Datastar/Tao style): the SW tracks which card's action sheet is open, which cards are selected, and whether selection mode is active. Mutations push a full board morph with the right UI baked in. Minimal client signals — just enough for intent.

## Tasks

- [x] Add CSS scroll snapping to `.columns` container
- [x] Action sheet: server-tracked `activeCardSheet` state
  - Tap card on touch → `POST /cards/:cardId/sheet` → SW sets `activeCardSheet`, pushes board morph with bottom sheet overlay for that card
  - Sheet shows: 'Move to [column]' buttons (one per other column), 'Edit', 'Delete', 'Cancel'
  - 'Cancel' or backdrop tap → `POST /cards/sheet/dismiss` → clears state, morphs sheet away
  - 'Move to X' → existing move route + dismiss
  - 'Edit' → sets `editingCard` on server, morphs inline edit form
  - 'Delete' → existing delete route
  - All actions close sheet automatically
- [x] Selection mode: server-tracked
  - 'Select' button in board header → `POST /boards/:boardId/select-mode` → SW tracks mode + selected card IDs
  - Card taps toggle selection → `POST /cards/:cardId/toggle-select`
  - Bottom action bar: 'Move to...' (shows column picker), 'Delete selected', 'Cancel'
  - Batch move → `POST /boards/:boardId/batch-move` (with target column)
  - Batch delete → `POST /boards/:boardId/batch-delete`
  - 'Cancel' → `POST /boards/:boardId/select-mode/cancel`
- [x] Disable pointer drag on touch devices (coarse pointer)
  - eg-kanban.js: skip drag on `pointerType === 'touch'`
  - Taps pass through to action sheet handler
- [x] Test on mobile viewport / touch simulation

## CSS Scroll Snapping
Add `scroll-snap-type: x mandatory` to `.columns`, `scroll-snap-align: center` to `.column`. Columns snap into view on swipe.

## Summary of Changes

Implemented server-tracked mobile card interactions:

- **CSS scroll snapping**: `scroll-snap-type: x mandatory` on `.columns`, `scroll-snap-align: center` on `.column`. Disabled during active drag.
- **Action sheet**: Tap card on touch → POST to SW → server tracks `activeCardSheet`, pushes full board morph with bottom sheet overlay. Move to column, Edit, Delete, Cancel — all server-tracked.
- **Selection mode**: Select button in header enters mode. Cards show checkboxes, bottom action bar with batch Move/Delete. All server-tracked via in-memory `boardUIState` Map.
- **Server-tracked editing**: Replaced `$editingCard` client signal with server-tracked `editingCard` state.
- **Touch drag disabled**: `pointerType === 'touch'` skips drag in eg-kanban.js. Taps emit `kanban-card-tap` event. `touch-action: none` only applies on `@media (pointer: fine)`.
- **10 new SW routes** for UI state commands (sheet, edit, select-mode, toggle-select, batch-move, batch-delete).
- Zero console errors/warnings in QA.
