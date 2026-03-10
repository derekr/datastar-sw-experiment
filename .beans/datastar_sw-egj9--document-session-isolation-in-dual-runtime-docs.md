---
# datastar_sw-egj9
title: Document session isolation in dual runtime docs
status: completed
type: task
priority: normal
created_at: 2026-03-10T00:43:42Z
updated_at: 2026-03-10T00:46:03Z
---

Update the Event Sourcing & CQRS docs topic with CQRS performance characteristics, comparison to single-flight mutations + TanStack Query invalidation patterns, and why the two-roundtrip objection doesn't apply here.

## Summary of Changes\n\nAdded three new sections to the Event Sourcing & CQRS docs topic:\n\n- **What complexity disappears** — stale siblings / invalidateQueries problem, optimistic update rollback, multi-client sync\n- **Single-flight mutations** — comparison table vs CQRS+SSE (response coupling, stale data, invalidation, latency)\n- **Performance** — the two-roundtrip objection, SSE stream already open, 204 faster than formatted response, natural batching\n\nAlso added session isolation section to Dual Runtime docs and CLAUDE.md.
