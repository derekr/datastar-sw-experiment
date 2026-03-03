---
# datastar_sw-7q2z
title: 'SPA fallback: handle deep-link refresh on GitHub Pages'
status: completed
type: bug
priority: high
created_at: 2026-03-03T01:32:21Z
updated_at: 2026-03-03T01:35:14Z
---

When someone refreshes or directly navigates to /datastar-sw-experiment/boards/<id>, GitHub Pages returns the index.html but the SW may not be installed yet. Need a 404.html that redirects to index.html (GitHub Pages SPA pattern), and ensure the SW handles the deep-link route on first load after registration.

\n## Plan\n\n- [x] Add `404.html` to `public/` that redirects to `index.html` preserving the path (GitHub Pages SPA pattern)\n- [x] Ensure SW handles the deep-link route after first registration + reload\n- [x] Test: hard refresh on a board URL on GitHub Pages

## Summary of Changes

- Added `public/404.html` — GitHub Pages SPA redirect that stores path in sessionStorage and redirects to root
- Updated `index.html` `reloadOnce()` to check sessionStorage for stored redirect path and navigate there after SW registration
- Tested on live GitHub Pages: deep-links to `/boards/<id>` correctly route through 404→SW registration→redirect flow
