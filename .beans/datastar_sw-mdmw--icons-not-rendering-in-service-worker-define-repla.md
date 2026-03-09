---
# datastar_sw-mdmw
title: Icons not rendering in service worker - define replacement broken
status: completed
type: bug
priority: normal
created_at: 2026-03-08T15:12:41Z
updated_at: 2026-03-08T15:15:00Z
---

The SW fallback in createApp() uses `g.__LUCIDE_ICON_CSS__` (member expression on globalThis), but esbuild's `define` only replaces bare identifiers. So the define is never substituted, `globalThis.__LUCIDE_ICON_CSS__` is `undefined`, the fallback `|| ''` returns empty string, and no icon CSS is injected. Same issue affects __STELLAR_CSS__ and __KANBAN_JS__ but those happen to work in dev because their defaults match the dev paths. Fix: use bare identifiers so esbuild can replace them.

## Summary of Changes\n\nThe root cause was that esbuild's `define` only replaces exact identifier expressions, not arbitrary property accesses. The code used `g.__LUCIDE_ICON_CSS__` (where `g = globalThis`), which esbuild doesn't recognize as matching the define key `__LUCIDE_ICON_CSS__`.\n\n**Fix (2 files):**\n\n- `sw.jsx`: Changed `g.__LUCIDE_ICON_CSS__` → `globalThis.__LUCIDE_ICON_CSS__` (and same for `__STELLAR_CSS__`, `__KANBAN_JS__`). Removed the intermediate `const g = globalThis` alias.\n- `vite-plugin-sw.js`: Changed define keys from bare identifiers (`__LUCIDE_ICON_CSS__`) to dotted global paths (`globalThis.__LUCIDE_ICON_CSS__`). esbuild supports member access chains like `globalThis.X` as define keys, matching the source expressions exactly.\n\nThe Bun server was unaffected because it passes `lucideIconCSS` directly via `runtimeConfig.assets`, bypassing the `globalThis` fallback entirely.
