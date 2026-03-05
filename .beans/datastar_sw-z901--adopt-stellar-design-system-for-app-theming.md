---
# datastar_sw-z901
title: Adopt stellar design system for app theming
status: completed
type: task
priority: normal
created_at: 2026-03-05T17:32:07Z
updated_at: 2026-03-05T17:41:28Z
---

Replace all hardcoded hex colors in sw.jsx CSS with stellar CSS custom properties. Serve stellar.css from public/. Gets automatic light/dark mode support.

## Tasks

- [x] Copy stellar.css to public/css/
- [x] Add `<link>` to Shell component to load stellar.css
- [x] Map hardcoded hex colors → stellar CSS variables
- [x] Replace all background colors in CSS string
- [x] Replace all border colors in CSS string
- [x] Replace all text colors in CSS string
- [x] Replace all accent/interactive colors in CSS string
- [x] Replace all danger/error colors in CSS string
- [x] Replace all status indicator colors in CSS string
- [x] Update label colors to use stellar named vars where possible (kept hardcoded — intentional)
- [x] Switch font-family to Inter
- [x] Build and verify
- [x] Test in browser (dark mode)
- [x] Test light mode


## Summary of Changes

Replaced all 31 unique hardcoded hex colors across both CSS strings (main ~1350 lines + events page CSS) with Stellar design system CSS custom properties. Converted 7 rgba() values to color-mix(in oklch, ...) with stellar vars. Added stellar.css to public/css/ and linked it in Shell and EventsPage <head> tags. Updated meta theme-color to stellar neutral-1 dark. Switched body font to Inter and events page to Inconsolata. LABEL_COLORS kept as hardcoded hex (intentional — semantic visual indicators). Both dark and light modes verified working via Stellar's @media (prefers-color-scheme: dark) automatic palette inversion. Build passes.
