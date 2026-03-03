/** @jsxImportSource hono/jsx */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { openDB } from 'idb'
import { raw } from 'hono/html'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import egKanbanCode from './eg-kanban.js?raw'

// Base path derived from SW scope — '/' locally, '/repo-name/' on GitHub Pages.
// Lazy-init because self.registration isn't available at module parse time.
let _base
function base() {
  if (!_base) _base = new URL(self.registration.scope).pathname
  return _base
}

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
  'card.titleUpdated': 1,
  'card.descriptionUpdated': 1,
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

    case 'card.titleUpdated': {
      const store = tx.objectStore('cards')
      const card = await store.get(data.id)
      if (!card) break
      await store.put({ ...card, title: data.title })
      break
    }

    case 'card.descriptionUpdated': {
      const store = tx.objectStore('cards')
      const card = await store.get(data.id)
      if (!card) break
      await store.put({ ...card, description: data.description })
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
  if (type.startsWith('card.')) {
    let columnId = data.columnId
    if (!columnId && data.id) {
      const card = await tx.objectStore('cards').get(data.id)
      columnId = card?.columnId
    }
    if (columnId) {
      const col = await tx.objectStore('columns').get(columnId)
      return col?.boardId || null
    }
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

// --- Undo / Redo ---
// Per-board undo/redo stacks. Each entry is an array of events to reverse/replay.
// Mutations push { undo: [reverseEvents], redo: [originalEvents] } onto undoStack.
// Undo pops undoStack, appends undo events, pushes to redoStack.
// Redo pops redoStack, appends redo events, pushes to undoStack.

const MAX_UNDO = 50
const undoStacks = new Map() // boardId → [{ undo: [...], redo: [...] }]
const redoStacks = new Map() // boardId → [{ undo: [...], redo: [...] }]

function getStack(map, boardId) {
  if (!map.has(boardId)) map.set(boardId, [])
  return map.get(boardId)
}

// Build reverse events for a set of forward events.
// Must be called BEFORE the forward events are applied (needs old state).
async function buildUndoEntry(events) {
  const db = await dbPromise
  const undoEvents = []
  const redoEvents = []

  for (const evt of events) {
    const { type, data } = evt
    switch (type) {
      case 'card.created':
        undoEvents.push({ type: 'card.deleted', data: { id: data.id } })
        redoEvents.push({ type: 'card.created', data: { ...data } })
        break

      case 'card.deleted': {
        const card = await db.get('cards', data.id)
        if (card) {
          undoEvents.push({ type: 'card.created', data: { ...card } })
          redoEvents.push({ type: 'card.deleted', data: { id: data.id } })
        }
        break
      }

      case 'card.moved': {
        const card = await db.get('cards', data.id)
        if (card) {
          undoEvents.push({ type: 'card.moved', data: { id: data.id, columnId: card.columnId, position: card.position } })
          redoEvents.push({ type: 'card.moved', data: { ...data } })
        }
        break
      }

      case 'card.titleUpdated': {
        const card = await db.get('cards', data.id)
        if (card) {
          undoEvents.push({ type: 'card.titleUpdated', data: { id: data.id, title: card.title } })
          redoEvents.push({ type: 'card.titleUpdated', data: { ...data } })
        }
        break
      }

      case 'card.descriptionUpdated': {
        const card = await db.get('cards', data.id)
        if (card) {
          undoEvents.push({ type: 'card.descriptionUpdated', data: { id: data.id, description: card.description || '' } })
          redoEvents.push({ type: 'card.descriptionUpdated', data: { ...data } })
        }
        break
      }

      case 'column.created':
        undoEvents.push({ type: 'column.deleted', data: { id: data.id } })
        redoEvents.push({ type: 'column.created', data: { ...data } })
        break

      case 'column.deleted': {
        const col = await db.get('columns', data.id)
        if (col) {
          // Also snapshot cards in this column so undo restores them
          const colCards = await db.getAllFromIndex('cards', 'byColumn', data.id)
          undoEvents.push({ type: 'column.created', data: { ...col } })
          for (const card of colCards) {
            undoEvents.push({ type: 'card.created', data: { ...card } })
          }
          redoEvents.push({ type: 'column.deleted', data: { id: data.id } })
        }
        break
      }

      case 'column.moved': {
        const col = await db.get('columns', data.id)
        if (col) {
          undoEvents.push({ type: 'column.moved', data: { id: data.id, position: col.position } })
          redoEvents.push({ type: 'column.moved', data: { ...data } })
        }
        break
      }

      case 'board.created':
        undoEvents.push({ type: 'board.deleted', data: { id: data.id } })
        redoEvents.push({ type: 'board.created', data: { ...data } })
        break

      case 'board.deleted': {
        const board = await db.get('boards', data.id)
        if (board) {
          undoEvents.push({ type: 'board.created', data: { ...board } })
          redoEvents.push({ type: 'board.deleted', data: { id: data.id } })
        }
        break
      }
    }
  }

  return undoEvents.length > 0 ? { undo: undoEvents, redo: redoEvents } : null
}

// Wrap appendEvents to auto-push undo entries.
// isUndoRedo flag prevents undo/redo actions from pushing onto the stacks recursively.
async function appendEventsWithUndo(events, boardId, { isUndoRedo = false } = {}) {
  if (!isUndoRedo && boardId) {
    const entry = await buildUndoEntry(events)
    if (entry) {
      const stack = getStack(undoStacks, boardId)
      stack.push(entry)
      if (stack.length > MAX_UNDO) stack.shift()
      // Clear redo stack on new mutation
      redoStacks.set(boardId, [])
    }
  }
  await appendEvents(events.map(e =>
    e.id ? e : createEvent(e.type, e.data)
  ))
}

// Nuclear rebuild: clear projection, replay all events in order.
// Use when projection is suspected to be out of sync with the event log.
// Saves a snapshot afterward so future incremental rebuilds can skip replayed events.
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
  // Save snapshot: projection state at the last replayed event seq
  const lastSeq = allEvents.length > 0 ? allEvents[allEvents.length - 1].seq : 0
  await tx.objectStore('meta').put({
    key: 'snapshot',
    seq: lastSeq,
    boards: await tx.objectStore('boards').getAll(),
    columns: await tx.objectStore('columns').getAll(),
    cards: await tx.objectStore('cards').getAll(),
  })
  const boardIds = (await tx.objectStore('boards').getAllKeys())
  await tx.done
  // Notify all scoped listeners after full rebuild
  bus.dispatchEvent(new CustomEvent('boards:changed', { detail: null }))
  for (const id of boardIds) {
    bus.dispatchEvent(new CustomEvent(`board:${id}:changed`, { detail: null }))
  }
  bus.dispatchEvent(new CustomEvent('events:changed', { detail: null }))
}

// Incremental rebuild: restore from snapshot, replay only newer events.
// Falls back to full rebuildProjection() if no snapshot exists.
async function rebuildFromSnapshot() {
  const db = await dbPromise
  const snapshot = await db.get('meta', 'snapshot')
  if (!snapshot) return rebuildProjection()

  const tx = db.transaction(ALL_STORES, 'readwrite')
  // Restore projection from snapshot
  await tx.objectStore('boards').clear()
  await tx.objectStore('columns').clear()
  await tx.objectStore('cards').clear()
  for (const b of snapshot.boards) await tx.objectStore('boards').put(b)
  for (const c of snapshot.columns) await tx.objectStore('columns').put(c)
  for (const c of snapshot.cards) await tx.objectStore('cards').put(c)
  // Replay only events after the snapshot seq
  const range = IDBKeyRange.lowerBound(snapshot.seq, true) // exclusive
  const newEvents = await tx.objectStore('events').getAll(range)
  for (const event of newEvents) {
    await applyEvent(event, tx)
  }
  const boardIds = (await tx.objectStore('boards').getAllKeys())
  await tx.done
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
  const desc = card.description || ''
  return (
    <div
      class="card"
      id={`card-${card.id}`}
      data-card-id={card.id}
      tabindex="0"
      style="touch-action: none"
    >
      <div class="card-content">
        <span class="card-title">{card.title}</span>
        {desc && <p class="card-desc">{desc}</p>}
      </div>
      <div class="card-actions">
        <button
          class="card-edit-btn"
          data-on:click={`$editingCard = $editingCard === '${card.id}' ? '' : '${card.id}'`}
          title="Edit"
        >&#9998;</button>
        <button
          class="delete-btn"
          data-on:click__viewtransition={`@delete('${base()}cards/${card.id}')`}
        >
          ×
        </button>
      </div>
      <form
        class="card-edit-form"
        data-show={`$editingCard === '${card.id}'`}
        data-on:submit__prevent={`@put('${base()}cards/${card.id}', {contentType: 'form'}); $editingCard = ''`}
      >
        <input name="title" type="text" value={card.title} placeholder="Title" autocomplete="off" />
        <textarea name="description" placeholder="Description (optional)" rows="2">{desc}</textarea>
        <div class="card-edit-actions">
          <button type="submit">Save</button>
          <button type="button" data-on:click="$editingCard = ''">Cancel</button>
        </div>
      </form>
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
      style={`view-transition-name: col-${col.id}; view-transition-class: col; touch-action: none`}
    >
      <div class="column-header" tabindex="0">
        <h2>{col.title}</h2>
        <span class="count">{colCards.length}</span>
        {columnCount > 1 && (
          <button
            class="col-delete-btn"
            data-on:click__viewtransition={`@delete('${base()}columns/${col.id}')`}
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
        data-on:submit__prevent__viewtransition={`@post('${base()}columns/${col.id}/cards', {contentType: 'form'}); evt.target.reset()`}
      >
        <input name="title" type="text" placeholder="Add a card..." autocomplete="off" />
        <button type="submit">+</button>
      </form>
    </div>
  )
}

function Board({ board, columns, cards }) {
  return (
    <div id="board" data-signals="{editingCard: ''}">
      <div class="board-header">
        <a href={base()} class="back-link">← Boards</a>
        <h1>{board.title}</h1>
      </div>
      <div class="columns">
        {columns.map(col => <Column col={col} cards={cards} columnCount={columns.length} />)}
      </div>
      <form
        class="add-col-form"
        data-on:submit__prevent__viewtransition={`@post('${base()}boards/${board.id}/columns', {contentType: 'form'}); evt.target.reset()`}
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
        data-on:click__prevent__viewtransition={`@delete('${base()}boards/${board.id}')`}
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
          data-on:submit__prevent={`@post('${base()}boards', {contentType: 'form'})`}
        >
          <input name="title" type="text" placeholder="New board name..." autocomplete="off" />
          <button type="submit">+ Board</button>
        </form>
      </div>
      <div class="boards-toolbar">
        <a href={`${base()}export`} class="toolbar-btn" download="kanban-export.json">Export</a>
        <button class="toolbar-btn" id="import-btn">Import</button>
        <input type="file" id="import-file" accept=".json" style="display:none" />
      </div>
      <script>{raw(`
        document.getElementById('import-btn').addEventListener('click', function() {
          document.getElementById('import-file').click();
        });
        document.getElementById('import-file').addEventListener('change', async function(e) {
          var file = e.target.files[0];
          if (!file) return;
          var text = await file.text();
          var resp = await fetch('${base()}import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: text
          });
          if (resp.ok) window.location.reload();
          else alert('Import failed: ' + resp.statusText);
          e.target.value = '';
        });
      `)}</script>
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

.boards-toolbar {
  margin-top: 24px;
  display: flex;
  gap: 8px;
  justify-content: center;
}
.toolbar-btn {
  background: #1e293b;
  color: #94a3b8;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 6px 16px;
  font-size: 0.85rem;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
}
.toolbar-btn:hover { background: #334155; color: #e2e8f0; }

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

.column-header:focus-visible { outline: none; box-shadow: 0 0 0 2px #6366f1; border-radius: 6px; }

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
  font-size: 0.9rem;
  text-align: center;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
}

/* Hide "No cards yet" when a drag ghost is in the same container */
.cards-container:has(.card-ghost) .empty { display: none; }

.card {
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  cursor: grab;
  transition: border-color 0.15s;
  user-select: none;
}

.card:hover { border-color: #475569; }
.card:focus-visible { outline: none; box-shadow: 0 0 0 2px #6366f1; }
.card[data-kanban-dragging],
.card[data-kanban-hold] { opacity: 0.5; z-index: 100; }
.card[data-kanban-dropping] { position: relative; z-index: 50; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3); }

.card-content { flex: 1; min-width: 0; }
.card-title { font-size: 0.9rem; word-break: break-word; }
.card-desc { font-size: 0.8rem; color: #94a3b8; margin: 4px 0 0; word-break: break-word; }
.card-actions { display: flex; gap: 2px; flex-shrink: 0; margin-left: 4px; }

.card-edit-btn {
  background: none; border: none; color: #475569; cursor: pointer;
  font-size: 0.9rem; padding: 0 4px; line-height: 1; transition: color 0.15s;
}
.card-edit-btn:hover { color: #6366f1; }

.card-edit-form {
  width: 100%; margin-top: 8px; display: flex; flex-direction: column; gap: 6px;
}
.card-edit-form input,
.card-edit-form textarea {
  background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 6px;
  padding: 6px 8px; font-size: 0.85rem; font-family: inherit; resize: vertical;
}
.card-edit-form input:focus,
.card-edit-form textarea:focus { outline: none; border-color: #6366f1; }
.card-edit-actions { display: flex; gap: 6px; }
.card-edit-actions button {
  padding: 4px 12px; border-radius: 6px; border: 1px solid #334155; cursor: pointer;
  font-size: 0.8rem; transition: background 0.15s;
}
.card-edit-actions button[type="submit"] { background: #6366f1; color: #fff; border-color: #6366f1; }
.card-edit-actions button[type="submit"]:hover { background: #4f46e5; }
.card-edit-actions button[type="button"] { background: #1e293b; color: #94a3b8; }
.card-edit-actions button[type="button"]:hover { background: #334155; }

.card-ghost {
  border: 2px dashed #6366f1;
  border-radius: 8px;
  background: rgba(99, 102, 241, 0.08);
  flex-shrink: 0;
  box-sizing: border-box;
}

/* During pointer drag, suppress ALL VTNs — drag itself provides visual feedback */
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
/* Columns above default during view transitions so moving column renders on top */
::view-transition-group(*.col) { z-index: 50; }

/* body cursor during drag (set by eg-kanban) */
body[style*="cursor: grabbing"] * { cursor: grabbing !important; }
`

function Shell({ path, children }) {
  const routePath = path || '/'
  const isBoardPage = routePath.startsWith('/boards/')
  // Client-side SSE URL needs the base path so the browser hits the SW scope.
  const sseUrl = base() + routePath.replace(/^\//, '')
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
        {isBoardPage && <script src={`${base()}eg-kanban.js`}></script>}
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

          // Drag-and-drop and keyboard moves use raw fetch() to SW routes.
          // eg-kanban.js emits CustomEvents — the SSE morph handles UI updates.

          // Focus restoration after SSE morph: save the focused element's
          // identity before the morph replaces the DOM, then re-focus it.
          var pendingFocus = null;
          var focusObserver = new MutationObserver(function() {
            if (!pendingFocus) return;
            var el = null;
            if (pendingFocus.cardId) {
              el = document.querySelector('[data-card-id="' + pendingFocus.cardId + '"]');
            } else if (pendingFocus.columnId) {
              var col = document.getElementById('column-' + pendingFocus.columnId);
              if (col) el = col.querySelector('.column-header');
            }
            if (el) { el.focus({ preventScroll: false }); pendingFocus = null; }
          });
          focusObserver.observe(document.getElementById('app'), { childList: true, subtree: true });

          document.getElementById('app').addEventListener('kanban-card-drag-end', function(e) {
            var d = e.detail;
            if (!d.columnId || !d.cardId) return;
            pendingFocus = { cardId: d.cardId };
            fetch('${base()}cards/' + d.cardId + '/move', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dropColumnId: d.columnId, dropPosition: d.position })
            });
          });

          document.getElementById('app').addEventListener('kanban-column-drag-end', function(e) {
            var d = e.detail;
            if (!d.columnId) return;
            pendingFocus = { columnId: d.columnId };
            fetch('${base()}columns/' + d.columnId + '/move', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dropPosition: d.position })
            });
          });

          // Undo/Redo: Ctrl+Z / Ctrl+Shift+Z (or Cmd on Mac)
          document.addEventListener('keydown', function(e) {
            if (!(e.ctrlKey || e.metaKey) || e.key !== 'z') return;
            // Don't intercept when typing in an input/textarea
            var tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea') return;
            e.preventDefault();
            var boardMatch = location.pathname.match(/boards\\/([^/]+)/);
            if (!boardMatch) return;
            var boardId = boardMatch[1];
            var action = e.shiftKey ? 'redo' : 'undo';
            fetch('${base()}boards/' + boardId + '/' + action, { method: 'POST' });
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
        <h1>Event Log <span><a href={base()}>← board</a></span></h1>
        <div class="actions">
          <button
            data-indicator="_rebuilding"
            data-on:click={`@post('${base()}rebuild')`}
            data-attr:disabled="$_rebuilding"
          >
            <span data-show="!$_rebuilding">Rebuild Projection</span>
            <span data-show="$_rebuilding">Rebuilding...</span>
          </button>
        </div>
        <div
          id="events-app"
           data-init={`@get('${base()}events', { retry: 'always', retryMaxCount: 1000 })`}
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
            data: `mode append\nselector body\nelements <script>window.location.href = '${base()}boards/${evt.data.id}'</script>`,
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

// Helper: resolve boardId from a column or card
async function boardIdFromColumn(columnId) {
  const db = await dbPromise
  const col = await db.get('columns', columnId)
  return col?.boardId || null
}
async function boardIdFromCard(cardId) {
  const db = await dbPromise
  const card = await db.get('cards', cardId)
  if (!card) return null
  return boardIdFromColumn(card.columnId)
}

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
  const boardId = await boardIdFromColumn(columnId)

  const evt = createEvent('card.created', {
    id: crypto.randomUUID(),
    columnId,
    title,
    position: generateKeyBetween(lastPos, null),
  })
  await appendEventsWithUndo([evt], boardId)
  return c.body(null, 204)
})

// Command: update card (title/description)
app.put('/cards/:cardId', async (c) => {
  const cardId = c.req.param('cardId')
  const body = await c.req.parseBody()

  const db = await dbPromise
  const card = await db.get('cards', cardId)
  if (!card) return c.body(null, 404)

  const correlationId = crypto.randomUUID()
  const events = []

  const newTitle = String(body.title || '').trim()
  if (newTitle && newTitle !== card.title) {
    events.push(createEvent('card.titleUpdated', { id: cardId, title: newTitle }, { correlationId }))
  }

  const newDesc = (body.description ?? '').trim()
  const oldDesc = card.description || ''
  if (newDesc !== oldDesc) {
    events.push(createEvent('card.descriptionUpdated', { id: cardId, description: newDesc }, { correlationId }))
  }

  if (events.length > 0) {
    const boardId = await boardIdFromCard(cardId)
    await appendEventsWithUndo(events, boardId)
  }
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

  const boardId = await boardIdFromCard(cardId)
  const evt = createEvent('card.moved', {
    id: cardId,
    columnId: targetColumnId,
    position: positionForIndex(dropIndex, siblings),
  })
  await appendEventsWithUndo([evt], boardId)
  return c.body(null, 204)
})

// Command: delete column (and its cards)
app.delete('/columns/:columnId', async (c) => {
  const columnId = c.req.param('columnId')
  const boardId = await boardIdFromColumn(columnId)
  const evt = createEvent('column.deleted', { id: columnId })
  await appendEventsWithUndo([evt], boardId)
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

  const evt = createEvent('column.moved', {
    id: columnId,
    position: positionForIndex(dropIndex, siblings),
  })
  await appendEventsWithUndo([evt], col.boardId)
  return c.body(null, 204)
})

// Command: delete card
app.delete('/cards/:cardId', async (c) => {
  const cardId = c.req.param('cardId')
  const boardId = await boardIdFromCard(cardId)
  const evt = createEvent('card.deleted', { id: cardId })
  await appendEventsWithUndo([evt], boardId)
  return c.body(null, 204)
})

// Command: undo
app.post('/boards/:boardId/undo', async (c) => {
  const boardId = c.req.param('boardId')
  const stack = getStack(undoStacks, boardId)
  if (stack.length === 0) return c.body(null, 204)
  const entry = stack.pop()
  getStack(redoStacks, boardId).push(entry)
  await appendEventsWithUndo(
    entry.undo.map(e => createEvent(e.type, e.data)),
    boardId,
    { isUndoRedo: true }
  )
  return c.body(null, 204)
})

// Command: redo
app.post('/boards/:boardId/redo', async (c) => {
  const boardId = c.req.param('boardId')
  const stack = getStack(redoStacks, boardId)
  if (stack.length === 0) return c.body(null, 204)
  const entry = stack.pop()
  getStack(undoStacks, boardId).push(entry)
  await appendEventsWithUndo(
    entry.redo.map(e => createEvent(e.type, e.data)),
    boardId,
    { isUndoRedo: true }
  )
  return c.body(null, 204)
})

// --- Export / Import ---

app.get('/export', async (c) => {
  const db = await dbPromise
  const events = await db.getAll('events')
  // Strip auto-increment seq key — import will re-assign
  const cleaned = events.map(({ seq, ...rest }) => rest)
  return c.newResponse(JSON.stringify(cleaned, null, 2), 200, {
    'Content-Type': 'application/json',
    'Content-Disposition': 'attachment; filename="kanban-export.json"',
  })
})

app.post('/import', async (c) => {
  const events = await c.req.json()
  if (!Array.isArray(events)) return c.text('Expected JSON array', 400)
  // Replay events through appendEvents — deduplicates by event id
  await appendEvents(events)
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
  // Strip the SW scope prefix so Hono routes match regardless of base path.
  // e.g. /datastar-sw-experiment/boards/123 → /boards/123
  const scope = new URL(self.registration.scope).pathname
  if (scope !== '/' && url.pathname.startsWith(scope)) {
    url.pathname = '/' + url.pathname.slice(scope.length)
  }
  // Spread only safe RequestInit properties — mode:'navigate' is not
  // settable via the Request constructor, so we omit it (defaults to 'cors').
  // duplex:'half' is required when body is a ReadableStream.
  const init = {
    method: event.request.method,
    headers: event.request.headers,
    redirect: event.request.redirect,
    signal: event.request.signal,
  }
  if (event.request.body) {
    init.body = event.request.body
    init.duplex = 'half'
  }
  const req = new Request(url, init)
  event.respondWith(app.fetch(req))
})
