---
# datastar_sw-5do9
title: 'Docs (bonus): Service Worker as Server'
status: in-progress
type: task
priority: normal
created_at: 2026-03-05T20:48:21Z
updated_at: 2026-03-05T22:57:58Z
parent: datastar_sw-9bz9
blocked_by:
    - datastar_sw-yzrf
---

Bonus section. The SW-as-server is not a recommended Datastar pattern — it's an interesting experiment and the means to make this educational resource self-contained. Datastar is best suited with a real backend in any language. Cover: fetch interception, scope/base path, routing via Hono, SW lifecycle (install/activate/idle kill/restart). Pros: zero infrastructure, fully offline, single-file server. Cons: browser kills idle SWs after ~30s (ephemeral in-memory state), Safari fetch handler quirks with subresource requests, no WebSocket support, debugging in a separate console context, DX friction (must unregister to pick up changes).
