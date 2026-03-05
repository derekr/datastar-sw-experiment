---
# datastar_sw-ut8x
title: Command menu (Cmd+K) with card search
status: completed
type: feature
priority: high
created_at: 2026-03-04T23:21:05Z
updated_at: 2026-03-05T00:07:23Z
---

Cmd+K opens a command palette overlay for searching cards across all columns. Follows Tao of Datastar: client sends keypress to SW, SW tracks commandMenuOpen in boardUIState, pushes full morph with overlay. As user types, POST search query to SW which filters cards/columns and pushes morph with results. Selecting a result scrolls to / highlights the card.

## Tasks

- [x] Add commandMenu state to boardUIState (open, query, results)
- [x] Create CommandMenu JSX component (overlay with input + results list)
- [x] Add Cmd+K listener in Shell inline script to POST to SW
- [x] Add SW route to open/close command menu
- [x] Add SW route to handle search query and push filtered results
- [x] Add result selection (click/Enter) to scroll to and highlight the card
- [x] Add Escape to close, arrow keys to navigate results
- [x] Style the overlay

## Bug Fix: FetchFormNotFound\n\nThe `<input>` with `@post(..., {contentType: 'form'})` was not inside a `<form>` tag. Datastar's form content type requires a `<form>` ancestor to serialize fields. Wrapped the input section in `<form id="command-menu-form" data-on:submit__prevent="void 0">`.

## Phase 2: Global Contextual Command Menu

- [x] Add globalUIState with commandMenu property
- [x] Add global:ui bus topic, both SSE streams listen to it
- [x] Move command menu routes to /command-menu/* (context from X-Context header)
- [x] Refactor CommandMenu component for result types: action, board, column, card
- [x] Empty state: contextual actions + boards
- [x] Search: prioritize current board, then cross-board results
- [x] Actions filtered by query text
- [x] Cross-board navigation via client-side fetch+navigate
- [x] Render CommandMenu in both BoardsList and Board
- [x] Update Shell keydown handler for global Cmd+K (no boardId required)

## Summary of Changes

Global contextual command menu (Cmd+K) that works on any route:

- **Architecture**: Added `globalUIState` with `commandMenu` property and `global:ui` bus topic. Both boards list and board SSE streams listen to it.
- **Context-aware**: On boards list shows boards for quick switching. On board pages shows actions (Undo, Redo, Selection mode, History, Keyboard shortcuts, All boards) plus other boards.
- **Search**: Typing searches cards (title + description), boards (title), and filters actions. Current board results prioritized under "This board" section, cross-board results under "Other boards".
- **Result types**: Actions, boards, cards — each with type icons and contextual subtitles (column name, board stats).
- **Navigation**: Same-board cards close menu + highlight with pulse animation. Cross-board cards set highlight on target board then navigate. Board results navigate directly. Actions execute via POST.
- **Keyboard**: Arrow keys navigate, Enter selects (delegates to active result's click handler), Escape closes.
