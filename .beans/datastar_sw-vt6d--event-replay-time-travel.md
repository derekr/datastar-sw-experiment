---
# datastar_sw-vt6d
title: Event replay / time travel
status: completed
type: feature
priority: normal
created_at: 2026-03-04T04:36:29Z
updated_at: 2026-03-04T05:56:12Z
---

Scrubber that replays events and shows the board state at any point in history. THE killer demo of event sourcing. rebuildProjection already exists — stop it partway and render.

## Approach\n\nIn-memory replay adapter: fake IDB tx backed by Maps, reuse existing applyEvent. Store board-relevant events + position in boardUIState. Slider shows event types as labels. Board rendered read-only.\n\n## Tasks
- [x] Add a time travel UI (scrubber/slider) to the board view
- [x] Route to enter time travel mode (server-tracked UI state)
- [x] Partial replay: replay events up to index N using existing projection logic
- [x] Render board at historical state (read-only)
- [x] Exit time travel to return to live state
- [x] QA
- [x] Build + commit


## Summary of Changes

Implemented event replay / time travel feature:
- `createMemoryTx()` — fake IDB transaction backed by Maps for in-memory replay
- `replayToPosition(events, idx, boardId)` — replays events up to a position
- `loadTimeTravelEvents(boardId)` — loads board-specific events with indices
- `TimeTravelBar` component with slider, step buttons, event label + timestamp, Exit button
- Board/Column/Card components go read-only in time travel mode
- Routes: enter, seek, exit time travel
- SSE `pushBoard` detects time travel mode and uses replay instead of live DB
- Step buttons and slider use direct `fetch()` with form-urlencoded body
