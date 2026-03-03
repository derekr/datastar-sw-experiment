---
# datastar_sw-j64o
title: Export/import event log
status: completed
type: feature
priority: normal
created_at: 2026-03-03T01:32:27Z
updated_at: 2026-03-03T01:45:35Z
---

Allow exporting the full event log as JSON for backup, and importing it to restore state on another device or after clearing data. UI: buttons in the event log page or board settings. Import should replay events through appendEvents and rebuild projection.

\n## Plan\n\n- [x] Add GET /export route that returns all events as JSON download\n- [x] Add POST /import route that accepts JSON event array and replays via appendEvents\n- [x] Add Export/Import buttons to the boards list page\n- [x] Test: export → clear data → import → verify boards restored

## Summary of Changes

- `GET /export` returns all events as JSON with `Content-Disposition: attachment` header
- `POST /import` accepts a JSON array of events and replays through `appendEvents` (deduplicates by event id)
- Boards list page: Export link (downloads JSON file) + Import button (file picker → POST to /import → reload)
- CSS: `.boards-toolbar` and `.toolbar-btn` styles
