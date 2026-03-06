---
# datastar_sw-nkgf
title: Add zweiundeins SPA-vs-Hypermedia benchmark citations to docs
status: completed
type: task
priority: normal
created_at: 2026-03-06T19:28:04Z
updated_at: 2026-03-06T19:29:20Z
parent: datastar_sw-9bz9
---

Cite specific data points from https://zweiundeins.gmbh/en/methodology/spa-vs-hypermedia-real-world-performance-under-load in relevant docs pages. Key citation targets:\n\n- [x] SSE & Fat Morphing page (DocsFatMorphingContent): cite the 58.5× Brotli compression ratio on persistent SSE streams\n- [x] Brotli docs page (DocsBrotliContent): cite the real-world Brotli compression numbers (18.7× single turn, 58.5× over 10 turns)\n- [x] Local-First page (DocsLocalFirstContent): cite article's 'offline-first is a reason to choose SPA' framing — our project challenges that assumption\n- [x] Overview page (DocsIndexContent): consider linking to the article as external validation of the architecture

## Summary of Changes

Added citations from the zweiundeins.gmbh SPA-vs-Hypermedia benchmark (Feb 2026) to four docs pages:

1. **DocsBrotliContent** — New "Real-world numbers" section with 18.7× single-turn and 58.5× multi-turn Brotli compression data, plus the key insight about persistent SSE dictionary building
2. **DocsFatMorphingContent** — Updated existing Brotli paragraph with the 58.5× benchmark figure and link
3. **DocsLocalFirstContent** — New "The conventional wisdom" section noting the article lists offline-first as an SPA reason, and framing this project as an experiment in the opposite direction
4. **DocsIndexContent** — New "Further Reading" section with a summary link to the article highlighting key metrics (100 vs 54 Lighthouse, 7.5× TTI, 0ms TBT, 26× less data, 58.5× Brotli)
