---
# datastar_sw-cff8
title: Multi-tab sync visibility
status: in-progress
type: feature
priority: high
created_at: 2026-03-04T04:36:29Z
updated_at: 2026-03-04T05:11:01Z
---

The SW already syncs across tabs via SSE — changes in one tab morph the other tab in real-time. But there's no indication this is happening. Add a small presence indicator showing connected tab count.

## Tasks
- [x] Track tab count per board using self.clients.matchAll() API
- [x] Show tab count indicator in board header ('2 tabs' badge)
- [x] Push updated count when tabs connect/disconnect (debounced)
- [x] Add strategic id attributes to board-header elements for Idiomorph stability\n- [x] Clean up debug logging (swLog, message listener)\n- [x] QA: open two tabs on same board, verify count and real-time sync
- [ ] Build + commit\n\n## Summary of Changes\n\nAdded multi-tab presence indicator showing how many browser tabs are viewing the same board.\n\n### Approach\n- Uses `self.clients.matchAll()` to count tabs by matching URL pathname — far more reliable than tracking SSE stream connect/disconnect which is fragile due to Datastar's SSE reconnect cycle.\n- Debounced `notifyTabChange()` fires a UI event 300ms after any stream connect/disconnect, allowing transient reconnects to settle before pushing.\n- Badge shows "N tabs" when N > 1, hidden when only 1 tab.\n\n### Key fixes\n- Added strategic `id` attributes to board-header elements (`#board-header`, `#board-back`, `#board-title`, `#select-mode-btn`) so Idiomorph can reliably match and morph them.\n- `#tab-count` span is always rendered in the DOM (toggled via CSS class) to avoid Idiomorph insertion issues.\n- Discovered that stream-based connection counting is unreliable because Datastar's initial morph can trigger SSE reconnect cycles, causing connect/disconnect to be unbalanced.
