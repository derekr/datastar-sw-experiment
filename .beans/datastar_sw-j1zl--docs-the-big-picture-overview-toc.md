---
# datastar_sw-j1zl
title: 'Docs: The Big Picture (overview + TOC)'
status: completed
type: task
priority: high
created_at: 2026-03-05T20:48:04Z
updated_at: 2026-03-05T22:16:32Z
parent: datastar_sw-9bz9
blocked_by:
    - datastar_sw-yzrf
---

Overview page serving as index/TOC. Architecture diagram showing command → event → projection → SSE morph loop. Interactive: a single 'create a card' button that lights up each layer as the event flows through the system. Links to all core and bonus sections.

## Summary of Changes\n\nMerged 'The Big Picture' content into the docs index page (/docs) rather than a separate topic page. The index already serves as the TOC, so the big picture overview belongs there.\n\n- Removed 'overview' slug from DOCS_TOPICS (3 core topics remain)\n- Added architecture overview content to DocsIndexContent: intro paragraph, 6-step CQRS flow with numbered list, 'Why this works' and 'What makes this app unusual' subsections\n- Added CSS: .docs-section for content sections, .docs-flow-list with numbered circle counters\n- Sidebar no longer shows 'The Big Picture' link
