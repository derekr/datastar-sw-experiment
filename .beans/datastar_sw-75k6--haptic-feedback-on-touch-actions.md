---
# datastar_sw-75k6
title: Haptic feedback on touch actions
status: completed
type: task
priority: low
created_at: 2026-03-04T04:36:29Z
updated_at: 2026-03-04T16:33:54Z
---

navigator.vibrate() on card tap, selection toggle, sheet open, batch actions. Minimal dependency — just the standard Web API. Ref: https://haptics.lochie.me for patterns.

## Tasks
- [x] Add haptic helper: tap (8ms), drop (15ms), warn (double pulse 12-40-12)
- [x] Wire into card/column tap, drag-end, delete, select, label pick
- [x] Respects prefers-reduced-motion media query
- [x] QA: no errors on desktop, functions available, needs real device for vibration
- [x] Build + commit


## Summary of Changes

Added haptic feedback via Vibration API. Three patterns: tap (light), drop (medium), warn (double pulse). Wired into touch event handlers (card/column tap, drag-end) and via event delegation for Datastar-driven actions (delete, select toggle, label pick). Disabled when prefers-reduced-motion is set.
