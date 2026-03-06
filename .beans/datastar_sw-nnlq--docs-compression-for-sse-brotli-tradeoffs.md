---
# datastar_sw-nnlq
title: 'Docs: Compression for SSE — Brotli Tradeoffs'
status: completed
type: task
priority: low
created_at: 2026-03-05T23:42:37Z
updated_at: 2026-03-06T01:38:55Z
---

Bonus section. Brotli compression is a big optimization for long-lived SSE connections pushing many HTML patch updates. Can't implement in service worker easily (no compression API). Cover: Accept-Encoding: br, streaming compression, tradeoffs with SW (would need Edge worker or real server). Mention that with a real backend, this is a significant optimization for high-frequency morphs.

## Summary of Changes\n\nAdded DocsBrotliContent component (4 sections) covering: the compression optimization, service worker limitation (no Compression Streams API), and tradeoffs.
