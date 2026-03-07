---
# datastar_sw-9vxx
title: Add Bun runtime with SQLite adapter
status: todo
type: feature
priority: high
created_at: 2026-03-07T02:21:46Z
updated_at: 2026-03-07T02:21:46Z
---

Run the same Hono app outside SW using Bun + SQLite backend.\n\nScope:\n- [ ] Implement sqlite adapter (bun:sqlite) matching IDB behavior\n- [ ] Add schema + migrations for events/boards/columns/cards/meta\n- [ ] Add bun runtime entrypoint and dev command\n- [ ] Implement presence adapter for board tab/connection counting in Bun\n- [ ] Validate CQRS + SSE parity against SW runtime
