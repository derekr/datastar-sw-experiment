---
# datastar_sw-dpzk
title: Add DB adapter interfaces and IDB implementation
status: todo
type: feature
priority: high
created_at: 2026-03-07T02:21:46Z
updated_at: 2026-03-07T02:21:46Z
---

Create storage abstraction layer to decouple domain logic from IndexedDB APIs.\n\nScope:\n- [ ] Define EventStore/ProjectionStore interfaces + transaction boundaries\n- [ ] Implement IDB adapter preserving current schema/index behavior\n- [ ] Refactor lib/events/init/undo/queries to use adapter interfaces\n- [ ] Preserve idempotency, upcasting, and snapshot/replay semantics\n- [ ] Add tests for adapter contract in browser mode
