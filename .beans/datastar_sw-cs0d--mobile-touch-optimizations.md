---
# datastar_sw-cs0d
title: Mobile touch optimizations
status: completed
type: task
priority: high
created_at: 2026-03-04T01:17:47Z
updated_at: 2026-03-04T01:21:31Z
---

Bundle of mobile UX improvements to make the kanban feel native on touch devices.

## Tasks
- [x] `touch-action: manipulation` on interactive elements (remove 300ms tap delay)
- [x] `font-size >= 16px` on inputs/textareas (prevent iOS auto-zoom)
- [x] `overscroll-behavior` on body + columns (prevent pull-to-refresh, back-nav)
- [x] Safe area insets for notched devices (viewport-fit=cover, env() padding)
- [x] Suppress long-press context menu on cards (`-webkit-touch-callout: none`)
- [x] Audit eg-kanban.js for passive listener issues (clean — only uses pointer events)
- [x] QA on mobile emulation
- [x] Build + commit


## Summary of Changes

- `touch-action: manipulation` on all interactive elements (a, button, input, textarea, [tabindex]) removes 300ms tap delay
- `input:not(#_), textarea:not(#_)` rule forces `font-size: max(1rem, 16px)` to prevent iOS Safari auto-zoom on focus
- `overscroll-behavior: none` on body prevents pull-to-refresh; `overscroll-behavior-x: contain` on .columns prevents back-navigation
- `viewport-fit=cover` + `env(safe-area-inset-*)` padding on action sheet, selection bar, and body for notched devices
- `-webkit-touch-callout: none` on .card and .column-header suppresses long-press context menu
- eg-kanban.js audit: only uses pointer events + keydown — no passive listener issues
