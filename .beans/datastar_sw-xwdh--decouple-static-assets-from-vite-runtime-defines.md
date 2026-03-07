---
# datastar_sw-xwdh
title: Decouple static assets from Vite runtime defines
status: todo
type: task
priority: normal
created_at: 2026-03-07T02:21:46Z
updated_at: 2026-03-07T02:21:46Z
---

Make runtime independent from Vite define globals while keeping optional hash-busting.\n\nScope:\n- [ ] Introduce runtime asset manifest object (stellar css, kanban js, icons css)\n- [ ] Replace __STELLAR_CSS__/__KANBAN_JS__ runtime dependence in server templates\n- [ ] Keep Vite build path as optional manifest generator\n- [ ] Ensure Bun runtime can serve same assets via hono/bun serveStatic\n- [ ] Verify GH Pages subpath compatibility with basePath
