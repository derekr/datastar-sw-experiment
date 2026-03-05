---
# datastar_sw-yzrf
title: 'Docs infrastructure: routing, layout, navigation'
status: completed
type: task
priority: high
created_at: 2026-03-05T20:47:57Z
updated_at: 2026-03-05T20:58:49Z
parent: datastar_sw-9bz9
---

Add /docs routes to the SW (index + per-topic pages). Shared layout with sidebar/TOC navigation, back-to-app link. Distinguish core vs bonus sections visually. Support interactive components embedded in prose.

## Tasks\n\n- [x] Define DOCS_TOPICS config array (slug, title, core vs bonus)\n- [x] Create DocsShell component (lightweight HTML shell)\n- [x] Create DocsLayout component (sidebar TOC + content area)\n- [x] Add DOCS_CSS constant\n- [x] Add GET /docs route (index/overview)\n- [x] Add GET /docs/:slug route (topic pages)\n- [x] Create stub content components for each topic\n- [x] Add link to docs from boards list page\n- [x] Visual QA in browser

## Summary of Changes

Added complete docs infrastructure:
- DOCS_TOPICS config array (8 topics: 4 core, 4 bonus)
- DocsShell: lightweight HTML shell (no kanban.js/drag handlers/speculation rules)
- DocsSidebar: sticky nav with Core Concepts / Bonus sections, active link highlight
- DocsLayout: sidebar + content grid (collapses on mobile)
- DocsIndex: hero + numbered TOC cards (dashed border for bonus)
- DocsTopicStub: placeholder with bonus badge + prev/next pager
- DOCS_CSS: ~200 lines of docs-specific styles using Stellar tokens
- Routes: GET /docs (index) + GET /docs/:slug (topic pages, 404 for unknown slugs)
- Docs link added to boards list toolbar
