---
# datastar_sw-nnlq
title: 'Docs: Compression for SSE — Brotli Tradeoffs'
status: todo
type: task
priority: low
created_at: 2026-03-05T23:42:37Z
updated_at: 2026-03-05T23:42:37Z
---

Bonus section. Brotli compression is a big optimization for long-lived SSE connections pushing many HTML patch updates. Can't implement in service worker easily (no compression API). Cover: Accept-Encoding: br, streaming compression, tradeoffs with SW (would need Edge worker or real server). Mention that with a real backend, this is a significant optimization for high-frequency morphs.
