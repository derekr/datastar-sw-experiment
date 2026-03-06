---
# datastar_sw-sl0l
title: Docs CSS uses invalid design tokens
status: completed
type: bug
priority: high
created_at: 2026-03-06T22:54:04Z
updated_at: 2026-03-06T23:05:24Z
---

css/docs.css.js:301,321,362 — The docs visualization section uses var(--radius-1), var(--radius-2), var(--surface-1), var(--surface-2), var(--surface-3) — none of which exist in stellar.css.\n\nCorrect tokens:\n- --radius-* → --border-radius-*\n- --surface-* → --neutral-* (or appropriate token)\n\nResult: docs viz section gets no border-radius and transparent backgrounds.\n\n- [ ] Replace --radius-1 with --border-radius-1\n- [ ] Replace --radius-2 with --border-radius-2\n- [ ] Replace --surface-1/2/3 with appropriate --neutral-* tokens\n- [ ] Visually verify docs viz section renders correctly

\n## Summary of Changes\n\nReplaced invalid --radius-1/2 with --border-radius-1/2, --surface-1/2/3 with --neutral-2/3/3 in css/docs.css.js.
