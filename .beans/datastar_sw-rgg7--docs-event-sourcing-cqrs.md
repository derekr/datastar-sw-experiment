---
# datastar_sw-rgg7
title: 'Docs: Event Sourcing & CQRS'
status: completed
type: task
priority: high
created_at: 2026-03-05T20:48:06Z
updated_at: 2026-03-05T22:37:04Z
parent: datastar_sw-9bz9
blocked_by:
    - datastar_sw-yzrf
---

Core topic. Commands (POST/PUT/DELETE) write events, projections derive read state. Event log as source of truth. Snapshots, replay, upcasting. Interactive: hooked to real event store — buttons that write events, live event log display, 'replay from scratch' demo showing projection rebuild.

## Summary of Changes\n\n- Created DocsEventSourcingContent component with 9 sections covering event structure, event types, commands, CQRS, projections, snapshots, upcasting, and free features\n- Extracted DocsPager component (shared prev/next nav for topic pages)\n- Added DocsTopicContent lookup function that dispatches to topic-specific components or falls back to stub\n- Updated /docs/:slug route to use DocsTopicContent\n- Added CSS for docs-list, docs-event-types grid, docs-event-group\n- Updated index page: reframed as server-driven (not local-first), added 'no virtual DOM diffing' point, improved Datastar SSE description
