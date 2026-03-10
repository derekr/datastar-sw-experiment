---
# datastar_sw-swg2
title: 'Fix SW prod build: emit IIFE from plugin instead of main rollup'
status: completed
type: bug
priority: normal
created_at: 2026-03-10T01:20:19Z
updated_at: 2026-03-10T01:20:56Z
---

sw.jsx is listed as a rollup input in vite.config.js, so it gets bundled as an ES module with import statements. SWs need an IIFE. Move SW prod build into the plugin's generateBundle hook.

## Summary of Changes\n\nRemoved `sw: './sw.jsx'` from vite.config.js rollup inputs — the main build was bundling sw.jsx as an ES module with code-split imports, which browsers reject for service workers. The plugin's `generateBundle` hook now calls `buildSW()` (which uses `format: 'iife'`) and emits the self-contained `sw.js` as an asset.
