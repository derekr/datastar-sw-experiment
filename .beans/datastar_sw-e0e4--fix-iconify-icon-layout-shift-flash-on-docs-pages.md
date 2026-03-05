---
# datastar_sw-e0e4
title: Fix iconify-icon layout shift flash on docs pages
status: completed
type: bug
priority: normal
created_at: 2026-03-05T22:03:20Z
updated_at: 2026-03-05T22:10:29Z
parent: datastar_sw-9bz9
---

The `:not(:defined)` CSS rule only reserves space before the web component JS loads. After it's defined, there's still a flash while icon data is fetched from the Iconify API and SVG is rendered in shadow DOM. Iconify docs recommend applying sizing to all iconify-icon elements, not just undefined ones. Also check if icon should be 16px not 14px.

## Summary of Changes\n\n- Replaced `iconify-icon:not(:defined)` CSS rule with `iconify-icon { display: inline-block; width: 1em; height: 1em; }` per Iconify's official docs recommendation — applies to ALL states, not just before the web component is defined\n- Added the rule to both main app CSS and docs CSS\n- Replaced `<iconify-icon>` with inline SVG components (`ArrowLeftIcon`, `ArrowRightIcon`) for critical above-the-fold docs elements (sidebar back link, topic pager arrows) — eliminates visual flash entirely since SVG renders with the initial HTML\n- Icon size kept at `1em` (scales with context font-size)
