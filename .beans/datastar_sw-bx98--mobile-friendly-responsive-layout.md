---
# datastar_sw-bx98
title: Mobile-friendly responsive layout
status: completed
type: feature
priority: high
created_at: 2026-03-03T23:37:24Z
updated_at: 2026-03-03T23:41:59Z
---

Make the kanban board fully usable on mobile devices. Use fluid CSS techniques — clamp(), container queries, flexible grids/flexbox, fluid typography — instead of manual @media breakpoints. Columns should scroll horizontally on narrow viewports, cards should be touch-friendly, and the boards list should reflow naturally.

\n## Plan\n\n- [x] Audit current CSS for fixed widths, rigid layouts, and px-only sizing\n- [x] Fluid typography: clamp()-based font sizes on body/headings\n- [x] Boards list: fluid grid with auto-fill/minmax instead of fixed columns\n- [x] Board view: horizontal scroll columns container with fluid column widths\n- [x] Cards: fluid padding/sizing, touch-friendly tap targets (min 44px)\n- [x] Forms/inputs: full-width on narrow viewports, fluid sizing\n- [x] Board header: wrap gracefully, back link accessible\n- [x] Toolbar (export/import): flex-wrap, fluid button sizing\n- [x] Test on mobile viewport

## Summary of Changes

- All padding uses clamp() — near-edge on phones, spacious on desktop, no breakpoints
- Columns: clamp(260px, 75vw, 300px) width so they shrink to fit phones
- 44x44px min touch targets on all interactive buttons (delete, edit, col-delete)
- user-select: none on #board during drag prevents text selection
- Boards grid: minmax(min(200px, 100%), 1fr) for any-width single-column fallback
- add-col-form input: flex:1 + flex-wrap instead of fixed 200px
- Events page: rem font-size, fluid padding
- Zero @media breakpoints — entirely fluid CSS
