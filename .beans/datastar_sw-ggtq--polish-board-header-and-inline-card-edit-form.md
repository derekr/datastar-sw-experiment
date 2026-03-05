---
# datastar_sw-ggtq
title: Polish board header and inline card edit form
status: completed
type: task
priority: high
created_at: 2026-03-05T19:30:21Z
updated_at: 2026-03-05T19:38:44Z
---

Board header: shrink toolbar buttons to Stellar scale, merge back link + title into single back-nav like card detail. Expanded card: fix icon alignment, add vertical spacing between form sections.

## Tasks

- [x] Board header: merge back link + title into single back-nav element
- [x] Board header: shrink toolbar buttons (Select/History/Share)
- [x] Expanded card: fix icon misalignment (edit/expand/delete)
- [x] Expanded card: more vertical spacing between inputs, label picker, action row
- [x] Visual QA in browser

## Summary of Changes

**Board header:**
- Merged back link + title into single `← Board Title` back-nav element (matches card detail pattern)
- Added pencil icon button for title editing (replaces click-on-title to edit)
- Shrunk Select/History/Share buttons: removed `min-height: 44px`, reduced padding from `6px 14px` to `4px 10px`

**Card action icons:**
- Unified all three buttons (edit/expand/delete) to consistent `inline-flex`, `padding: 6px`, `font-size: var(--font-size--1)`, `border-radius: 4px`
- Fixed delete button using `--font-size-1` (one step larger) → now matches edit/expand at `--font-size--1`
- Added hover background to all three for consistency
- Set `align-items: center` on `.card-actions` container

**Inline edit form:**
- Increased form gap from `6px` to `var(--size--2)` (~12px) for better breathing room between title, description, label picker, and action row
