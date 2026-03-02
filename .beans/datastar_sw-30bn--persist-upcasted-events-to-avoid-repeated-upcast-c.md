---
# datastar_sw-30bn
title: Persist upcasted events to avoid repeated upcast cost
status: completed
type: task
priority: low
tags:
    - event-sourcing
    - cleanup
created_at: 2026-03-02T22:10:51Z
updated_at: 2026-03-02T23:23:22Z
---

upcast() is called inside applyEvent() on every replay. Old events (e.g. column.created v1) are upcasted to v2 every time rebuildProjection() runs, but the upcasted version is never written back to the events store.

Add a lazy migration: after upcasting, if the version changed, write the upcasted event back to the store in the same transaction. This makes replay faster over time as old events get migrated in-place.

Alternative: periodic compaction pass that rewrites all events to current schema.
