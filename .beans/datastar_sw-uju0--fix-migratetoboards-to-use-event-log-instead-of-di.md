---
# datastar_sw-uju0
title: Fix migrateToBoards to use event log instead of direct projection write
status: completed
type: task
priority: normal
tags:
    - event-sourcing
    - cleanup
created_at: 2026-03-02T22:10:59Z
updated_at: 2026-03-02T22:50:42Z
---

migrateToBoards() (sw.jsx ~line 247-249) tags existing columns with boardId by writing directly to the columns object store, bypassing the event log. This means the projection has state not derivable from events alone.

It happens to work because the column.created v1→v2 upcaster also backfills boardId:'default', so rebuildProjection() produces the same result. But this is fragile — correctness depends on the upcaster and direct write agreeing.

Fix: emit column.updated events (or a new migration event type) that set boardId, instead of writing directly to the store.
