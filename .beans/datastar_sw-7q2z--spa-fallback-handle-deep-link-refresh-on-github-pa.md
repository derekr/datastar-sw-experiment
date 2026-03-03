---
# datastar_sw-7q2z
title: 'SPA fallback: handle deep-link refresh on GitHub Pages'
status: in-progress
type: bug
priority: high
created_at: 2026-03-03T01:32:21Z
updated_at: 2026-03-03T01:32:34Z
---

When someone refreshes or directly navigates to /datastar-sw-experiment/boards/<id>, GitHub Pages returns the index.html but the SW may not be installed yet. Need a 404.html that redirects to index.html (GitHub Pages SPA pattern), and ensure the SW handles the deep-link route on first load after registration.

\n## Plan\n\n- [ ] Add `404.html` to `public/` that redirects to `index.html` preserving the path (GitHub Pages SPA pattern)\n- [ ] Ensure SW handles the deep-link route after first registration + reload\n- [ ] Test: hard refresh on a board URL on GitHub Pages
