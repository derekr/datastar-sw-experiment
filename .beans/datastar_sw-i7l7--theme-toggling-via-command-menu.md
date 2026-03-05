---
# datastar_sw-i7l7
title: Theme toggling via command menu
status: completed
type: feature
priority: normal
created_at: 2026-03-05T17:47:33Z
updated_at: 2026-03-05T17:58:55Z
---

Add Change theme action to Cmd+K command menu with Light/Dark/System options. Replace stellar.css media-query-based dark mode with data-theme attribute selector so JS can control it.

## Tasks

- [x] Modify stellar.css: replace `@media (prefers-color-scheme: dark) { :root {` with `:root[data-theme="dark"] {`
- [x] Add theme detection inline script in Shell `<head>` (before stylesheets, prevents FOUC)
- [x] Add `applyTheme()` global function in Shell body script
- [x] Add "Change theme" action to command menu results
- [x] Add `POST /command-menu/theme` route for theme submenu
- [x] Build theme option results with Light/Dark/System choices
- [x] Update `<meta name="theme-color">` dynamically
- [x] Build and verify
- [x] Visual test: dark, light, system modes


## Summary of Changes

Replaced all @media (prefers-color-scheme: dark) blocks in stellar.css with :root[data-theme="dark"] attribute selectors (15 total: 4 outer + 11 inner :root blocks). Added inline theme detection script in Shell <head> that reads localStorage before first paint (prevents FOUC), sets data-theme attribute, and exposes global applyTheme() function. Added "Change theme" action to Cmd+K command menu on all pages, with a drill-down submenu showing System/Light/Dark options with checkmark for current selection. Theme preference persists via localStorage. Meta theme-color updates dynamically (#121017 dark, #f4eefa light). System mode listens for OS preference changes via matchMedia. EventsPage also gets theme detection.
