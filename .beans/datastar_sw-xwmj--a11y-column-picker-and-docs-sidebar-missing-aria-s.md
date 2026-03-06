---
# datastar_sw-xwmj
title: 'A11y: column picker and docs sidebar missing ARIA states'
status: todo
type: task
priority: low
created_at: 2026-03-06T22:54:44Z
updated_at: 2026-03-06T22:54:44Z
---

Minor ARIA state omissions:\n\n- [ ] card-detail.jsx:54-59 — column picker buttons missing aria-pressed or aria-current on active column\n- [ ] docs.jsx:62,67,75 — sidebar active link missing aria-current=page\n- [ ] docs.jsx:162-166 — topic card number spans should have aria-hidden=true (decorative)
