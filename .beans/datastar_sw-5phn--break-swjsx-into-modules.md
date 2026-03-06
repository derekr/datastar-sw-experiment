---
# datastar_sw-5phn
title: Break sw.jsx into modules
status: completed
type: task
priority: high
created_at: 2026-03-06T21:59:00Z
updated_at: 2026-03-06T22:19:05Z
---

Split the monolithic sw.jsx (~6900 lines) into a modular structure. Routes stay thin in sw.jsx, logic moves to lib/ and components/.\n\n- [ ] Create lib/constants.js\n- [ ] Create lib/db.js (shared state: dbPromise, bus, actorId)\n- [ ] Create lib/compression.js\n- [ ] Create lib/events.js (event sourcing core)\n- [ ] Create lib/undo.js\n- [ ] Create lib/ui-state.js\n- [ ] Create lib/time-travel.js\n- [ ] Create lib/position.js\n- [ ] Create lib/sse.js\n- [ ] Create lib/tabs.js\n- [ ] Create lib/templates.js\n- [ ] Create lib/queries.js\n- [ ] Create lib/init.js\n- [x] Create lib/command-menu.js\n- [ ] Create components/icon.jsx\n- [ ] Create components/kanban.jsx\n- [ ] Create components/card-detail.jsx\n- [ ] Create components/boards-list.jsx\n- [ ] Create components/command-menu.jsx\n- [ ] Create components/shell.jsx\n- [ ] Create components/events-page.jsx\n- [ ] Create components/docs.jsx\n- [ ] Create css/app.css.js\n- [ ] Create css/docs.css.js\n- [ ] Create css/events.css.js\n- [ ] Slim down sw.jsx to thin routes + fetch handler\n- [ ] Verify build succeeds\n- [ ] Verify app works in browser

## Summary of Changes\n\nSplit sw.jsx from 6923 lines into 28 modules:\n- lib/ (14 files): constants, db, compression, events, undo, ui-state, time-travel, position, sse, tabs, templates, queries, init, command-menu, base\n- components/ (8 files): icon, kanban, card-detail, boards-list, command-menu, shell, events-page, docs\n- css/ (3 files): app.css.js, docs.css.js, events.css.js\n- sw.jsx: 1183 lines (thin routes + Hono app + SW lifecycle)\n\nBuild output unchanged (271KB). App verified working in browser.
