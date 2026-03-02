/** @jsxImportSource hono/jsx */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { openDB } from 'idb'
import { raw } from 'hono/html'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import egKanbanCode from './eg-kanban.js?raw'

// --- Event Sourcing ---

// Event schema versions. Bump when event shape changes.
const EVENT_VERSIONS = {
  'board.created': 1,
  'board.deleted': 1,
  'column.created': 2,
  'column.deleted': 1,
  'column.moved': 1,
  'card.created': 1,
  'card.moved': 1,
  'card.deleted': 1,
}

// Upcasters transform old event versions to current during replay.
// When a schema changes, bump the version above and add a transform here.
const upcasters = {
  'column.created': {
    1: (e) => ({ ...e, v: 2, data: { ...e.data, boardId: e.data.boardId || 'default' } }),
  },
}

function upcast(event) {
  let e = { ...event }
  const fns = upcasters[e.type]
  if (fns) while (fns[e.v]) e = fns[e.v](e)
  return e
}

// Stable device identifier, resolved during initialize().
let actorId = null

function createEvent(type, data, { correlationId, causationId } = {}) {
  return {
    id: crypto.randomUUID(),
    type,
    v: EVENT_VERSIONS[type],
    data,
    ts: Date.now(),
    synced: false,
    correlationId: correlationId || crypto.randomUUID(),
    causationId: causationId || null,
    actorId,
  }
}

// Apply a single (upcasted) event to the projection stores within a transaction.
// Must handle missing entities gracefully (events may reference deleted items).
// If upcasting changed the event, persist the upcasted version to avoid re-upcasting on future replays.
async function applyEvent(event, tx) {
  const upcasted = upcast(event)
  if (upcasted.v !== event.v) {
    await tx.objectStore('events').put({ ...upcasted, seq: event.seq })
  }
  const { type, data } = upcasted
  switch (type) {
    case 'board.created':
      await tx.objectStore('boards').put(data)
      break

    case 'board.deleted': {
      await tx.objectStore('boards').delete(data.id)
      // Delete all columns and cards belonging to this board
      const cols = await tx.objectStore('columns').index('byBoard').getAll(data.id)
      for (const col of cols) {
        const colCards = await tx.objectStore('cards').index('byColumn').getAll(col.id)
        for (const card of colCards) await tx.objectStore('cards').delete(card.id)
        await tx.objectStore('columns').delete(col.id)
      }
      break
    }

    case 'column.created':
      await tx.objectStore('columns').put(data)
      break

    case 'column.deleted': {
      // Delete column and all its cards (no reindexing — fractional keys tolerate gaps)
      const colStore = tx.objectStore('columns')
      const cardStore = tx.objectStore('cards')
      await colStore.delete(data.id)
      const colCards = await cardStore.index('byColumn').getAll(data.id)
      for (const card of colCards) {
        await cardStore.delete(card.id)
      }
      break
    }

    case 'column.moved': {
      const colStore = tx.objectStore('columns')
      const col = await colStore.get(data.id)
      if (!col) break
      await colStore.put({ ...col, position: data.position })
      break
    }

    case 'card.created':
      await tx.objectStore('cards').put(data)
      break

    case 'card.moved': {
      const store = tx.objectStore('cards')
      const card = await store.get(data.id)
      if (!card) break
      await store.put({ ...card, columnId: data.columnId, position: data.position })
      break
    }

    case 'card.deleted':
      await tx.objectStore('cards').delete(data.id)
      break
  }
}

// --- Database ---

const dbPromise = openDB('kanban', 3, {
  upgrade(db, oldVersion, _newVersion, tx) {
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
    if (oldVersion < 3) {
      db.createObjectStore('boards', { keyPath: 'id' })
      // Add byBoard index to columns (need to recreate if store already exists)
      const colStore = tx.objectStore('columns')
      if (!colStore.indexNames.contains('byBoard')) {
        colStore.createIndex('byBoard', 'boardId')
      }
    }
  },
})

// --- Event bus (CQRS: commands append events, queries listen) ---

const bus = new EventTarget()

// --- Event log operations ---

// Append event to log + apply to projection in a single transaction.
// Idempotent: skips events already in the log (by event ID).
const ALL_STORES = ['events', 'boards', 'columns', 'cards']

// Resolve boardId from event data + projection stores (within an open tx).
async function boardIdForEvent(event, tx) {
  const { type, data } = event
  if (type.startsWith('board.')) return data.id
  if (data.boardId) return data.boardId
  // Card events: look up column → boardId
  if (type.startsWith('card.') && data.columnId) {
    const col = await tx.objectStore('columns').get(data.columnId)
    return col?.boardId || null
  }
  // column.moved/deleted: look up column directly
  if (type.startsWith('column.') && data.id) {
    const col = await tx.objectStore('columns').get(data.id)
    return col?.boardId || null
  }
  return null
}

// Append multiple events atomically in a single IDB transaction.
// Dispatches scoped bus events after commit: board:<id>:changed for
// board-specific events, boards:changed for board-level mutations.
async function appendEvents(events) {
  const db = await dbPromise
  const tx = db.transaction(ALL_STORES, 'readwrite')
  const appended = [] // [{ event, boardId }]
  for (const event of events) {
    const existing = await tx.objectStore('events').index('byId').get(event.id)
    if (existing) continue
    // Resolve boardId before apply (column may be deleted by applyEvent)
    const boardId = await boardIdForEvent(event, tx)
    await tx.objectStore('events').put(event)
    await applyEvent(event, tx)
    appended.push({ event, boardId })
  }
  await tx.done
  for (const { event, boardId } of appended) {
    if (boardId) {
      bus.dispatchEvent(new CustomEvent(`board:${boardId}:changed`, { detail: event }))
    }
    if (event.type.startsWith('board.')) {
      bus.dispatchEvent(new CustomEvent('boards:changed', { detail: event }))
    }
    bus.dispatchEvent(new CustomEvent('events:changed', { detail: event }))
  }
}

async function appendEvent(event) {
  return appendEvents([event])
}

// Nuclear rebuild: clear projection, replay all events in order.
// Use when projection is suspected to be out of sync with the event log.
async function rebuildProjection() {
  const db = await dbPromise
  const tx = db.transaction(ALL_STORES, 'readwrite')
  await tx.objectStore('boards').clear()
  await tx.objectStore('columns').clear()
  await tx.objectStore('cards').clear()
  const allEvents = await tx.objectStore('events').getAll()
  for (const event of allEvents) {
    await applyEvent(event, tx)
  }
  const boardIds = (await tx.objectStore('boards').getAllKeys())
  await tx.done
  // Notify all scoped listeners after full rebuild
  bus.dispatchEvent(new CustomEvent('boards:changed', { detail: null }))
  for (const id of boardIds) {
    bus.dispatchEvent(new CustomEvent(`board:${id}:changed`, { detail: null }))
  }
  bus.dispatchEvent(new CustomEvent('events:changed', { detail: null }))
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
  for (const col of columns.sort(cmpPosition)) {
    await tx.store.put(createEvent('column.created', col))
  }
  for (const card of cards.sort(cmpPosition)) {
    await tx.store.put(createEvent('card.created', card))
  }
  await tx.done
}

// Migrate pre-boards data: ensure all columns have a boardId and a board exists.
// Appends a board.created event then rebuilds the projection. The column.created
// upcaster (v1→v2) adds boardId:'default' to existing column events during replay,
// so no direct projection writes are needed.
async function migrateToBoards() {
  const db = await dbPromise
  const boards = await db.getAll('boards')
  if (boards.length > 0) return // already migrated
  const columns = await db.getAll('columns')
  if (columns.length === 0) return // nothing to migrate
  // Append board event and let rebuildProjection handle column tagging via upcaster
  await appendEvent(createEvent('board.created', {
    id: 'default',
    title: 'My Board',
    createdAt: Date.now(),
  }))
  await rebuildProjection()
}

// Seed: no-op if any boards exist. Fresh install creates nothing — user creates their first board.
async function seed() {
  // Legacy seed for pre-boards installs (no events, no columns = fresh)
  const db = await dbPromise
  if ((await db.count('events')) > 0) return
  if ((await db.count('columns')) > 0) return
  // Fresh install — no default data, user creates first board from /
}

let initialized = false
async function initialize() {
  if (initialized) return
  initialized = true
  // Resolve stable device identity
  const db = await dbPromise
  const stored = await db.get('meta', 'actorId')
  if (stored) {
    actorId = stored.value
  } else {
    actorId = crypto.randomUUID()
    await db.put('meta', { key: 'actorId', value: actorId })
  }
  await migrateFromV1()
  await seed()
  await migrateToBoards()
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

async function getBoards() {
  const db = await dbPromise
  const boards = await db.getAll('boards')
  // Attach column/card counts
  const columns = await db.getAll('columns')
  const cards = await db.getAll('cards')
  return boards.map(b => ({
    ...b,
    columnCount: columns.filter(c => c.boardId === b.id).length,
    cardCount: cards.filter(c => columns.some(col => col.boardId === b.id && col.id === c.columnId)).length,
  })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

async function getBoard(boardId) {
  const db = await dbPromise
  const board = await db.get('boards', boardId)
  if (!board) return null
  const columns = (await db.getAllFromIndex('columns', 'byBoard', boardId))
    .sort(cmpPosition)
  const cards = await db.getAll('cards')
  // Only include cards belonging to this board's columns
  const colIds = new Set(columns.map(c => c.id))
  return { board, columns, cards: cards.filter(c => colIds.has(c.columnId)) }
}

// --- Position helpers (fractional indexing) ---

// Lexicographic comparator for fractional-indexing string keys.
const cmpPosition = (a, b) => a.position < b.position ? -1 : a.position > b.position ? 1 : 0

// Given a drop index (0-based insertion point among visible siblings) and the
// sorted list of siblings (excluding the moved item), compute a fractional key.
// eg-kanban.js sends integer drop indices; this converts to a fractional key
// so the event stores a commutative position value (no sibling reindexing).
function positionForIndex(dropIndex, sortedSiblings) {
  const before = dropIndex > 0 ? sortedSiblings[dropIndex - 1].position : null
  const after = dropIndex < sortedSiblings.length ? sortedSiblings[dropIndex].position : null
  return generateKeyBetween(before, after)
}

// --- SSE helpers ---

function flattenJsx(jsx) {
  return jsx.toString().replace(/\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

function dsePatch(selector, jsx, mode = 'outer', { useViewTransition = false } = {}) {
  const html = flattenJsx(jsx)
  const lines = [`mode ${mode}`, `selector ${selector}`]
  if (useViewTransition) lines.push('useViewTransition true')
  lines.push(`elements ${html}`)
  return {
    event: 'datastar-patch-elements',
    data: lines.join('\n'),
  }
}

// --- Components ---

function Card({ card }) {
  return (
    <div
      class="card"
      data-card-id={card.id}
      style={`view-transition-name: card-${card.id}; touch-action: none`}
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

function Column({ col, cards, columnCount }) {
  const colCards = cards
    .filter(c => c.columnId === col.id)
    .sort(cmpPosition)

  return (
    <div
      class="column"
      id={`column-${col.id}`}
      style={`view-transition-name: col-${col.id}; touch-action: none`}
    >
      <div class="column-header">
        <h2>{col.title}</h2>
        <span class="count">{colCards.length}</span>
        {columnCount > 1 && (
          <button
            class="col-delete-btn"
            data-on:click__viewtransition={`@delete('/columns/${col.id}')`}
          >×</button>
        )}
      </div>
      <div class="cards-container" data-column-id={col.id}>
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

function Board({ board, columns, cards }) {
  return (
    <div id="board">
      <div class="board-header">
        <a href="/" class="back-link">← Boards</a>
        <h1>{board.title}</h1>
      </div>
      <div class="columns">
        {columns.map(col => <Column col={col} cards={cards} columnCount={columns.length} />)}
      </div>
      <form
        class="add-col-form"
        data-on:submit__prevent__viewtransition={`@post('/boards/${board.id}/columns', {contentType: 'form'}); evt.target.reset()`}
      >
        <input name="title" type="text" placeholder="Add a column..." autocomplete="off" />
        <button type="submit">+ Column</button>
      </form>
    </div>
  )
}

function BoardCard({ board }) {
  return (
    <div class="board-card" style={`view-transition-name: board-${board.id}`}>
      <a class="board-card-link" href={`/boards/${board.id}`}>
        <h2>{board.title}</h2>
        <div class="board-meta">
          <span>{board.columnCount} {board.columnCount === 1 ? 'column' : 'columns'}</span>
          <span>·</span>
          <span>{board.cardCount} {board.cardCount === 1 ? 'card' : 'cards'}</span>
        </div>
      </a>
      <button
        class="board-delete-btn"
        data-on:click__prevent__viewtransition={`@delete('/boards/${board.id}')`}
      >×</button>
    </div>
  )
}

function BoardsList({ boards }) {
  return (
    <div id="boards-list">
      <h1>Boards</h1>
      <div class="boards-grid">
        {boards.map(b => <BoardCard board={b} />)}
        <form
          class="board-new"
          data-on:submit__prevent="@post('/boards', {contentType: 'form'})"
        >
          <input name="title" type="text" placeholder="New board name..." autocomplete="off" />
          <button type="submit">+ Board</button>
        </form>
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
  min-height: 100vh;
}

/* ── Boards list ─────────────────────────────────────── */

#boards-list { padding: 24px; max-width: 800px; margin: 0 auto; }
#boards-list h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 24px; }

.boards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.board-card {
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 12px;
  position: relative;
  transition: border-color 0.15s;
}
.board-card:hover { border-color: #6366f1; }
.board-card-link {
  display: block;
  padding: 20px;
  text-decoration: none;
  color: inherit;
  cursor: pointer;
}
.board-card h2 { font-size: 1rem; font-weight: 600; margin-bottom: 8px; }
.board-meta { font-size: 0.8rem; color: #64748b; display: flex; gap: 6px; }

.board-delete-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  background: none;
  border: none;
  color: #475569;
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
  padding: 2px 4px;
}
.board-delete-btn:hover { color: #ef4444; }

.board-new {
  background: transparent;
  border: 2px dashed #334155;
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.board-new input {
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 8px 10px;
  color: #e2e8f0;
  font-size: 0.85rem;
}
.board-new input::placeholder { color: #475569; }
.board-new input:focus { outline: none; border-color: #6366f1; }
.board-new button {
  background: #6366f1;
  border: none;
  border-radius: 6px;
  color: #fff;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
}
.board-new button:hover { background: #4f46e5; }

/* ── Board detail ───────────────────────────────────── */

.board-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}
.board-header h1 { font-size: 1.5rem; font-weight: 600; }
.back-link {
  color: #6366f1;
  text-decoration: none;
  font-size: 0.85rem;
  white-space: nowrap;
}
.back-link:hover { text-decoration: underline; }

#board { padding: 24px; }

.columns {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding: 0 24px 16px 24px;
  align-items: flex-start;
}

.column {
  background: #1e293b;
  border-radius: 12px;
  padding: 16px;
  min-width: 300px;
  max-width: 300px;
  flex-shrink: 0;
  user-select: none;
}

.column[data-kanban-dragging],
.column[data-kanban-hold] { opacity: 0.5; z-index: 100; }
.column[data-kanban-dropping] { position: relative; z-index: 50; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3); }

.column-ghost {
  border: 2px dashed #6366f1;
  border-radius: 12px;
  background: rgba(99, 102, 241, 0.05);
  flex-shrink: 0;
  box-sizing: border-box;
}

.column input, .column textarea { user-select: text; }

.column-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  cursor: grab;
}

.column-header h2 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8;
  font-weight: 600;
  flex: 1;
}

.col-delete-btn {
  background: none;
  border: none;
  color: #475569;
  cursor: pointer;
  font-size: 0.9rem;
  padding: 0 4px;
  line-height: 1;
  transition: color 0.15s;
}

.col-delete-btn:hover { color: #ef4444; }

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



.empty {
  color: #475569;
  font-size: 0.85rem;
  text-align: center;
  padding: 16px;
}

/* Hide "No cards yet" when a drag ghost is in the same container */
.cards-container:has(.card-ghost) .empty { display: none; }

.card {
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: grab;
  transition: border-color 0.15s;
  user-select: none;
}

.card:hover { border-color: #475569; }
.card[data-kanban-dragging],
.card[data-kanban-hold] { opacity: 0.5; z-index: 100; }
.card[data-kanban-dropping] { position: relative; z-index: 50; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3); }
.card span { font-size: 0.9rem; word-break: break-word; }

.card-ghost {
  border: 2px dashed #6366f1;
  border-radius: 8px;
  background: rgba(99, 102, 241, 0.08);
  flex-shrink: 0;
  box-sizing: border-box;
}

/* During drag, suppress VTN so no stacking contexts trap the fixed-position element */
#board[data-kanban-active] .column,
#board[data-kanban-active] .card { view-transition-name: none !important; }

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

.add-col-form {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  padding: 0 24px;
}

.add-col-form input {
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 10px 14px;
  color: #e2e8f0;
  font-size: 0.85rem;
  width: 200px;
}

.add-col-form input::placeholder { color: #475569; }
.add-col-form input:focus { outline: none; border-color: #6366f1; }

.add-col-form button {
  background: #334155;
  border: 1px solid #475569;
  border-radius: 8px;
  color: #e2e8f0;
  padding: 10px 16px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
  transition: background 0.15s;
}

.add-col-form button:hover { background: #475569; }

/* MPA cross-document view transitions */
@view-transition { navigation: auto; }

::view-transition-group(*) {
  animation-duration: 200ms;
  animation-timing-function: cubic-bezier(0.2, 0, 0, 1);
}
::view-transition-old(*) { animation: none; opacity: 0; }
::view-transition-new(*) { animation: none; }

/* body cursor during drag (set by eg-kanban) */
body[style*="cursor: grabbing"] * { cursor: grabbing !important; }
`

function Shell({ path, children }) {
  const sseUrl = path || '/'
  const isBoardPage = sseUrl.startsWith('/boards/')
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Kanban</title>
        <style>{raw(CSS)}</style>
        <script
          type="module"
          src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.8/bundles/datastar.js"
        ></script>
        {isBoardPage && <script src="/eg-kanban.js"></script>}
      </head>
      <body>
        <main
          id="app"
          data-init={`@get('${sseUrl}', { retry: 'always', retryMaxCount: 1000 })`}
        >
          {children || <p>Loading...</p>}
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
          navigator.storage?.persist?.();

          // Initialize eg-kanban when #board appears.
          // Runs on mutations (SSE morph) AND immediately for pre-rendered content.
          var kanbanCleanup = null;
          function checkKanban() {
            var board = document.getElementById('board');
            if (board && !kanbanCleanup && window.initKanban) {
              kanbanCleanup = window.initKanban(board);
            }
            if (!board && kanbanCleanup) {
              kanbanCleanup();
              kanbanCleanup = null;
            }
          }
          var boardObserver = new MutationObserver(checkKanban);
          boardObserver.observe(document.getElementById('app'), { childList: true, subtree: true });
          checkKanban();

          // Drag-and-drop uses raw fetch() instead of Datastar @put actions.
          // eg-kanban.js emits CustomEvents on drop — wiring those into
          // Datastar expressions would be awkward. The SSE morph from the
          // SW handles the UI update; these are fire-and-forget commands.
          document.getElementById('app').addEventListener('kanban-card-drag-end', function(e) {
            var d = e.detail;
            if (!d.columnId || !d.cardId) return;
            fetch('/cards/' + d.cardId + '/move', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dropColumnId: d.columnId, dropPosition: d.position })
            });
          });

          // Column drop → PUT to SW
          document.getElementById('app').addEventListener('kanban-column-drag-end', function(e) {
            var d = e.detail;
            if (!d.columnId) return;
            fetch('/columns/' + d.columnId + '/move', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dropPosition: d.position })
            });
          });
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

// Serve eg-kanban.js (imported as raw string at build time)
app.get('/eg-kanban.js', (c) => {
  return c.body(egKanbanCode, 200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' })
})

// ── Boards list (index) ──────────────────────────────────────────────────────

app.get('/', async (c) => {
  await initialize()

  if (c.req.header('Datastar-Request') === 'true') {
    return streamSSE(c, async (stream) => {
      const push = async (selector, mode, opts) => {
        const boards = await getBoards()
        await stream.writeSSE(dsePatch(selector, <BoardsList boards={boards} />, mode, opts))
      }

      const handler = (e) => {
        const evt = e.detail
        if (evt?.type === 'board.created') {
          // Redirect to the newly created board instead of morphing the list
          stream.writeSSE({
            event: 'datastar-patch-elements',
            data: `mode append\nselector body\nelements <script>window.location.href = '/boards/${evt.data.id}'</script>`,
          })
          return
        }
        if (evt?.type === 'board.deleted') {
          push('#boards-list', 'outer', { useViewTransition: true })
        }
      }
      bus.addEventListener('boards:changed', handler)
      stream.onAbort(() => bus.removeEventListener('boards:changed', handler))

      await push('#app', 'inner')
      while (!stream.closed) { await stream.sleep(30000) }
    })
  }

  const boards = await getBoards()
  return c.html('<!DOCTYPE html>' + (<Shell path="/"><BoardsList boards={boards} /></Shell>).toString())
})

// Command: create board
app.post('/boards', async (c) => {
  const body = await c.req.parseBody()
  const title = String(body.title || '').trim()
  if (!title) return c.body(null, 204)

  const boardId = crypto.randomUUID()
  const correlationId = crypto.randomUUID()
  const boardEvent = createEvent('board.created', {
    id: boardId,
    title,
    createdAt: Date.now(),
  }, { correlationId })
  // Seed default columns for the new board — single atomic transaction
  const positions = generateNKeysBetween(null, null, 3)
  const colEvents = [
    { id: crypto.randomUUID(), title: 'Todo', position: positions[0], boardId },
    { id: crypto.randomUUID(), title: 'Doing', position: positions[1], boardId },
    { id: crypto.randomUUID(), title: 'Done', position: positions[2], boardId },
  ].map(col => createEvent('column.created', col, { correlationId, causationId: boardEvent.id }))
  await appendEvents([boardEvent, ...colEvents])
  return c.body(null, 204)
})

// Command: delete board (and all its columns/cards)
app.delete('/boards/:boardId', async (c) => {
  await appendEvent(createEvent('board.deleted', {
    id: c.req.param('boardId'),
  }))
  return c.body(null, 204)
})

// ── Board detail ─────────────────────────────────────────────────────────────

app.get('/boards/:boardId', async (c) => {
  await initialize()
  const boardId = c.req.param('boardId')

  if (c.req.header('Datastar-Request') === 'true') {
    return streamSSE(c, async (stream) => {
      const pushBoard = async (selector, mode, opts) => {
        const data = await getBoard(boardId)
        if (!data) return
        await stream.writeSSE(dsePatch(selector, <Board board={data.board} columns={data.columns} cards={data.cards} />, mode, opts))
      }

      const topic = `board:${boardId}:changed`
      const handler = () => pushBoard('#board', 'outer', { useViewTransition: true })
      bus.addEventListener(topic, handler)
      stream.onAbort(() => bus.removeEventListener(topic, handler))

      await pushBoard('#app', 'inner')
      while (!stream.closed) { await stream.sleep(30000) }
    })
  }

  const data = await getBoard(boardId)
  return c.html('<!DOCTYPE html>' + (
    <Shell path={`/boards/${boardId}`}>
      {data ? <Board board={data.board} columns={data.columns} cards={data.cards} /> : <p>Board not found</p>}
    </Shell>
  ).toString())
})

// Command: create column (board-scoped)
app.post('/boards/:boardId/columns', async (c) => {
  const boardId = c.req.param('boardId')
  const body = await c.req.parseBody()
  const title = String(body.title || '').trim()
  if (!title) return c.body(null, 204)

  const db = await dbPromise
  const columns = (await db.getAllFromIndex('columns', 'byBoard', boardId))
    .sort(cmpPosition)
  const lastPos = columns.length > 0 ? columns[columns.length - 1].position : null

  await appendEvent(createEvent('column.created', {
    id: crypto.randomUUID(),
    title,
    boardId,
    position: generateKeyBetween(lastPos, null),
  }))
  return c.body(null, 204)
})

// Command: create card
app.post('/columns/:columnId/cards', async (c) => {
  const columnId = c.req.param('columnId')
  const body = await c.req.parseBody()
  const title = String(body.title || '').trim()
  if (!title) return c.body(null, 204)

  const db = await dbPromise
  const colCards = (await db.getAllFromIndex('cards', 'byColumn', columnId))
    .sort(cmpPosition)
  const lastPos = colCards.length > 0 ? colCards[colCards.length - 1].position : null

  await appendEvent(createEvent('card.created', {
    id: crypto.randomUUID(),
    columnId,
    title,
    position: generateKeyBetween(lastPos, null),
  }))
  return c.body(null, 204)
})

// Command: move card
app.put('/cards/:cardId/move', async (c) => {
  const cardId = c.req.param('cardId')
  const body = await c.req.json()
  const targetColumnId = body.dropColumnId
  const dropIndex = parseInt(body.dropPosition, 10) || 0
  if (!targetColumnId) return c.body(null, 400)

  const db = await dbPromise
  const card = await db.get('cards', cardId)
  if (!card) return c.body(null, 404)

  // Get sorted cards in target column, excluding the card being moved
  const siblings = (await db.getAllFromIndex('cards', 'byColumn', targetColumnId))
    .filter(c => c.id !== cardId)
    .sort(cmpPosition)

  await appendEvent(createEvent('card.moved', {
    id: cardId,
    columnId: targetColumnId,
    position: positionForIndex(dropIndex, siblings),
  }))
  return c.body(null, 204)
})

// Command: delete column (and its cards)
app.delete('/columns/:columnId', async (c) => {
  await appendEvent(createEvent('column.deleted', {
    id: c.req.param('columnId'),
  }))
  return c.body(null, 204)
})

// Command: move column
app.put('/columns/:columnId/move', async (c) => {
  const columnId = c.req.param('columnId')
  const body = await c.req.json()
  const dropIndex = parseInt(body.dropPosition, 10)
  if (isNaN(dropIndex)) return c.body(null, 400)

  const db = await dbPromise
  const col = await db.get('columns', columnId)
  if (!col) return c.body(null, 404)

  // Get sorted columns in same board, excluding the column being moved
  const siblings = (await db.getAllFromIndex('columns', 'byBoard', col.boardId))
    .filter(c => c.id !== columnId)
    .sort(cmpPosition)

  await appendEvent(createEvent('column.moved', {
    id: columnId,
    position: positionForIndex(dropIndex, siblings),
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
      bus.addEventListener('events:changed', handler)
      stream.onAbort(() => bus.removeEventListener('events:changed', handler))

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
