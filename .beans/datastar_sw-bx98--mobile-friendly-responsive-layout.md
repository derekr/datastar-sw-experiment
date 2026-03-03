---
# datastar_sw-bx98
title: Mobile-friendly responsive layout
status: in-progress
type: feature
priority: high
created_at: 2026-03-03T23:37:24Z
updated_at: 2026-03-03T23:39:31Z
---

Make the kanban board fully usable on mobile devices. Use fluid CSS techniques — clamp(), container queries, flexible grids/flexbox, fluid typography — instead of manual @media breakpoints. Columns should scroll horizontally on narrow viewports, cards should be touch-friendly, and the boards list should reflow naturally.

\n## Plan\n\n- [x] Audit current CSS for fixed widths, rigid layouts, and px-only sizing\n- [ ] Fluid typography: clamp()-based font sizes on body/headings\n- [ ] Boards list: fluid grid with auto-fill/minmax instead of fixed columns\n- [ ] Board view: horizontal scroll columns container with fluid column widths\n- [ ] Cards: fluid padding/sizing, touch-friendly tap targets (min 44px)\n- [ ] Forms/inputs: full-width on narrow viewports, fluid sizing\n- [ ] Board header: wrap gracefully, back link accessible\n- [ ] Toolbar (export/import): flex-wrap, fluid button sizing\n- [ ] Test on mobile viewport
