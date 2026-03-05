---
# datastar_sw-4wy9
title: Context-aware command menu + keyboard selection mode
status: completed
type: feature
priority: high
created_at: 2026-03-05T00:20:41Z
updated_at: 2026-03-05T00:24:38Z
---

Two improvements:
1. Command menu actions reflect current UI state (show 'Exit selection mode' when selecting, 'Exit time travel' when time traveling, etc.)
2. Arrow key navigation in selection mode — arrow keys jump between cards/columns without tabbing, Space/Enter toggles selection on focused card.

## Tasks

- [x] Make buildCommandMenuResults state-aware (check boardUIState for selectionMode, timeTravelPos, showHelp)
- [x] Show contextual exit/toggle actions based on current state
- [x] Show 'Delete N selected' and 'Move to...' actions when cards are selected
- [x] Arrow keys auto-focus first card when nothing focused in selection mode
- [x] Space/Enter on focused card toggles selection
- [x] Disable Ctrl+arrow card moves in selection mode
- [x] Test all flows

## Summary of Changes

**Context-aware command menu**: `buildCommandMenuResults` now reads `boardUIState` to generate state-appropriate actions. In selection mode: shows Exit + batch Delete + Move to [column] for each column. In time travel: shows Exit time travel. Help action toggles between Open/Close based on current state.

**Keyboard selection mode** (eg-kanban.js): Arrow keys auto-focus the first card when nothing is focused. Space/Enter on a focused card triggers selection toggle via click(). Ctrl+arrow card/column moves are disabled during selection mode to prevent accidental drag.
