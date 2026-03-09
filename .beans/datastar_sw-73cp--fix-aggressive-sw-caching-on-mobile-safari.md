---
# datastar_sw-73cp
title: Fix aggressive SW caching on mobile Safari
status: completed
type: bug
priority: normal
created_at: 2026-03-09T20:53:24Z
updated_at: 2026-03-09T22:20:02Z
---

GitHub Pages CDN caches sw.js for ~10 minutes. Without updateViaCache: 'none', the browser uses HTTP cache for SW update checks, so mobile Safari can serve stale SW versions indefinitely after deploys.

## Summary of Changes\n\nAdded `updateViaCache: 'none'` to SW registration in `index.html` (new installs) and re-registration in `shell.jsx` (existing installs). This forces the browser to send conditional requests for `sw.js` during update checks, bypassing HTTP cache and causing the GitHub Pages CDN to revalidate.

\n\n## Follow-up: navigation-trigger update check\n\nAdded `self.registration.update()` in the SW fetch handler on navigation requests. Once a user has the new SW, every page navigation triggers an update check — belt-and-suspenders with the Shell's 60s polling.
