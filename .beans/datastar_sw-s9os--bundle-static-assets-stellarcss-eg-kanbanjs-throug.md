---
# datastar_sw-s9os
title: Bundle static assets (stellar.css, eg-kanban.js) through Vite for hashed filenames
status: completed
type: task
priority: high
created_at: 2026-03-05T18:21:39Z
updated_at: 2026-03-05T18:23:53Z
---

Move stellar.css and eg-kanban.js from public/ into Vite's build pipeline so they get content-hashed filenames for cache busting on GitHub Pages. Use vite-plugin-sw.js to inject asset URLs via define constants.

## Plan

- [x] Modify `vite-plugin-sw.js`: add `config()` hook with `define` for asset URLs, `generateBundle()` hook to hash+emit assets in prod, pass `define` to inner `buildSW()`, add dev middleware for source files
- [x] Update `sw.jsx`: replace hardcoded `css/stellar.css` and `eg-kanban.js` paths with defined constants
- [x] Remove `public/css/stellar.css` and `public/eg-kanban.js`
- [x] Test dev build (`pnpm dev`)
- [x] Test production build (`pnpm build`)

## Summary of Changes

Modified `vite-plugin-sw.js` to hash and emit `stellar.css` and `eg-kanban.js` as versioned assets (`assets/stellar-{hash}.css`, `assets/eg-kanban-{hash}.js`). Uses Vite `define` to inject `__STELLAR_CSS__` and `__KANBAN_JS__` globals into `sw.jsx`. In dev, assets are served from source paths via middleware. In prod, `generateBundle()` emits hashed copies. Removed both files from `public/`.
