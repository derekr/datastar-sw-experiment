---
# datastar_sw-f6ec
title: Replace Unicode icons with Iconify web component
status: completed
type: task
priority: normal
created_at: 2026-03-05T18:46:44Z
updated_at: 2026-03-05T18:53:18Z
---

Add iconify-icon web component, replace Unicode action/UI symbols with Iconify icons from the Lucide set. Keep emoji (templates, theme picker) and keyboard symbols as-is.

## Plan

- [x] Add `iconify-icon` web component script to Shell and EventsPage `<head>`
- [x] Create icon helper component for clean JSX usage
- [x] Replace action icons: × (close/delete), ← (back), → (forward), + (add), ✎ (edit), ↗ (open)
- [x] Replace UI symbols: ☑/☐ (selection), ⌕ (search), ✓ (checkmark), ⚡□🏷☰ (command menu types), ☾ (theme)
- [x] Keep as-is: emoji (📋🏃✅🚀💻☀️🌙), keyboard keys (⌘↑↓←→ in help overlay), · (separator), ▸ (CSS disclosure)
- [x] Verify dev and prod builds
- [x] Test in browser

## Icon mapping (Lucide set)

| Old | New | Usage |
|-----|-----|-------|
| × | lucide:x | close, delete |
| ← | lucide:arrow-left | back navigation |
| → | lucide:arrow-right | forward, move right |
| + | lucide:plus | add card/column/board |
| ✎ | lucide:pencil | edit |
| ↗ | lucide:arrow-up-right | open card detail |
| ☑ | lucide:square-check | selected checkbox |
| ☐ | lucide:square | unselected checkbox |
| ⌕ | lucide:search | command menu search |
| ✓ | lucide:check | active theme indicator |
| ⚡ | lucide:zap | command type: action |
| □ | lucide:layout-dashboard | command type: board |
| 🏷 | lucide:tag | command type: card |
| ☰ | lucide:columns-3 | command type: column |
| ☾ | lucide:palette | theme subtitle |
| ← → (time travel) | lucide:chevron-left / chevron-right | step back/forward |

## Summary of Changes

Added `iconify-icon` web component (CDN), created `Icon` JSX helper. Replaced ~22 Unicode characters with Lucide icons across all components: x (close/delete), arrow-left (back), arrow-right (forward), plus (add), pencil (edit), arrow-up-right (open), square-check/square (selection), search, chevron-left/right (time travel), zap/layout-dashboard/tag/columns-3 (command menu types). Kept emoji (templates, theme picker) and keyboard symbols as-is.
