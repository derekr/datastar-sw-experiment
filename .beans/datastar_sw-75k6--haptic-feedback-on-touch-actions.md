---
# datastar_sw-75k6
title: Haptic feedback on touch actions
status: todo
type: task
priority: low
created_at: 2026-03-04T04:36:29Z
updated_at: 2026-03-04T04:36:29Z
---

navigator.vibrate() on card tap, selection toggle, sheet open, batch actions. Minimal dependency — just the standard Web API. Ref: https://haptics.lochie.me for patterns.

## Tasks
- [ ] Add haptic helper function (short pulse for taps, double pulse for destructive actions)
- [ ] Wire into touch event handlers in Shell inline script
- [ ] Respect user preference (prefers-reduced-motion or a toggle)
- [ ] QA on real device (vibrate is no-op in emulation)
- [ ] Build + commit
