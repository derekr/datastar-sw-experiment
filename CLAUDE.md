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

### Why CQRS: what complexity disappears

**Commands don't decide what to return.** In traditional REST, every mutation handler must figure out what data the client needs to update the UI — the full resource? related resources? computed aggregates? This scatters read/formatting logic across every endpoint and causes bugs where the response is missing something the UI needs (move a card, column count doesn't update because the response only returned the card). Here, every command returns `204`. The SSE handler is the single place that reads the full projection and renders `<Board />`. One read path, one render path.

**No stale siblings.** In request-response, after a mutation you must figure out what *else* on the page is now stale — the `queryClient.invalidateQueries` problem. Did creating a card change the column count? The board header badge? You have to manually enumerate what to invalidate, and you inevitably miss things. With SSE push, the bus dispatches `board:<id>:changed`, the SSE handler reads the entire board projection and pushes a complete morph. Everything is consistent by construction because it's all rendered from the same read.

**Multi-client sync is free.** Two tabs with the same board open both have SSE streams subscribed to `board:<id>:changed`. One tab creates a card, `appendEvents` fires the bus event, both streams push. No polling, no separate WebSocket layer, no "refetch on focus" logic. The tab count feature is a concrete example — it falls out of the architecture rather than being bolted on.

**No optimistic update rollback.** Traditional SPAs optimistically update the UI, send the mutation, and roll back on failure. This causes bugs: partial rollbacks, race conditions between concurrent optimistic updates, flicker when the server response disagrees. With CQRS+SSE where the SW is in-process, the latency between command and morph is near-zero, so optimistic updates are unnecessary.

**Command handlers become pure validation + intent.** When a handler doesn't format a response, it focuses entirely on "is this valid?" and "what happened?" The delete column handler (`sw.jsx:552-562`) is: clear the action sheet if needed, create a `column.deleted` event, append it, return 204. No conditional logic about what to include in the response.

**UI state and data state use the same push mechanism.** Action sheets, selection mode, editing state are ephemeral UI concerns that don't warrant events, but `emitUI()` uses the same SSE push path as data mutations. The SSE handler reads `getUIState()` alongside `getBoard()` and renders both into `<Board />`. One state-update pipeline on the client, not two.

### What event sourcing adds (beyond CQRS)

CQRS benefits come from the command/query separation itself. Event sourcing adds:

- **Undo/redo** — `lib/undo.js` builds reverse events by snapshotting state before the forward events. Without event sourcing, undo requires storing before/after snapshots (expensive) or inverse-operation logic per mutation type (brittle).
- **Time travel** — `replayToPosition` replays events up to a target index to reconstruct past board states. Only possible with the full event history.
- **Audit trail** — Card detail view shows the event history for that card via `loadCardEvents`. Just a query over the event store.
- **Idempotent replay** — `appendEvents` deduplicates by event ID (`lib/events.js:175`), making future sync safe: receive the same event twice, it's a no-op.
- **Schema evolution without migration** — Upcasters (`lib/events.js:4-15`) transform old event formats on read. No data migration needed — add an upcaster and the projection rebuilds correctly.

The cost: the event store grows (mitigated by snapshots in `lib/init.js`), and event schemas are append-only.

### Single-flight mutations vs CQRS+SSE

Single-flight mutations (where the mutation response *is* the updated data, one roundtrip) solve the same problem — keeping the UI in sync — with opposite tradeoffs. Single-flight couples the write path to the read path (the command handler must know what data the UI needs) and only updates the client that made the request. CQRS+SSE decouples them and pushes to all connected clients. In this architecture, single-flight would add response-formatting logic to every command handler for no benefit — the SSE stream is already open and the push latency is near-zero because the SW is in-process.

### Performance characteristics

**The "two roundtrips" objection is mostly wrong here.** The common concern with CQRS is latency from separating command and query. That assumes network latency between command acceptance and read-model update — which doesn't exist when the SW is in-process.

- **SSE stream is already open.** No connection setup cost for the push. The command posts, returns 204, and the bus dispatch is synchronous — the SSE handler calls `pushBoard` immediately within the same microtask cycle.
- **204 is faster than a formatted response.** The command handler does less work (no reading updated state, no rendering HTML). The total work is the same, but the command returns to the client sooner.
- **Natural batching.** Multiple rapid mutations (e.g., batch-move selected cards) create multiple events in one `appendEvents` call, one bus notification, one SSE push of the final state. In request-response, each mutation needs its own formatted response.
- **No over-fetching negotiation.** Every SSE push is the full board render. No client-server negotiation about response shape (GraphQL fields, REST includes, sparse fieldsets). With Idiomorph doing efficient DOM diffing, the actual DOM mutations are minimal regardless of the HTML payload size.
- **The real cost is the full read on every push.** The SSE handler calls `getBoard()` (reads boards, columns, cards from IDB) and renders full `<Board />` JSX on every mutation. For a kanban board with reasonable card counts this is fast. At scale (thousands of cards), partial pushes or read-model caching would be worth considering. But this cost exists regardless of CQRS — request-response would do the same read to format its response.

Net: same total work as request-response, different distribution, with multi-client sync at zero additional cost.

### Session isolation (Bun only)

The SW is single-user (one browser, one IndexedDB). The Bun server is shared — without isolation, every visitor sees everyone else's boards. Isolation uses query-level filtering, not separate databases.

**How it works:** `runtime/bun-entry.ts` provides a `resolveSessionId` function via `runtimeConfig`. The middleware in `sw.jsx` calls it on every request and stores the result on the Hono context (`c.set('sessionId', ...)`). Board creation stamps `sessionId` on the `board.created` event data. `getBoards(sessionId)` filters at read time. A guard middleware on `/boards/:boardId` and `/boards/:boardId/*` returns 404 if the board's `sessionId` doesn't match. The SW provides no resolver, so `c.get('sessionId')` returns undefined and no filtering happens.

**Why not per-session SQLite:** The app has ~8 module-level singletons (db adapter, event bus, actorId, initialized flag, boardUIState, undoStacks, etc.) that assume single-tenant. Per-session databases would require `AsyncLocalStorage` to scope all of them, plus changing every `dbPromise` reference to a session-aware lookup. Query-level filtering achieves the same user-facing isolation with minimal code changes.

**Bus scoping trade-off:** The event bus fires `boards:changed` for all board mutations, waking every session's boards-list SSE stream. Each stream re-reads its own filtered board list and pushes a morph. For other sessions the HTML is unchanged, so Idiomorph no-ops. Board-specific topics (`board:<id>:changed`) are naturally scoped — the session guard prevents cross-session board access, so no session has an SSE stream listening on another session's board ID. The only cross-session noise is on broad topics (`boards:changed`, `events:changed`), which is negligible for a demo. To eliminate it, prefix those topics with session ID in `appendEvents()` and the SSE listeners.

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

### Bundled assets get content-hashed filenames

`stellar.css` and `eg-kanban.js` are bundled through Vite via `vite-plugin-sw.js`. In production, they're emitted as `assets/stellar-{hash}.css` and `assets/eg-kanban-{hash}.js` for cache busting. The plugin injects `__STELLAR_CSS__` and `__KANBAN_JS__` globals via Vite's `define` — the SW references them as `` `${base()}${__STELLAR_CSS__}` ``.

In dev, the plugin serves these files from source via middleware. The inner `buildSW()` call passes the `define` values explicitly (since it uses `configFile: false`).

### Static assets that don't need hashing go in `public/`

Icons, manifest, 404.html, .nojekyll — these live in `public/` and are served directly by Vite / GitHub Pages. The SW fetch handler passes all `.js`, `.css`, `.png`, etc. requests through to the network via a regex check.

**Why assets aren't served from Hono routes**: Safari's SW fetch handler doesn't reliably intercept `<script src>` subresource requests on SW-served pages — the request skips the SW and goes straight to the network.

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
