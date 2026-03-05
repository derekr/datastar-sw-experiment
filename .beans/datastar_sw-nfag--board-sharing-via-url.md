---
# datastar_sw-nfag
title: Board sharing via URL
status: completed
type: feature
priority: high
created_at: 2026-03-04T23:21:23Z
updated_at: 2026-03-05T05:07:59Z
---

Export a board's event log as a shareable URL. Opening the URL on another device imports the events and rebuilds the board — no server needed. Follows Tao of Datastar: export button POSTs to SW, SW serializes events, returns a URL. Import detects URL params on load, replays events into IndexedDB.

## Tasks

- [x] Add SW route to export board events as compressed JSON
- [x] Generate shareable URL with encoded event data (hash fragment with deflate + base64url)
- [x] Add import detection on page load (Shell inline script checks #import= hash)
- [x] Replay imported events into IndexedDB and rebuild projection (with ID remapping)
- [x] Add share button to board UI + command menu action
- [x] Handle large boards (deflate via CompressionStream, no external deps)
- [x] Show import success (redirect to imported board) + Copied! button feedback

## Summary of Changes

Board sharing via compressed URL hash fragment:
- Export: POST /boards/:id/share compresses events with CompressionStream (deflate) + base64url encoding
- Import: POST /import decompresses, remaps all entity IDs to avoid collisions, replays into IndexedDB
- Share button in board header copies URL to clipboard with "Copied!" feedback
- Import detection in Shell inline script (runs on every SW-served page)
- Share board action in Cmd+K command menu (all contexts with a current board)
- Also kept import fallback in index.html for first-install scenario
- 13 events for a 3-column/3-card board compresses to ~1440 chars — well within URL limits
