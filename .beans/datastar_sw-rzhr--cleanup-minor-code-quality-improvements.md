---
# datastar_sw-rzhr
title: 'Cleanup: minor code quality improvements'
status: completed
type: task
priority: low
created_at: 2026-03-06T22:54:54Z
updated_at: 2026-03-07T00:31:18Z
---

Small code quality items from review:\n\n- [ ] sw.jsx:12 — clearUIState imported but never used (remove import)\n- [ ] lib/time-travel.js:65,78 — events upcasted twice (store upcasted results from loop, reuse in return)\n- [ ] lib/queries.js:36 — getBoard() fetches all cards via getAll then filters; use per-column byColumn index instead\n- [ ] kanban.jsx:439 — columns prop passed to Column component but unused (remove prop)\n- [ ] shell.jsx:27 — title hardcoded to 'Kanban'; accept a title prop like DocsShell does
