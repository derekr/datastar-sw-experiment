---
# datastar_sw-plnn
title: Use byColumn index in column.deleted projection handler
status: completed
type: task
priority: low
tags:
    - cleanup
created_at: 2026-03-02T22:11:06Z
updated_at: 2026-03-02T23:22:57Z
---

In applyEvent, column.deleted (sw.jsx ~line 78) does cardStore.getAll() and filters in JS to find cards belonging to the deleted column. But the cards store has a byColumn index (created at line 152).

board.deleted (line 62) correctly uses the byColumn index: cardStore.index('byColumn').getAll(col.id). column.deleted should do the same for consistency and performance.

One-line fix: change getAll() + filter to index('byColumn').getAll(data.id).
