---
# datastar_sw-31v3
title: Add causationId/correlationId to events
status: completed
type: task
priority: normal
tags:
    - event-sourcing
created_at: 2026-03-02T22:10:13Z
updated_at: 2026-03-02T22:46:13Z
---

Events have no causal metadata linking them. Board creation emits 4 unlinked events (board.created + 3x column.created) with no way to trace that the columns belong to the board creation command.

Add to createEvent():
- correlationId: groups all events from a single user action (e.g. 'create board' command)
- causationId: the event ID that directly caused this event (for chaining)

Pass correlationId through command handlers so all events from one command share it. This enables:
- Command tracing / debugging
- Smarter conflict resolution during sync (events in the same correlation group are atomic)
- Undo by correlation group
- Better event log viewer (group related events)
