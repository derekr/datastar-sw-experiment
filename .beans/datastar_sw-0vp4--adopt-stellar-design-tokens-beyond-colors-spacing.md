---
# datastar_sw-0vp4
title: Adopt Stellar design tokens beyond colors (spacing, typography, radii, shadows, transitions)
status: completed
type: task
priority: high
created_at: 2026-03-05T19:11:48Z
updated_at: 2026-03-05T19:22:37Z
---

The app only uses Stellar color tokens. Spacing, font sizes, border-radius, box-shadows, transitions, and z-index are all hardcoded with inconsistent values. Adopt Stellar's full token set for visual consistency and polish.

## Plan

Work through the CSS block in sw.jsx systematically. The Stellar spacing scale is fluid (clamp-based), which is great for layout spacing but too coarse for tight UI elements like card padding and button gaps.

### Mapping strategy

**Font sizes** → map to `--font-size-*` scale (-2 through 12)
**Font weights** → map to `--font-weight-*` tokens
**Border radius** → map to `--border-radius-*` scale (0-6, fluid)
**Box shadows** → map to `--shadow-*` elevation levels (-4 through 6)
**Transitions** → map universal 0.15s to `--anim-duration-fast`, use `--anim-ease-standard`
**Z-index** → map overlays to `--zindex-*` semantic tokens
**Border widths** → map to `--border-width-*` scale
**Spacing** → use `--size-*` for layout-level spacing; for tight UI spacing (2-8px) keep px or use calc fractions of size tokens

### Tasks

- [x] Replace font-size values with `--font-size-*` tokens
- [x] Replace font-weight values with `--font-weight-*` tokens
- [x] Replace border-radius values with `--border-radius-*` tokens
- [x] Replace box-shadow values with `--shadow-*` tokens
- [x] Replace transitions with `--anim-duration-*` + `--anim-ease-*` tokens
- [x] Replace z-index values with `--zindex-*` tokens where applicable
- [x] Replace border-width values with `--border-width-*` tokens
- [x] Replace layout spacing (padding, margin, gap) with `--size-*` tokens
- [x] Visual QA in browser

## Summary of Changes

Replaced ~193 hardcoded CSS values in sw.jsx with Stellar design system tokens:

- **Font weights**: All `font-weight: 400/500/600/700` → `var(--font-weight-*)` tokens (21 replacements)
- **Font sizes**: Consolidated 12 arbitrary sizes (0.7–1.5rem) → 5 Stellar scale steps (`--font-size--2` through `--font-size-2`) (~75 replacements)
- **Border radius**: Mapped 6/8/10/12/16px → `--border-radius-0` through `--border-radius-3` (~50 replacements). Kept 4px for very small elements.
- **Box shadows**: Replaced raw `rgba()` shadows → `--shadow-3` through `--shadow-6` elevation tokens (5 replacements)
- **Transitions**: All `0.15s` → `var(--anim-duration-fast)` (20 replacements). All `cubic-bezier(0.2, 0, 0, 1)` → `var(--anim-ease-emphasized)` (5 replacements)
- **Z-index**: Mapped overlay layers to semantic `--zindex-drawer/dialog/dropdown` tokens (3 replacements)
- **Border widths**: Mapped `2px dashed` borders → `var(--border-width-1)` (3 replacements)
- **Layout spacing**: Replaced 12–24px padding/margin/gap on layout containers → `var(--size-*)` tokens (~20 replacements)

### What was NOT changed (intentionally):
- Small UI spacing (2–8px) — Stellar size tokens start at ~12px, too coarse for tight kanban density
- `border: 1px solid` — `--border-width-0` (1.6px) would be noticeably thicker
- `em`-based font sizes in events CSS — intentionally relative to parent context
- `4px` border-radius — too small for `--border-radius-0` (7.9px)
- Inline style on one-off elements
- `50%` border-radius (circles) — not part of the scale
