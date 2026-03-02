/** @jsxImportSource hono/jsx */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { openDB } from 'idb'
import { raw } from 'hono/html'

// --- Event Sourcing ---

// Event schema versions. Bump when event shape changes.
const EVENT_VERSIONS = {
  'column.created': 1,
  'card.created': 1,
  'card.moved': 1,
  'card.deleted': 1,
}

// Upcasters transform old event versions to current during replay.
// When a schema changes, bump the version above and add a transform here:
//   'card.created': { 1: (e) => ({ ...e, v: 2, data: { ...e.data, description: '' } }) }
const upcasters = {}

function upcast(event) {
  let e = { ...event }
  const fns = upcasters[e.type]
  if (fns) while (fns[e.v]) e = fns[e.v](e)
  return e
}

function createEvent(type, data) {
  return {
    id: crypto.randomUUID(),
    type,
    v: EVENT_VERSIONS[type],
    data,
    ts: Date.now(),
    synced: false,
  }
}

// Apply a single (upcasted) event to the projection stores within a transaction.
// Must handle missing entities gracefully (events may reference deleted items).
async function applyEvent(event, tx) {
  const { type, data } = upcast(event)
  switch (type) {
    case 'column.created':
      await tx.objectStore('columns').put(data)
      break

    case 'card.created':
      await tx.objectStore('cards').put(data)
      break

    case 'card.moved': {
      const store = tx.objectStore('cards')
      const card = await store.get(data.id)
      if (!card) break

      const sourceColumnId = card.columnId
      const allCards = await store.getAll()

      const sourceCards = allCards
        .filter(c => c.columnId === sourceColumnId && c.id !== data.id)
        .sort((a, b) => a.position - b.position)

      const targetCards = sourceColumnId === data.columnId
        ? [...sourceCards]
        : allCards
            .filter(c => c.columnId === data.columnId && c.id !== data.id)
            .sort((a, b) => a.position - b.position)

      targetCards.splice(data.position, 0, { ...card, columnId: data.columnId })

      if (sourceColumnId !== data.columnId) {
        for (let i = 0; i < sourceCards.length; i++) {
          await store.put({ ...sourceCards[i], position: i })
        }
      }
      for (let i = 0; i < targetCards.length; i++) {
        await store.put({ ...targetCards[i], columnId: data.columnId, position: i })
      }
      break
    }

    case 'card.deleted':
      await tx.objectStore('cards').delete(data.id)
      break
  }
}

// --- Database ---

const dbPromise = openDB('kanban', 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore('columns', { keyPath: 'id' })
      const cards = db.createObjectStore('cards', { keyPath: 'id' })
      cards.createIndex('byColumn', 'columnId')
    }
    if (oldVersion < 2) {
      const events = db.createObjectStore('events', { autoIncrement: true, keyPath: 'seq' })
      events.createIndex('byId', 'id', { unique: true })
      events.createIndex('bySynced', 'synced')
      db.createObjectStore('meta', { keyPath: 'key' })
    }
  },
})

// --- Event bus (CQRS: commands append events, queries listen) ---

const bus = new EventTarget()

// --- Event log operations ---

// Append event to log + apply to projection in a single transaction.
// Idempotent: skips events already in the log (by event ID).
async function appendEvent(event) {
  const db = await dbPromise
  const tx = db.transaction(['events', 'columns', 'cards'], 'readwrite')
  const existing = await tx.objectStore('events').index('byId').get(event.id)
  if (existing) { await tx.done; return }
  await tx.objectStore('events').put(event)
  await applyEvent(event, tx)
  await tx.done
  bus.dispatchEvent(new Event('boardChanged'))
}

// Nuclear rebuild: clear projection, replay all events in order.
// Use when projection is suspected to be out of sync with the event log.
async function rebuildProjection() {
  const db = await dbPromise
  const tx = db.transaction(['events', 'columns', 'cards'], 'readwrite')
  await tx.objectStore('columns').clear()
  await tx.objectStore('cards').clear()
  const allEvents = await tx.objectStore('events').getAll()
  for (const event of allEvents) {
    await applyEvent(event, tx)
  }
  await tx.done
  bus.dispatchEvent(new Event('boardChanged'))
}

// --- Initialization ---

// Backfill events from pre-event-sourcing data (v1 → v2 migration).
// Existing projection data is preserved; events are created retroactively
// so the log can rebuild the same state.
async function migrateFromV1() {
  const db = await dbPromise
  if ((await db.count('events')) > 0) return
  const columns = await db.getAll('columns')
  if (columns.length === 0) return
  const cards = await db.getAll('cards')
  const tx = db.transaction('events', 'readwrite')
  for (const col of columns.sort((a, b) => a.position - b.position)) {
    await tx.store.put(createEvent('column.created', col))
  }
  for (const card of cards.sort((a, b) => a.position - b.position)) {
    await tx.store.put(createEvent('card.created', card))
  }
  await tx.done
}

// Seed default columns on fresh install (no events, no existing data).
async function seed() {
  const db = await dbPromise
  if ((await db.count('events')) > 0) return
  if ((await db.count('columns')) > 0) return
  const cols = [
    { id: 'todo', title: 'Todo', position: 0 },
    { id: 'doing', title: 'Doing', position: 1 },
    { id: 'done', title: 'Done', position: 2 },
  ]
  const tx = db.transaction(['events', 'columns', 'cards'], 'readwrite')
  for (const col of cols) {
    const event = createEvent('column.created', col)
    await tx.objectStore('events').put(event)
    await applyEvent(event, tx)
  }
  await tx.done
}

let initialized = false
async function initialize() {
  if (initialized) return
  initialized = true
  await migrateFromV1()
  await seed()
}

// --- Sync (S2 stub — activate when credentials are configured) ---

async function pushEvents() {
  const db = await dbPromise
  const config = await db.get('meta', 's2Config')
  if (!config?.value) return
  // const unsynced = await db.getAllFromIndex('events', 'bySynced', false)
  // TODO: append to S2 stream via @s2-dev/streamstore, mark synced
}

async function pullEvents() {
  const db = await dbPromise
  const config = await db.get('meta', 's2Config')
  if (!config?.value) return
  // const lastSeq = (await db.get('meta', 'lastS2Seq'))?.value || 0n
  // TODO: read from S2 stream, appendEvent() each (idempotent by ID)
}

// --- Queries ---

async function getBoard() {
  const db = await dbPromise
  const columns = (await db.getAll('columns')).sort((a, b) => a.position - b.position)
  const cards = await db.getAll('cards')
  return { columns, cards }
}

// --- SSE helpers ---

function flattenJsx(jsx) {
  return jsx.toString().replace(/\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

function dsePatch(selector, jsx, mode = 'outer') {
  const html = flattenJsx(jsx)
  return {
    event: 'datastar-patch-elements',
    data: `mode ${mode}\nselector ${selector}\nelements ${html}`,
  }
}

// --- Components ---

function Card({ card }) {
  const dragstart = [
    `evt.dataTransfer.effectAllowed = 'move'`,
    `evt.dataTransfer.setData('cardId', '${card.id}')`,
    `evt.target.classList.add('dragging')`,
  ].join('; ')

  return (
    <div
      class="card"
      draggable="true"
      data-card-id={card.id}
      style={`view-transition-name: card-${card.id}`}
      data-on:dragstart={dragstart}
      data-on:dragend="evt.target.classList.remove('dragging')"
    >
      <span>{card.title}</span>
      <button
        class="delete-btn"
        data-on:click__viewtransition={`@delete('/cards/${card.id}')`}
      >
        ×
      </button>
    </div>
  )
}

function Column({ col, cards }) {
  const colCards = cards
    .filter(c => c.columnId === col.id)
    .sort((a, b) => a.position - b.position)

  const drop = [
    `evt.preventDefault()`,
    `evt.currentTarget.classList.remove('drag-over')`,
    `const cardId = evt.dataTransfer.getData('cardId')`,
    `const cards = evt.currentTarget.querySelectorAll('.card')`,
    `let pos = cards.length`,
    `for (let i = 0; i < cards.length; i++) { const rect = cards[i].getBoundingClientRect(); if (evt.clientY < rect.top + rect.height / 2) { pos = i; break } }`,
    `$dropColumnId = '${col.id}'`,
    `$dropPosition = pos`,
    `@put('/cards/' + cardId + '/move')`,
  ].join('; ')

  return (
    <div class="column" id={`column-${col.id}`} style={`view-transition-name: col-${col.id}`}>
      <div class="column-header">
        <h2>{col.title}</h2>
        <span class="count">{colCards.length}</span>
      </div>
      <div
        class="cards-container"
        data-column-id={col.id}
        data-on:dragover="evt.preventDefault(); evt.currentTarget.classList.add('drag-over')"
        data-on:dragleave="evt.currentTarget.classList.remove('drag-over')"
        data-on:drop={drop}
      >
        {colCards.length === 0
          ? <p class="empty">No cards yet</p>
          : colCards.map(card => <Card card={card} />)}
      </div>
      <form
        class="add-form"
        data-on:submit__prevent__viewtransition={`@post('/columns/${col.id}/cards', {contentType: 'form'}); evt.target.reset()`}
      >
        <input name="title" type="text" placeholder="Add a card..." autocomplete="off" />
        <button type="submit">+</button>
      </form>
    </div>
  )
}

function Board({ columns, cards }) {
  return (
    <div id="board">
      <h1>Kanban Board</h1>
      <div class="columns">
        {columns.map(col => <Column col={col} cards={cards} />)}
      </div>
    </div>
  )
}

// --- Shell ---

const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #0f172a;
  color: #e2e8f0;
  padding: 24px;
  min-height: 100vh;
}

h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 24px; }

.columns {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding-bottom: 16px;
  align-items: flex-start;
}

.column {
  background: #1e293b;
  border-radius: 12px;
  padding: 16px;
  min-width: 300px;
  max-width: 300px;
  flex-shrink: 0;
}

.column-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.column-header h2 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8;
  font-weight: 600;
}

.count {
  font-size: 0.75rem;
  background: #334155;
  color: #94a3b8;
  padding: 2px 8px;
  border-radius: 10px;
}

.cards-container {
  min-height: 48px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 8px;
  padding: 4px;
  transition: background 0.15s, box-shadow 0.15s;
}

.cards-container.drag-over {
  background: rgba(99, 102, 241, 0.08);
  box-shadow: inset 0 0 0 2px rgba(99, 102, 241, 0.3);
}

.empty {
  color: #475569;
  font-size: 0.85rem;
  text-align: center;
  padding: 16px;
}

.card {
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: grab;
  transition: opacity 0.15s, transform 0.15s, box-shadow 0.15s;
}

.card:hover { border-color: #475569; }
.card:active { cursor: grabbing; }
.card.dragging { opacity: 0.4; transform: scale(0.97); }
.card span { font-size: 0.9rem; word-break: break-word; }

.delete-btn {
  background: none;
  border: none;
  color: #475569;
  cursor: pointer;
  font-size: 1.1rem;
  padding: 0 4px;
  flex-shrink: 0;
  line-height: 1;
  transition: color 0.15s;
}

.delete-btn:hover { color: #ef4444; }

.add-form {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.add-form input {
  flex: 1;
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 8px 10px;
  color: #e2e8f0;
  font-size: 0.85rem;
}

.add-form input::placeholder { color: #475569; }
.add-form input:focus { outline: none; border-color: #6366f1; }

.add-form button {
  background: #6366f1;
  border: none;
  border-radius: 6px;
  color: #fff;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 1rem;
  font-weight: 600;
  transition: background 0.15s;
}

.add-form button:hover { background: #4f46e5; }

::view-transition-old(*) { animation: fade-out 0.15s ease-out; }
::view-transition-new(*) { animation: fade-in 0.2s ease-in; }

@keyframes fade-out { to { opacity: 0; transform: scale(0.95); } }
@keyframes fade-in { from { opacity: 0; transform: scale(0.95); } }
`

function Shell() {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Kanban Board</title>
        <style>{raw(CSS)}</style>
        <script
          type="module"
          src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.8/bundles/datastar.js"
        ></script>
      </head>
      <body>
        <main
          id="app"
          data-init="@get('/', { retry: 'always', retryMaxCount: 1000 })"
          data-signals:dropColumnId="''"
          data-signals:dropPosition="0"
        >
          <p>Loading...</p>
        </main>
        <script>{raw(`
          if (navigator.serviceWorker) {
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              window.location.reload();
            });
            navigator.serviceWorker.ready.then(reg => {
              setInterval(() => reg.update(), 60 * 1000);
            });
          }
          // Prevent browser from evicting IndexedDB under storage pressure
          navigator.storage?.persist?.();
        `)}</script>
      </body>
    </html>
  )
}

// --- Events debug page ---

const EVENTS_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace;
  background: #0f172a;
  color: #e2e8f0;
  padding: 24px;
  min-height: 100vh;
  font-size: 14px;
}

a { color: #818cf8; }

h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 16px; display: flex; align-items: center; gap: 12px; }
h1 span { font-size: 0.75rem; color: #64748b; font-weight: 400; }

.event-list { display: flex; flex-direction: column; gap: 2px; }

details {
  background: #1e293b;
  border-radius: 6px;
  border: 1px solid #334155;
  transition: border-color 0.15s;
}

details[open] { border-color: #475569; }

summary {
  padding: 8px 12px;
  cursor: pointer;
  display: flex;
  gap: 12px;
  align-items: center;
  list-style: none;
  user-select: none;
}

summary::-webkit-details-marker { display: none; }

summary::before {
  content: '▸';
  color: #475569;
  font-size: 0.7rem;
  transition: transform 0.15s;
  flex-shrink: 0;
}

details[open] summary::before { transform: rotate(90deg); }

.seq { color: #475569; min-width: 3ch; text-align: right; }
.type { color: #818cf8; font-weight: 600; }
.type--delete { color: #f87171; }
.type--move { color: #fbbf24; }
.type--create { color: #34d399; }
.ts { color: #475569; margin-left: auto; font-size: 0.8em; }
.synced { font-size: 0.75em; padding: 1px 6px; border-radius: 4px; }
.synced--no { background: #422006; color: #fbbf24; }
.synced--yes { background: #052e16; color: #34d399; }

pre {
  padding: 12px;
  margin: 0;
  border-top: 1px solid #334155;
  overflow-x: auto;
  font-size: 0.85em;
  line-height: 1.5;
  color: #cbd5e1;
}

.actions { display: flex; gap: 8px; margin-bottom: 16px; }

.actions button {
  background: #334155;
  border: 1px solid #475569;
  border-radius: 6px;
  color: #e2e8f0;
  padding: 6px 12px;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.85em;
  transition: background 0.15s;
}

.actions button:hover { background: #475569; }
.actions button:disabled { opacity: 0.5; cursor: wait; }

.event-count {
  color: #64748b;
  font-size: 0.8em;
  padding: 4px 0 8px;
}
`

function typeClass(type) {
  if (type.includes('deleted')) return 'type type--delete'
  if (type.includes('moved')) return 'type type--move'
  if (type.includes('created')) return 'type type--create'
  return 'type'
}

function EventList({ events }) {
  const synced = events.filter(e => e.synced).length
  const local = events.length - synced
  return (
    <div id="event-list" class="event-list">
      <p class="event-count">{events.length} events — {local} local{synced > 0 ? `, ${synced} synced` : ''}</p>
      {events.length === 0
        ? <p style="color: #475569; padding: 16px;">No events yet.</p>
        : [...events].reverse().map(evt => (
            <details>
              <summary>
                <span class="seq">{evt.seq}</span>
                <span class={typeClass(evt.type)}>{evt.type}</span>
                <span class={evt.synced ? 'synced synced--yes' : 'synced synced--no'}>
                  {evt.synced ? 'synced' : 'local'}
                </span>
                <span class="ts">{new Date(evt.ts).toLocaleTimeString()}</span>
              </summary>
              <pre>{raw(JSON.stringify(evt, null, 2).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '&#10;'))}</pre>
            </details>
          ))}
    </div>
  )
}

function EventsPage() {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Event Log</title>
        <style>{raw(EVENTS_CSS)}</style>
        <script
          type="module"
          src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.8/bundles/datastar.js"
        ></script>
      </head>
      <body>
        <h1>Event Log <span><a href="/">← board</a></span></h1>
        <div class="actions">
          <button
            data-indicator="_rebuilding"
            data-on:click="@post('/rebuild')"
            data-attr:disabled="$_rebuilding"
          >
            <span data-show="!$_rebuilding">Rebuild Projection</span>
            <span data-show="$_rebuilding">Rebuilding...</span>
          </button>
        </div>
        <div
          id="events-app"
          data-init="@get('/events', { retry: 'always', retryMaxCount: 1000 })"
        >
          <p style="color: #475569;">Connecting...</p>
        </div>
        <script>{raw(`
          if (navigator.serviceWorker) {
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              window.location.reload();
            });
          }
        `)}</script>
      </body>
    </html>
  )
}

// --- Hono app ---

const app = new Hono()

// Query: SSE stream pushes full board state on every change
app.get('/', async (c) => {
  await initialize()

  if (c.req.header('Datastar-Request') === 'true') {
    return streamSSE(c, async (stream) => {
      const pushBoard = async (selector, mode) => {
        const { columns, cards } = await getBoard()
        await stream.writeSSE(dsePatch(selector, <Board columns={columns} cards={cards} />, mode))
      }

      const handler = () => pushBoard('#board', 'outer')
      bus.addEventListener('boardChanged', handler)
      stream.onAbort(() => bus.removeEventListener('boardChanged', handler))

      // Initial render — patch into app shell
      await pushBoard('#app', 'inner')

      // Keep stream open until client disconnects
      while (!stream.closed) {
        await stream.sleep(30000)
      }
    })
  }

  return c.html('<!DOCTYPE html>' + (<Shell />).toString())
})

// Command: create card
app.post('/columns/:columnId/cards', async (c) => {
  const columnId = c.req.param('columnId')
  const body = await c.req.parseBody()
  const title = String(body.title || '').trim()
  if (!title) return c.body(null, 204)

  const db = await dbPromise
  const colCards = await db.getAllFromIndex('cards', 'byColumn', columnId)

  await appendEvent(createEvent('card.created', {
    id: crypto.randomUUID(),
    columnId,
    title,
    position: colCards.length,
  }))
  return c.body(null, 204)
})

// Command: move card
app.put('/cards/:cardId/move', async (c) => {
  const cardId = c.req.param('cardId')
  const body = await c.req.json()
  const targetColumnId = body.dropColumnId
  const targetPosition = parseInt(body.dropPosition, 10) || 0
  if (!targetColumnId) return c.body(null, 400)

  const db = await dbPromise
  const card = await db.get('cards', cardId)
  if (!card) return c.body(null, 404)

  await appendEvent(createEvent('card.moved', {
    id: cardId,
    columnId: targetColumnId,
    position: targetPosition,
  }))
  return c.body(null, 204)
})

// Command: delete card
app.delete('/cards/:cardId', async (c) => {
  await appendEvent(createEvent('card.deleted', {
    id: c.req.param('cardId'),
  }))
  return c.body(null, 204)
})

// Debug: inspect event log (real-time)
app.get('/events', async (c) => {
  await initialize()

  if (c.req.header('Datastar-Request') === 'true') {
    return streamSSE(c, async (stream) => {
      const pushEventList = async (selector, mode) => {
        const db = await dbPromise
        const allEvents = await db.getAll('events')
        await stream.writeSSE(dsePatch(selector, <EventList events={allEvents} />, mode))
      }

      const handler = () => pushEventList('#event-list', 'outer')
      bus.addEventListener('boardChanged', handler)
      stream.onAbort(() => bus.removeEventListener('boardChanged', handler))

      // Initial render — patch into app container
      await pushEventList('#events-app', 'inner')

      while (!stream.closed) {
        await stream.sleep(30000)
      }
    })
  }

  return c.html('<!DOCTYPE html>' + (<EventsPage />).toString())
})

// Debug: event log JSON API
app.get('/events.json', async (c) => {
  const db = await dbPromise
  const allEvents = await db.getAll('events')
  return c.json(allEvents)
})

// Debug: rebuild projection from event log
app.post('/rebuild', async (c) => {
  await rebuildProjection()
  return c.body(null, 204)
})

// --- Service Worker lifecycle ---

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return
  event.respondWith(app.fetch(event.request))
})
