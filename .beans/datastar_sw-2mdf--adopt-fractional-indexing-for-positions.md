---
# datastar_sw-2mdf
title: Adopt fractional indexing for positions
status: completed
type: task
priority: high
tags:
    - event-sourcing
    - sync
created_at: 2026-03-02T22:10:05Z
updated_at: 2026-03-02T22:44:45Z
---

Position-based events (card.moved, column.moved) read current state to compute integer positions. Two concurrent writers (future sync) assigning the same position = conflict with no resolution strategy.

Switch to fractional indexing (e.g. strings like 'a0', 'aH', 'aP' or decimals) so position assignment is commutative. Each insert picks a value between its neighbors without reading/reindexing siblings.

This eliminates:
- The position reindexing side-effect in column.deleted projection handler
- The O(n) sibling reindex on every card/column move
- Position conflicts in multi-device sync

Libraries to consider: fractional-indexing (npm), or roll a simple string-based scheme.

Affects: card.created, card.moved, column.created, column.moved, column.deleted (remove reindex logic)
