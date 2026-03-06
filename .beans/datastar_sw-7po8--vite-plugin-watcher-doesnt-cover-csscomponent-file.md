---
# datastar_sw-7po8
title: 'Vite plugin: watcher doesn''t cover CSS/component files'
status: completed
type: bug
priority: high
created_at: 2026-03-06T22:54:30Z
updated_at: 2026-03-06T23:05:26Z
---

vite-plugin-sw.js:147-160 — The dev watcher only monitors sw.jsx, eg-kanban.js, and stellar.css. Changes to css/*.css.js, components/*.jsx, or lib/*.js don't trigger a SW rebuild. During dev, editing these files produces no new sw.js until the developer manually edits sw.jsx or reloads.\n\n- [ ] Expand watcher to include css/*.css.js, components/*.jsx, lib/*.js\n- [ ] Test: edit a component file, verify sw.js rebuilds automatically

\n## Summary of Changes\n\nExpanded vite-plugin-sw.js watcher to cover lib/, components/, and css/*.css.js (excluding stellar.css which triggers full-reload). Any bundled source file change now triggers SW rebuild.
