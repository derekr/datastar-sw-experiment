---
# datastar_sw-kpyh
title: 'Speculation Rules: prefetch board pages'
status: completed
type: task
priority: normal
created_at: 2026-03-04T20:57:36Z
updated_at: 2026-03-04T21:00:43Z
---

Add Speculation Rules API to prefetch board pages from the boards list. Warms up SW + IDB before navigation. Prefetch only (not prerender) to avoid SSE/Datastar complications.

## Summary of Changes

Added `<script type="speculationrules">` to the boards list page head. Uses `source: document` with `href_matches` to auto-match board links. Eagerness set to `moderate` (prefetch on hover). Warms up the SW and pre-fetches board HTML before navigation. Only present on the boards list page, not on board pages (avoids SSE complications).
