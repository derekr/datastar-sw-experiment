---
# datastar_sw-xxeb
title: Add snapshot/checkpoint support for rebuildProjection
status: completed
type: task
priority: low
tags:
    - event-sourcing
    - performance
created_at: 2026-03-02T22:11:15Z
updated_at: 2026-03-02T23:24:07Z
---

rebuildProjection() loads all events via getAll() into memory and replays from the beginning. No snapshots or checkpoints exist.

For a local kanban app with hundreds of events this is fine. But as the event log grows (especially with sync pulling remote events), replay gets slower.

Add:
- Periodic snapshots: serialize projection state at seq N, store in IDB meta
- rebuildProjection(fromSnapshot=true): load snapshot, replay only events after snapshot seq
- Snapshot on demand (e.g. every 100 events, or on SW activation)

Low priority — only matters once the event log gets large.
