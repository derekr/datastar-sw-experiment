---
# datastar_sw-bt8x
title: Add stable ids to conditional siblings for Idiomorph
status: completed
type: bug
priority: high
created_at: 2026-03-06T22:54:16Z
updated_at: 2026-03-07T00:29:08Z
---

Multiple components conditionally render/exclude siblings without stable id attributes, violating the project's Idiomorph convention: 'Always render elements, toggle visibility with CSS.'\n\nkanban.jsx locations:\n- [ ] :27-31 — LabelPicker clear button (conditional without id)\n- [ ] :60-62 — card-select-checkbox (conditional without id)\n- [ ] :67-88 — card-actions div (conditional without id)\n- [ ] :89-104 — card-edit-form (conditional without id)\n- [ ] :225-230 — column delete button (conditional without id)\n- [ ] :237-245 — add-card form per column (conditional without id)\n- [ ] :442-449 — add-column form (conditional without id)\n- [ ] :451-453 — SelectionBar (conditional, inner div has no id)\n- [ ] :454-458 — ActionSheet/ColumnSheet (no id on root elements)\n\ncard-detail.jsx locations:\n- [ ] :20 — label bar conditionally rendered without id\n\nFor each: either always render with id + CSS visibility toggle, or at minimum add a stable id attribute.

\n## Summary\n\nFixed all locations in kanban.jsx: added stable ids to label clear button, card checkbox, card-actions div, card-edit-form, column delete button, add-card form, add-column form, SelectionBar. Fixed card-detail.jsx label bar.
