---
# datastar_sw-akqe
title: 'Docs (bonus): IndexedDB — Keeping the DB Layer Light'
status: completed
type: task
priority: normal
created_at: 2026-03-05T20:48:25Z
updated_at: 2026-03-06T00:58:14Z
parent: datastar_sw-9bz9
blocked_by:
    - datastar_sw-yzrf
---

Bonus section. Why we used raw IndexedDB with thin helpers instead of an ORM or abstraction layer. Structured cloning gives us free serialization. Transactions give us atomicity. Event log store + projection store + snapshot store — that's it. No migration framework needed when your events are the schema. Contrast with heavier options (Dexie, PGlite, OPFS). Context: for this demo we kept it intentionally minimal to show the pattern clearly.

## Summary of Changes\n\nAdded DocsIndexedDbContent component (6 sections) covering: the 5 stores (events, boards, columns, cards, meta), why raw IndexedDB (no deps, structured cloning, transactions, no migrations), contrast with heavier options (Dexie, PGlite, OPFS), reading/writing code examples, and snapshots for fast startup.
