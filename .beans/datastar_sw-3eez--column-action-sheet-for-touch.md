---
# datastar_sw-3eez
title: Column action sheet for touch
status: completed
type: feature
priority: normal
created_at: 2026-03-04T00:33:54Z
updated_at: 2026-03-04T00:39:19Z
---

Bottom sheet for column actions on touch devices: move left, move right, delete, cancel. Triggered by tapping column header on touch. Code is written but needs QA and commit.

## Tasks
- [x] QA: start dev server, emulate mobile in Chrome DevTools
- [x] QA: simulate column header tap via evaluate_script
- [x] QA: verify sheet renders with correct actions
- [x] QA: test move left / move right / delete / cancel
- [x] QA: check console for errors
- [x] Commit and push


## QA Results

- Column sheet opens correctly for middle column (Move left + Move right + Delete + Cancel)
- Column sheet for leftmost column hides Move left button
- Move left works correctly
- Move right had a bug (used `idx` instead of `idx+1` in `positionForIndex`) — fixed
- Delete column via sheet works, dismisses sheet
- Cancel/dismiss works
- Undo restores deleted column
- Zero console errors across all tests
- Desktop view unaffected
- Build succeeds
