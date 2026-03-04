# CLAUDE.md

Local-first kanban board where a service worker is the server. Datastar handles UI reactivity, Hono + JSX in the SW handles routing/rendering/persistence.

## Commands

```bash
pnpm dev          # Start dev server on localhost:5173
pnpm build        # Production build to dist/
```

## Architecture

`sw.jsx` is the entire server (~2600 lines). It contains Hono routes, JSX components, CSS, event sourcing, and idb persistence. `eg-kanban.js` handles pointer drag and keyboard navigation. `index.html` bootstraps the SW.

### CQRS flow

1. Command routes (`POST`/`PUT`/`DELETE`) write events → apply to projection → return `204`
2. Bus event notifies active SSE streams
3. Each SSE handler reads full state from IndexedDB → pushes complete HTML morph
4. Datastar morphs the DOM via Idiomorph

### The Tao of Datastar

- **Server pushes fat morphs** — full board re-render on every mutation via SSE `datastar-patch-elements`
- **Fewer signals is better** — just enough to communicate intent to the server
- **Server tracks UI state** — action sheets, selection mode, editing state are all in the SW's in-memory `boardUIState` Map. Mutations push full board morphs with the right UI baked in.

## Conventions

### All client-facing URLs use `base()`

`base()` returns `new URL(self.registration.scope).pathname` — critical for GitHub Pages subpath hosting (`/datastar-sw-experiment/`). Every `@get`, `@post`, `@delete`, `fetch()`, `href`, and `<script src>` in JSX output must use `` `${base()}path` ``.

### Form submissions use `{contentType: 'form'}`

Datastar form posts: `@post('${base()}columns/${col.id}/cards', {contentType: 'form'})`.

### Fractional indexing for positions

Card and column positions use `fractional-indexing`. `positionForIndex(idx, siblings)` computes a key between neighbors. The `siblings` array excludes the item being moved — so inserting at visual position N means `positionForIndex(N, filteredSiblings)`.

### CSS view transitions

Columns have `view-transition-name: col-<id>` + `view-transition-class: col`. Cards have no individual VTNs (they'd create stacking contexts that trap cards inside columns). During pointer drag, all VTNs are suppressed via `data-kanban-active` attribute.

### Touch vs pointer

`eg-kanban.js` checks `pointerType === 'touch'` — touch taps emit `kanban-card-tap` / `kanban-column-tap` custom events (routed to SW action sheet endpoints). Pointer drag only activates for `pointerType !== 'touch'`. `touch-action: none` is only set on `@media (pointer: fine)` so touch devices scroll natively.

## Working with the Service Worker

### Pick up new SW code during dev

After changing `sw.jsx`, Vite rebuilds it but the browser may still serve the old SW. Unregister and reload:

```js
navigator.serviceWorker.getRegistrations().then(r => r.forEach(r => r.unregister()))
```

Or use "Update on reload" in DevTools > Application > Service Workers.

### SW console.log goes to a separate context

SW logs appear in the SW's DevTools context, not the page console. To relay logs to the page console, broadcast via `self.clients.matchAll()` + `postMessage()` and listen with `navigator.serviceWorker.addEventListener('message', ...)` in the Shell inline script.

### SSE streams need a keep-alive loop

Event-driven streams (waiting for bus events) need: `while (!stream.closed) { await stream.sleep(30000) }`. Without this, `streamSSE`'s `finally` block closes the stream immediately.

### In-memory state is ephemeral

The browser kills idle SWs after ~30s. The event bus, `boardUIState`, actor ID cache — all gone on restart. Read from IndexedDB and rebuild. The event sourcing snapshot/replay pattern handles this: `initialize()` loads the snapshot, replays events after the snapshot sequence number.

### The SW fetch handler strips the scope prefix

`app.fetch()` receives the full URL but Hono routes are defined as `/`, `/boards/:id`, etc. The fetch handler strips `base()` before passing to Hono. Static assets (`.js`, `.css`, `.png`, etc.) are passed through to the network via a regex check.

## Idiomorph / Datastar SSE gotchas

### Give elements stable `id` attributes

Idiomorph matches elements by `id` during morph. Without `id`s, it uses heuristic matching which can fail — especially for:
- Siblings whose count changes conditionally (e.g. a button that appears/disappears)
- Elements toggled via CSS class changes (e.g. `display: none`)
- New elements inserted between existing siblings

Cards need `id="card-<uuid>"` for stable within-column reorders. Board header elements need `id`s (`#board-header`, `#board-title`, `#tab-count`, `#select-mode-btn`).

### Always render elements, toggle visibility with CSS

For elements that appear/disappear (like the tab count badge), always render the element in the DOM with an `id` and toggle visibility via a CSS class. Idiomorph can update attributes on existing elements but struggles to insert new sibling elements without `id`-based matching context.

### Datastar SSE reconnect cycle

When an SSE stream pushes a morph to `#app inner`, Datastar may briefly disconnect and reconnect the SSE stream (the morph replaces `#app`'s children, Datastar re-evaluates). This causes a transient `connect → disconnect → connect` sequence (~100ms). Design accordingly:

- Use `self.clients.matchAll()` to count open tabs (ground truth from the Clients API) rather than tracking SSE stream connect/disconnect pairs, which can be unbalanced by the reconnect cycle.
- Debounce any UI push triggered by stream lifecycle changes (300ms lets the reconnect settle).
- The `data-init="@get(...)"` on `#app` itself is stable across morphs (only inner content changes), so the reconnect is a one-time transient per page load, not infinite.

### Focus restoration after morph

SSE morphs replace DOM elements, losing focus. Use a `pendingFocus` variable + `MutationObserver` on `#app` to restore focus after the morph settles.

## Deploying to GitHub Pages

- `vite.config.js` sets `base` conditionally for the `/datastar-sw-experiment/` subpath
- `public/404.html` stores the path in sessionStorage and redirects to root (SPA fallback)
- `index.html` checks sessionStorage after SW registration and navigates to the stored path
- GitHub Pages CDN caches aggressively — changing file content (via code changes) busts the cache since Vite changes the filename hash
- `<a download>` bypasses the service worker (browser makes direct network request). Use `fetch()` → blob → `createObjectURL()` → programmatic click for downloads.

## Testing with Chrome DevTools MCP

Chrome DevTools MCP tools (`mcp_chrome-devtools_*`) work for QA. Emulate mobile with the `emulate` tool. For touch-only flows (`pointerType === 'touch'`), use `evaluate_script` to call SW routes directly since DevTools click sends mouse pointer events.

## Beans

Use `beans` CLI for task tracking. See `.beans/` directory. Always include bean file changes in commits.
