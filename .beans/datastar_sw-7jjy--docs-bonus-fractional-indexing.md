---
# datastar_sw-7jjy
title: 'Docs (bonus): Fractional Indexing'
status: completed
type: task
priority: normal
created_at: 2026-03-05T20:48:28Z
updated_at: 2026-03-06T01:08:13Z
parent: datastar_sw-9bz9
blocked_by:
    - datastar_sw-yzrf
---

Bonus section. Not Datastar-specific — a general technique for ordered lists without reindexing. The problem with integer positions (every insert/move requires renumbering). How generateKeyBetween works (lexicographic keys between neighbors). Why the siblings array excludes the item being moved. Interactive: drag-to-reorder demo showing position keys updating in real time.

## Summary of Changes\n\nAdded DocsFractionalIndexingContent component (6 sections) covering: the problem with integer positions, how generateKeyBetween works, the siblings array explanation, why not integers comparison, and how this app uses it for card/column positions.
