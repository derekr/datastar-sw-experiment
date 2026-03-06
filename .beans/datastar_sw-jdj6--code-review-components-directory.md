---
# datastar_sw-jdj6
title: 'Code review: components/ directory'
status: completed
type: task
priority: normal
created_at: 2026-03-06T22:30:44Z
updated_at: 2026-03-06T22:32:18Z
---

Full review of all 8 component files for idiomorph stability, URL correctness, Datastar attributes, HTML validity, accessibility, and consistency.

## Summary of Changes

Completed full review of all 8 component files. Found 3 bugs, 11 potential-bugs, 14 a11y issues, 3 style issues, and 3 cleanup items. Key findings: ActionSheet/ColumnSheet/SelectionBar missing stable ids for Idiomorph, icon-only buttons missing accessible labels, dialogs missing role attributes, DocsShell theme script doesn't register preview/revert functions used by CommandMenu, and three HTML shells duplicate head content.
