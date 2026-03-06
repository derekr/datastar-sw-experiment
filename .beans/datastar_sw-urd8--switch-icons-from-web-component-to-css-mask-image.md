---
# datastar_sw-urd8
title: Switch icons from web component to CSS mask-image
status: completed
type: task
priority: normal
created_at: 2026-03-06T15:53:28Z
updated_at: 2026-03-06T15:58:37Z
---

Replace iconify-icon web component with CSS mask-image approach using @iconify/utils getIconsCSS(). Icons become <span> elements styled via CSS classes with data-URI SVGs as mask images. Eliminates CDN script, web component lifecycle, and all flash.

## Plan\n\n- [x] Install @iconify/utils\n- [x] Update vite-plugin-sw.js: generate CSS via getIconsCSS() and inject as __LUCIDE_ICON_CSS__\n- [x] Update Icon component: <span> with CSS classes instead of <iconify-icon>\n- [x] Add icon CSS to stylesheet in sw.jsx\n- [x] Remove iconify-icon CDN script tags and addCollection scripts\n- [x] Remove ArrowLeftIcon/ArrowRightIcon inline SVGs (use CSS approach instead)\n- [x] Build and test

## Summary of Changes

Replaced iconify-icon web component with CSS mask-image approach:
- vite-plugin-sw.js uses @iconify/utils getIconsCSS() to generate CSS at build time from @iconify-json/lucide
- Icon CSS injected via __LUCIDE_ICON_CSS__ Vite define into all 3 stylesheets (main, docs, events)
- Icon component renders <span class="icon--lucide icon--lucide--{name}"> instead of <iconify-icon>
- Removed iconify-icon CDN script, addCollection scripts, and inline SVG components
- Zero JS needed for icons, zero flash, icons render with the stylesheet
