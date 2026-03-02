---
# datastar_sw-ip9m
title: Batch appendEvents() for multi-event commands
status: completed
type: task
priority: normal
tags:
    - event-sourcing
created_at: 2026-03-02T22:10:31Z
updated_at: 2026-03-02T22:47:03Z
---

Board creation appends 4 events in 4 separate IDB transactions, each dispatching a separate boardChanged event (4 SSE pushes). This is inefficient and breaks atomicity — if the SW dies between event 2 and 3, the board has partial columns.

Add appendEvents(events[]) that:
- Writes all events + applies all projections in a single IDB transaction
- Dispatches a single bus event after commit (or one per event if granular topics exist)
- Shares a correlationId across all events in the batch

Use for: board creation (board.created + 3x column.created), and any future multi-step commands.
