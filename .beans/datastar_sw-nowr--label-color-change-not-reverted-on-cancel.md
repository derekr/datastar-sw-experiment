---
# datastar_sw-nowr
title: Label color change not reverted on cancel
status: completed
type: bug
priority: high
created_at: 2026-03-05T19:24:21Z
updated_at: 2026-03-05T19:29:25Z
---

Changing a card's label color and clicking Cancel doesn't undo the color selection. The label change persists even though the user cancelled.

## Analysis

Label changes fire `@post` immediately on swatch click, writing a `card.labelUpdated` event to IndexedDB. Cancel only clears `ui.editingCard = null` — it doesn't revert persisted label changes.

## Fix

1. Store `ui.editingCardOriginalLabel` when entering edit mode
2. On cancel, if label changed, write a revert `card.labelUpdated` event
3. On save, just clear the stored label (accept the change)

### Tasks
- [x] Store original label in editingCard UI state
- [x] Revert label on cancel if changed
- [x] Clear stored label on save
- [x] Test in browser

## Summary of Changes

Label changes via swatch clicks were immediately persisted to IndexedDB, but Cancel only cleared UI editing state without reverting. Fixed by storing the original label when entering edit mode (`ui.editingCardOriginalLabel`) and writing a revert event on cancel if the label changed. Save clears the stored original (accepting the change).

Files changed: `sw.jsx` — edit toggle route, edit-cancel route, card save route.
