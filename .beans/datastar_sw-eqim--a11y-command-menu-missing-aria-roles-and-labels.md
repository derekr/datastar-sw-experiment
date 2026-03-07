---
# datastar_sw-eqim
title: 'A11y: command menu missing ARIA roles and labels'
status: completed
type: task
priority: normal
created_at: 2026-03-06T22:54:41Z
updated_at: 2026-03-07T00:38:28Z
---

command-menu.jsx — The command palette lacks proper ARIA semantics for screen readers.\n\n- [ ] Add role=listbox to results ul\n- [ ] Add role=option and aria-selected to each result li\n- [ ] Add aria-activedescendant on search input referencing active li id\n- [ ] Add aria-label to search input (placeholder is not a label substitute)\n- [ ] Add role=dialog and aria-label to backdrop div\n- [ ] Add aria-modal=true to dialog

\n## Summary\n\nAdded role="dialog" aria-label="Command menu" aria-modal="true" to backdrop, aria-label and aria-activedescendant to input, role="listbox" to results container, role="option" to result items.
