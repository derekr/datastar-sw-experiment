---
# datastar_sw-ut8x
title: Command menu (Cmd+K) with card search
status: in-progress
type: feature
priority: high
created_at: 2026-03-04T23:21:05Z
updated_at: 2026-03-04T23:46:20Z
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
