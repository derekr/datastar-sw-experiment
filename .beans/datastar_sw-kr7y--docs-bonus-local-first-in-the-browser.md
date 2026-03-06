---
# datastar_sw-kr7y
title: 'Docs (bonus): Local-First in the Browser'
status: completed
type: task
priority: normal
created_at: 2026-03-05T20:48:32Z
updated_at: 2026-03-06T01:25:42Z
parent: datastar_sw-9bz9
blocked_by:
    - datastar_sw-yzrf
---

Bonus section. Datastar is NOT built for local-first — this demo pushes it into territory it wasn't designed for. Local-first in the browser is still experimental (limited storage APIs, no durable persistence guarantees, SW lifecycle issues). Data lives on-device, works offline by default, no auth/API keys/server costs. Trade-offs: no cross-device sync (yet), ephemeral SW state, browser can evict storage. The event log is sync-ready if you add a transport layer (the WebRTC draft bean). Honest about the limitations.

## Summary of Changes\n\nAdded DocsLocalFirstContent component (6 sections) covering: what local-first means here, tradeoffs (no cross-device sync, SW lifecycle, storage eviction), event log is sync-ready, and honest assessment that Datastar isn't built for local-first.
