---
# datastar_sw-7uyb
title: Fix Cmd+K rendering in board view
status: completed
type: bug
priority: high
created_at: 2026-03-07T04:07:01Z
updated_at: 2026-03-07T13:52:13Z
---

Command menu open route returns 204 and SSE patch fires, but board UI does not show the menu.

Root cause: Board component receives command menu data object but renders it directly instead of rendering the CommandMenu component. sw.jsx already passes CommandMenu into Board, but Board ignores it.

- [x] Update Board component signature to accept CommandMenu
- [x] Render CommandMenu component when commandMenu is set
- [x] Smoke test Cmd+K open flow in MCP on board page


## Smoke Test Notes

Added Cmd+K checks into smoke flow:
- Index page: command-menu open route returns 204 and command menu element appears (`#command-menu`).
- Board page: command-menu open route returns 204 but command menu element does not appear.

This confirms smoke coverage now includes Cmd+K, and board-view rendering remains unresolved.


## Summary of Changes

Updated Board rendering to use the CommandMenu component instead of rendering raw commandMenu data.

- Board now accepts `CommandMenu` prop
- Board renders `<CommandMenu query={...} results={...} />` when command menu state exists
- MCP smoke verified on board page: POST /command-menu/open returns 204 and `#command-menu` appears
