---
# datastar_sw-wizi
title: 'Docs: Signals & Server-Owned UI State'
status: completed
type: task
priority: high
created_at: 2026-03-05T20:48:09Z
updated_at: 2026-03-05T22:57:38Z
parent: datastar_sw-9bz9
blocked_by:
    - datastar_sw-yzrf
---

Core topic. The Tao of Datastar: 'fewer signals is better'. Server tracks UI mode (editing, selecting, action sheets) in boardUIState. Signals only for form data and lightweight client intent. How this differs from React/Vue client-side state management. Interactive: toggle edit mode, show boardUIState changing server-side and the full morph that gets pushed.

## Summary of Changes\n\nAdded DocsSignalsContent component (10 sections) covering the server-owns-state philosophy: boardUIState data structure, worked card-edit flow example, where signals are actually used (only 2 data-signals in the whole app), forms as the sole client→server data channel, selection mode as a server-side Set, touch action sheets, the 'why this works' tradeoff analysis, and a summary table. Also added .docs-table CSS for the new table element.
