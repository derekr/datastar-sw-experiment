---
# datastar_sw-5eoj
title: Bundle Lucide icon subset for instant rendering
status: completed
type: task
priority: normal
created_at: 2026-03-06T14:30:31Z
updated_at: 2026-03-06T14:33:21Z
---

Install @iconify-json/lucide, extract the ~12 icons we use at build time via vite-plugin-sw.js, inject as addCollection() inline script after the iconify-icon CDN tag. Eliminates API fetch delay/flash.

## Plan\n\n- [x] Install `@iconify-json/lucide`\n- [x] In vite-plugin-sw.js, extract subset at build time and inject via `define`\n- [x] In sw.jsx, emit inline `<script>` calling `addCollection()` after CDN tag\n- [x] Test that icons render without API fetch delay

## Summary of Changes

Bundled a subset of 16 Lucide icons at build time to eliminate API fetch delay. `vite-plugin-sw.js` reads `@iconify-json/lucide/icons.json`, extracts only the icons used by the app, and injects the data as `__LUCIDE_ICON_DATA__` via Vite `define`. All 3 HTML shells (Shell, DocsLayout, EventsPage) now emit an inline `<script>IconifyIcon.addCollection(...)</script>` immediately after the CDN web component script, so icons render from bundled data instead of fetching from the Iconify API.
