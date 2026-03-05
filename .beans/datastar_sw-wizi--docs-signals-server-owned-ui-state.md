---
# datastar_sw-wizi
title: 'Docs: Signals & Server-Owned UI State'
status: todo
type: task
priority: high
created_at: 2026-03-05T20:48:09Z
updated_at: 2026-03-05T20:48:40Z
parent: datastar_sw-9bz9
blocked_by:
    - datastar_sw-yzrf
---

Core topic. The Tao of Datastar: 'fewer signals is better'. Server tracks UI mode (editing, selecting, action sheets) in boardUIState. Signals only for form data and lightweight client intent. How this differs from React/Vue client-side state management. Interactive: toggle edit mode, show boardUIState changing server-side and the full morph that gets pushed.
