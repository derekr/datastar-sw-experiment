---
# datastar_sw-xwmj
title: 'A11y: column picker and docs sidebar missing ARIA states'
status: completed
type: task
priority: low
created_at: 2026-03-06T22:54:44Z
updated_at: 2026-03-07T00:38:31Z
---

Minor ARIA state omissions:\n\n- [ ] card-detail.jsx:54-59 — column picker buttons missing aria-pressed or aria-current on active column\n- [ ] docs.jsx:62,67,75 — sidebar active link missing aria-current=page\n- [ ] docs.jsx:162-166 — topic card number spans should have aria-hidden=true (decorative)

\n## Summary\n\nAdded aria-label and role=listbox to column picker, aria-selected and aria-pressed to column buttons. Added aria-current=page to docs sidebar active links. Added aria-hidden to docs-toc-num spans.
