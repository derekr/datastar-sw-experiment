---
# datastar_sw-kuye
title: Add Dual Runtime docs section
status: completed
type: task
priority: normal
created_at: 2026-03-08T17:54:56Z
updated_at: 2026-03-08T17:56:41Z
---

New bonus docs topic covering the dual SW + Bun runtime architecture. Frame SW as GH Pages demo, Bun as idiomatic Datastar. Show shared createApp() + adapter pattern.

## Summary of Changes\n\nAdded a new bonus docs topic "Dual Runtime: SW & Bun" (slug: `bonus/dual-runtime`). Three files changed:\n\n- `lib/constants.js`: Added topic to DOCS_TOPICS array\n- `components/docs.jsx`: Added `DocsDualRuntimeContent` component + router case\n\nSections: intro framing, the shared app (`createApp`), two entry points with code, comparison table, database adapter pattern, and "why bother" closing.
