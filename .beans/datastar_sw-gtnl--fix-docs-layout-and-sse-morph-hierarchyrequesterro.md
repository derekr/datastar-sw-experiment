---
# datastar_sw-gtnl
title: Fix docs layout and SSE morph HierarchyRequestError
status: completed
type: bug
priority: critical
created_at: 2026-03-05T21:21:36Z
updated_at: 2026-03-05T21:33:15Z
---

Two issues on docs pages: (1) Layout broken — only sidebar shows, no main content area. (2) HierarchyRequestError on page load — Datastar morph tries moveBefore where new child contains parent. Flash of sidebar-only layout before content appears (or never appears).\n\n- [x] Diagnose HierarchyRequestError cause in docs SSE morph\n- [x] Fix the morph target structure to avoid hierarchy conflict\n- [x] Fix layout so content area renders correctly\n- [x] Verify no flash of unstyled/partial content on load

## Summary of Changes

Root cause: SSE routes were pushing full-page components (DocsIndex/DocsTopicStub → DocsLayout → DocsShell → <html>) into #docs-app inner, nesting #docs-app inside itself → HierarchyRequestError.

Fix: Split rendering into full-page components (for initial HTML load) and SSE-pushable content components (for morph pushes):
- DocsPage: outer HTML shell wrapper (DocsShell + #docs-app container)
- DocsInner: shared inner wrapper (sidebar + article + command menu) with display:contents so children participate directly in the .docs-layout grid
- DocsIndexContent / DocsTopicStubContent: article content wrapped in DocsInner
- SSE initial push: DocsIndexContent → #docs-app inner
- SSE update push: DocsIndexContent → #docs-inner outer
