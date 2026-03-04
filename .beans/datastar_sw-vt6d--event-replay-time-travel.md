---
# datastar_sw-vt6d
title: Event replay / time travel
status: todo
type: feature
priority: normal
created_at: 2026-03-04T04:36:29Z
updated_at: 2026-03-04T04:36:29Z
---

Scrubber that replays events and shows the board state at any point in history. THE killer demo of event sourcing. rebuildProjection already exists — stop it partway and render.

## Tasks
- [ ] Add a time travel UI (scrubber/slider) to the board view
- [ ] Route to enter time travel mode (server-tracked UI state)
- [ ] Partial replay: replay events up to index N using existing projection logic
- [ ] Render board at historical state (read-only)
- [ ] Exit time travel to return to live state
- [ ] QA
- [ ] Build + commit
