---
# datastar_sw-cff8
title: Multi-tab sync visibility
status: todo
type: feature
priority: high
created_at: 2026-03-04T04:36:29Z
updated_at: 2026-03-04T04:36:29Z
---

The SW already syncs across tabs via SSE — changes in one tab morph the other tab in real-time. But there's no indication this is happening. Add a small presence indicator showing connected tab count.

## Tasks
- [ ] Track connected SSE streams per board in the SW (Map of boardId → Set of stream IDs)
- [ ] Show tab count indicator in board header (e.g. '2 tabs' badge)
- [ ] Push updated count when tabs connect/disconnect
- [ ] QA: open two tabs on same board, verify count and real-time sync
- [ ] Build + commit
