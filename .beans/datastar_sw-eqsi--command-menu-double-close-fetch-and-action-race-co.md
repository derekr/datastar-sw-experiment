---
# datastar_sw-eqsi
title: 'Command menu: double close fetch and action race condition'
status: completed
type: bug
priority: high
created_at: 2026-03-06T22:54:01Z
updated_at: 2026-03-06T23:05:22Z
---

Two related issues in command-menu.jsx:\n\n1. command-menu.jsx:30 + sw.jsx:910 — Theme action jsAction already includes its own fetch to command-menu/close, but the clickHandler wrapper in command-menu.jsx adds another one. Double close on every theme selection.\n\n2. command-menu.jsx:38 — The actionUrl branch fires close and action fetch in parallel using semicolon instead of .then(). Other branches correctly use .then() for sequential execution. This is a race condition — if the action triggers a morph before close is processed, the command menu may flash.\n\n- [ ] Remove redundant close fetch from theme jsAction wrapper (or from sw.jsx:910)\n- [ ] Change semicolon to .then() in actionUrl branch for sequential execution\n- [ ] Verify all clickHandler branches use consistent .then() chaining

\n## Summary of Changes\n\nRemoved redundant command-menu/close from theme jsAction in sw.jsx (the clickHandler wrapper already closes). Fixed actionUrl branch in command-menu.jsx to use .then() instead of semicolon for sequential execution.
