---
# datastar_sw-6i6n
title: Command menu navigation on docs pages
status: completed
type: task
priority: normal
created_at: 2026-03-05T21:06:57Z
updated_at: 2026-03-05T21:09:45Z
parent: datastar_sw-9bz9
---

Add lightweight client-side Cmd+K navigation to docs pages. Shows docs topics + back to app link. Keyboard nav (arrows, enter, escape). No SSE/SW routes needed — purely client-side overlay.

## Summary of Changes\n\nAdded client-side Cmd+K command menu to docs pages:\n- Inline script in DocsShell builds overlay from DOCS_TOPICS array (injected as JSON at render time)\n- Groups: App (back to app), Core Concepts, Bonus\n- Keyboard: arrow up/down, enter to navigate, escape to close, Cmd+K to toggle\n- Text filtering narrows results as you type\n- 'current' badge on the active page\n- CSS for backdrop, panel, input, grouped list, kbd hints\n- Zero SW involvement — entirely client-side
