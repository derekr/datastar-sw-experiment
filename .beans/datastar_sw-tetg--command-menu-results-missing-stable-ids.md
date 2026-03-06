---
# datastar_sw-tetg
title: Command menu results missing stable ids
status: todo
type: task
priority: normal
created_at: 2026-03-06T22:54:26Z
updated_at: 2026-03-06T22:54:26Z
---

command-menu.jsx:80-93 — Result li items and section group divs (line 74) have no id attributes. When search results change after a debounce, Idiomorph must re-match these elements heuristically. If result count or order shifts, elements may mismatch, causing the active highlight to jump.\n\n- [ ] Add id=cmd-result-{r.id} to each result li\n- [ ] Add id=cmd-group-{name} to each section div\n- [ ] Remove meaningless key prop on line 74 (Hono JSX is not React, key emits as HTML attribute)
