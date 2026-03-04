---
# datastar_sw-if60
title: Offline indicator + sync readiness
status: todo
type: feature
priority: normal
created_at: 2026-03-04T04:36:29Z
updated_at: 2026-03-04T04:36:29Z
---

The app works offline but there's zero indication. Show a status chip (local-only / offline / saved) and count of unsynced events.

## Tasks
- [ ] Add status chip component to board header
- [ ] Track online/offline via navigator.onLine + events (client-side signal — one of the few acceptable ones)
- [ ] Show unsynced event count from events with synced: false
- [ ] Push status on connection change
- [ ] QA
- [ ] Build + commit
