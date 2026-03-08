---
# datastar_sw-xwdh
title: Decouple static assets from Vite runtime defines
status: completed
type: task
priority: normal
created_at: 2026-03-07T02:21:46Z
updated_at: 2026-03-08T06:51:10Z
---

Make runtime independent from Vite define globals while keeping optional hash-busting.\n\nScope:\n- [x] Introduce runtime asset manifest object (stellar css, kanban js, icons css)\n- [x] Replace __STELLAR_CSS__/__KANBAN_JS__ runtime dependence in server templates\n- [x] Keep Vite build path as optional manifest generator\n- [x] Ensure Bun runtime can serve same assets via hono/bun serveStatic\n- [x] Verify GH Pages subpath compatibility with basePath


## Summary of Changes

Decoupled runtime asset wiring from Vite define globals and moved to runtime asset config:

- Added runtime asset manifest module: `lib/assets.js` (`setAssetConfig/getAssetConfig`)
- Added shared icon CSS generator module: `lib/icon-css.js`
- Refactored templates to use runtime asset config instead of globals:
  - `components/shell.jsx`
  - `components/docs.jsx`
  - `components/events-page.jsx`
- Removed direct `__LUCIDE_ICON_CSS__` interpolation from CSS source modules (`css/app.css.js`, `css/docs.css.js`, `css/events.css.js`)
- Updated `sw.jsx` to initialize asset config via runtime config, with fallback to define globals for SW/Vite hashed asset flow
- Updated `runtime/bun-entry.ts` to provide explicit asset config and generated lucide CSS for Bun runtime
- Updated `vite-plugin-sw.js` to use shared `buildIconCSS()` from `lib/icon-css.js`

QA:
- `pnpm build` passes
- Bun runtime serves index/docs/events with icon CSS present in HTML output
- MCP Bun smoke still passes for board interactions + command menu
- Base-path behavior remains through `base()` + configured asset paths.
