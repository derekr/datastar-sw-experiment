---
# datastar_sw-egos
title: Add actor/origin field to events
status: completed
type: task
priority: normal
tags:
    - event-sourcing
    - sync
created_at: 2026-03-02T22:10:39Z
updated_at: 2026-03-02T22:50:02Z
---

Events have no actor or origin identifier. For single-device this is fine, but sync requires knowing which device produced an event for:
- Last-writer-wins conflict resolution
- Showing 'edited on device X' in audit trails
- Filtering own events during pull (don't re-apply events you created)

Add to createEvent():
- actorId: a stable device identifier (crypto.randomUUID() stored in IDB meta on first run)

Generate the actorId once during initialize() and persist it. This becomes the device identity for sync. Future auth (mnemonic-based identity) would layer a user identity on top.
