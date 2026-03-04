---
# datastar_sw-0ydv
title: PWA manifest + installability
status: completed
type: feature
priority: high
created_at: 2026-03-04T04:36:29Z
updated_at: 2026-03-04T04:40:54Z
---

Add manifest.json with app icons, theme color, display: standalone. Makes the app installable to home screen — fundamentally changes perception from 'website' to 'native app.'

## Tasks
- [x] Create manifest.json (name, short_name, icons, theme_color, background_color, display: standalone, start_url, scope)
- [x] Generate/create app icons (SVG + 192px + 512px PNG + maskable) (192x192, 512x512 minimum)
- [x] Add `<link rel=manifest>` to Shell and index.html
- [x] Add mobile-web-app-capable (updated from deprecated apple- prefix) + apple-touch-icon meta tags
- [x] Add theme-color meta tag
- [x] QA: manifest loads, icons resolve, no errors
- [x] Build + commit


## Summary of Changes

- Created manifest.json with name, icons (SVG, 192px PNG, 512px PNG, maskable 512px), display: standalone, theme/bg color #0f172a
- Generated kanban-inspired SVG icons and raster PNGs via ImageMagick
- Added manifest link, theme-color, mobile-web-app-capable, apple-touch-icon to Shell and index.html
- Updated SW fetch handler to pass through static assets (.js, .css, .png, .svg, .json, etc.) to network instead of routing through Hono
- Also added manifest/icon links to EventsPage head
