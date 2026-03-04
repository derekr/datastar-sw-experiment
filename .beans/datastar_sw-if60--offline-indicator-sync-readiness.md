---
# datastar_sw-if60
title: Offline indicator + sync readiness
status: completed
type: feature
priority: normal
created_at: 2026-03-04T04:36:29Z
updated_at: 2026-03-04T14:13:47Z
---

The app works offline but there's zero indication. Show a status chip (local-only / offline / saved) and count of unsynced events.

## Tasks
- [x] Add status chip component to board header
- [x] Track online/offline via navigator.onLine + events (client-side + SW-side listeners)
- [x] Show unsynced event count (total events, all local until sync implemented)
- [x] Push status on connection change (client POSTs to /connection-change)
- [x] QA
- [x] Build + commit


## Summary of Changes

StatusChip component with offline/local/pending/synced states. Client-side online/offline listeners POST to SW /connection-change route. SW pushes board morph with updated status.
