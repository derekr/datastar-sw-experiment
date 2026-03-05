---
# datastar_sw-7259
title: Live event log viewer
status: completed
type: feature
priority: high
created_at: 2026-03-04T23:21:15Z
updated_at: 2026-03-05T02:02:56Z
---

A popup window at /events showing all events streaming in real-time. Global by default with board filter option. Compact one-liner rows that expand on click to show full JSON payload. Triggered from Cmd+K command menu. Makes event sourcing tangible.

## Tasks

Existing /events page already has: SSE stream, expandable details rows, type-colored badges, synced/local badges, rebuild projection button, monospace styling.

- [x] Add human-readable summary to compact rows (e.g. 'Created card "Fix bug" in To Do')
- [x] Add board filter (dropdown or tabs, filter events by boardId)
- [x] Auto-scroll to latest event on new pushes
- [x] Add 'Open event log' action to command menu (opens as popup via window.open)

## Summary of Changes

Enhanced the existing /events page with:
- Human-readable event summaries (e.g. "Created card X", "Renamed board to Y") via summarizeEvent() function
- Board filter dropdown in the header — select a board to see only its events, or "All boards" for everything
- Auto-scroll to top when new events arrive (MutationObserver on the scroll container)
- Command menu integration: "Event log" (filtered to current board) and "Event log (all)" actions in all contexts
- Popup window opens via window.open() from the command menu
- Events annotated with _boardId for filtering (stripped from JSON display)
- Added update color for titleUpdated/descriptionUpdated/labelUpdated event types
