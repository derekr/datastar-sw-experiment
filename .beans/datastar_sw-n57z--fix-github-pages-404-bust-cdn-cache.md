---
# datastar_sw-n57z
title: Fix GitHub Pages 404 — bust CDN cache
status: in-progress
type: bug
priority: high
created_at: 2026-03-03T00:48:00Z
updated_at: 2026-03-03T00:48:00Z
---

The deployed GitHub Pages site returns 404 for main-BIQ9p-xU.js and sw.js from the browser, even though the files exist on the origin. This is due to GitHub Pages CDN caching stale 404 responses from the initial deploy. Fix: add workflow_dispatch trigger, bust the Vite content hash, and redeploy.
