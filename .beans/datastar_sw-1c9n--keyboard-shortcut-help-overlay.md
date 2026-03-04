---
# datastar_sw-1c9n
title: Keyboard shortcut help overlay
status: completed
type: task
priority: low
created_at: 2026-03-04T04:36:29Z
updated_at: 2026-03-04T17:00:14Z
---

? shortcut shows a modal listing all keyboard shortcuts. Surfaces existing hidden functionality (undo/redo, arrow navigation).

## Tasks
- [x] Add ? keydown handler in Shell script
- [x] Server-tracked showHelp UI state in boardUIState
- [x] HelpOverlay component: Navigate, Move Items, Actions sections
- [x] Dismiss on Escape, backdrop click, or close button
- [x] QA
- [x] Build + commit


## Summary of Changes

Help overlay triggered by ? key. Server-tracked showHelp state. HelpOverlay component lists all shortcuts in 3 sections (Navigate, Move Items, Actions). Dismiss via Escape, backdrop click, or close button. Skips when typing in inputs.
