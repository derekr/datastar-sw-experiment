---
# datastar_sw-5uee
title: Desktop drag-and-drop broken after SSE morph
status: completed
type: bug
priority: critical
created_at: 2026-03-04T21:09:20Z
updated_at: 2026-03-04T21:29:04Z
---

Desktop drag-and-drop is broken. Leading theory: when Datastar/Idiomorph morphs #board via SSE, if it replaces the DOM node rather than morphing in-place, checkKanban won't re-initialize eg-kanban because kanbanCleanup is still truthy (pointing to old element's destroy function). Event listeners end up on detached old #board element.

## Tasks

- [x] Read Shell inline script to understand checkKanban / kanbanCleanup logic
- [x] Confirm the stale reference theory
- [x] Implement fix (compare DOM node reference, re-init if changed)
- [x] Test in browser

## Summary of Changes\n\nFixed stale DOM reference in checkKanban() (sw.jsx). Added kanbanBoardEl variable to track the actual #board DOM node. When Idiomorph replaces #board during SSE morph, the comparison board !== kanbanBoardEl detects the new node, tears down old listeners, and re-initializes eg-kanban on the new element.
