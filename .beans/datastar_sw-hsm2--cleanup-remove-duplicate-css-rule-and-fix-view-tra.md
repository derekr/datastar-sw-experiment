---
# datastar_sw-hsm2
title: 'Cleanup: remove duplicate CSS rule and fix view-transition'
status: todo
type: task
priority: low
created_at: 2026-03-06T22:54:49Z
updated_at: 2026-03-06T22:54:49Z
---

app.css.js has a duplicate rule and minor CSS issues:\n\n- [ ] app.css.js:1078,1298 — duplicate ::view-transition-new(*) { animation: none } rule (remove second)\n- [ ] app.css.js:424 — label swatch active border uses hardcoded #fff (invisible in light mode, use --neutral-1 or --neutral-12)\n- [ ] app.css.js:1158 vs 382 — inconsistent focus border color (--primary-9 vs --primary-7, pick one)\n- [ ] app.css.js:168 — template-card hover background same as resting state (should use --neutral-4)
