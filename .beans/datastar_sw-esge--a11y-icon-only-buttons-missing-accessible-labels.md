---
# datastar_sw-esge
title: 'A11y: icon-only buttons missing accessible labels'
status: completed
type: task
priority: normal
created_at: 2026-03-06T22:54:38Z
updated_at: 2026-03-07T00:38:25Z
---

Multiple icon-only buttons across the app have no aria-label or title attribute. Screen readers announce them as empty buttons.\n\n- [ ] kanban.jsx:81-86 — card delete button (has Icon but no title/aria-label)\n- [ ] kanban.jsx:227-229 — column delete button\n- [ ] kanban.jsx:243 — add card form submit button\n- [ ] kanban.jsx:287-292, 301-307 — time travel prev/next step buttons\n- [ ] kanban.jsx:293-300 — time travel range slider (no associated label)\n\nFix: add title or aria-label to each.

\n## Summary\n\nAdded title attributes to time travel prev/next buttons, aria-label to slider. Other buttons already had titles.
