---
# datastar_sw-m05q
title: 'Fix back link: let anchor tag navigate natively'
status: completed
type: task
priority: low
tags:
    - cleanup
    - datastar
created_at: 2026-03-02T22:11:30Z
updated_at: 2026-03-02T23:22:20Z
---

The back link (sw.jsx ~line 395) uses:
  <a href='/' class='back-link' data-on:click__prevent="window.location.href = '/'">← Boards</a>

The data-on:click__prevent overrides the native anchor behavior, which breaks:
- Middle-click to open in new tab
- Cmd/Ctrl+click to open in new tab
- Right-click 'Open in new tab'
- Browser prefetching hints

The href='/' already points to the right place. Remove the data-on:click__prevent and let the anchor work natively. MPA view transitions (@view-transition { navigation: auto }) will still fire on native navigations.
