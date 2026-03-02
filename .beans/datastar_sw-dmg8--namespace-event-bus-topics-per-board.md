---
# datastar_sw-dmg8
title: Namespace event bus topics per board
status: completed
type: task
priority: normal
tags:
    - event-sourcing
    - architecture
created_at: 2026-03-02T22:10:24Z
updated_at: 2026-03-02T22:49:14Z
---

Currently all events dispatch a single 'boardChanged' topic on the bus. Every SSE stream receives every event regardless of which board it belongs to.

Namespace topics like: board:<boardId>:changed, boards:changed (for the index).

Benefits:
- Board detail SSE only wakes up for its own board's events
- Boards list SSE can listen to 'boards:changed' for board-level events only
- Board card counts on the index page can update when scoped column/card events fire on the right topic
- Eliminates the stale board card counts issue (currently the boards list skips column/card events)
- Foundation for per-board sync (sync individual board event streams)

The bus remains an in-process EventTarget — just with more granular event names. Each appendEvent figures out the affected boardId from the event data and dispatches on the right topic.
