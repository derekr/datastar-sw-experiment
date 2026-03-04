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

// --- Server-tracked UI state ---
// In-memory, per-board. Mutations push a full board morph with the
// relevant UI baked in (action sheet, selection mode, editing card).
// No client signals needed — the server is the source of truth for UI mode.

const boardUIState = new Map() // boardId → { activeCardSheet, activeColSheet, selectionMode, selectedCards, editingCard }

function getUIState(boardId) {
  if (!boardUIState.has(boardId)) {
    boardUIState.set(boardId, {
      activeCardSheet: null,   // card ID whose action sheet is open, or null
      activeColSheet: null,    // column ID whose action sheet is open, or null
      selectionMode: false,    // whether selection mode is active
      selectedCards: new Set(), // set of selected card IDs
      editingCard: null,       // card ID being edited inline, or null
    })
  }
  return boardUIState.get(boardId)
}

function clearUIState(boardId) {
  const ui = getUIState(boardId)
  ui.activeCardSheet = null
  ui.activeColSheet = null
  ui.selectionMode = false
  ui.selectedCards.clear()
  ui.editingCard = null
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

function Card({ card, uiState }) {
  const desc = card.description || ''
  const isEditing = uiState?.editingCard === card.id
  const isSelecting = uiState?.selectionMode
  const isSelected = uiState?.selectedCards?.has(card.id)

  return (
    <div
      class={`card${isSelected ? ' card--selected' : ''}`}
      id={`card-${card.id}`}
      data-card-id={card.id}
      tabindex="0"
      {...(isSelecting ? {
        'data-kanban-no-drag': '',
        'data-on:click': `@post('${base()}cards/${card.id}/toggle-select')`,
      } : {})}
    >
      {isSelecting && (
        <span class="card-select-checkbox">{isSelected ? '\u2611' : '\u2610'}</span>
      )}
      <div class="card-content">
        <span class="card-title">{card.title}</span>
        {desc && <p class="card-desc">{desc}</p>}
      </div>
      {!isSelecting && (
        <div class="card-actions">
          <button
            class="card-edit-btn"
            data-on:click={`@post('${base()}cards/${card.id}/edit')`}
            title="Edit"
          >&#9998;</button>
          <button
            class="delete-btn"
            data-on:click__viewtransition={`@delete('${base()}cards/${card.id}')`}
          >
            ×
          </button>
        </div>
      )}
      {isEditing && (
        <form
          class="card-edit-form"
          data-on:submit__prevent={`@put('${base()}cards/${card.id}', {contentType: 'form'})`}
        >
          <input name="title" type="text" value={card.title} placeholder="Title" autocomplete="off" />
          <textarea name="description" placeholder="Description (optional)" rows="2">{desc}</textarea>
          <div class="card-edit-actions">
            <button type="submit">Save</button>
            <button type="button" data-on:click={`@post('${base()}cards/${card.id}/edit-cancel')`}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}

function ActionSheet({ card, columns }) {
  // Show "Move to" buttons for every column except the card's current one
  const otherColumns = columns.filter(c => c.id !== card.columnId)
  return (
    <div class="action-sheet-backdrop" data-on:click={`@post('${base()}cards/sheet/dismiss')`}>
      <div class="action-sheet" data-on:click__stop="void 0">
        <div class="action-sheet-header">
          <span class="action-sheet-title">{card.title}</span>
        </div>
        {otherColumns.length > 0 && (
          <div class="action-sheet-section">
            <span class="action-sheet-label">Move to</span>
            {otherColumns.map(col => (
              <button
                class="action-sheet-btn"
                data-on:click={`@post('${base()}cards/${card.id}/sheet-move/${col.id}')`}
              >{col.title}</button>
            ))}
          </div>
        )}
        <div class="action-sheet-section">
          <button
            class="action-sheet-btn"
            data-on:click={`@post('${base()}cards/${card.id}/edit')`}
          >Edit</button>
          <button
            class="action-sheet-btn action-sheet-btn--danger"
            data-on:click__viewtransition={`@delete('${base()}cards/${card.id}')`}
          >Delete</button>
        </div>
        <button
          class="action-sheet-btn action-sheet-btn--cancel"
          data-on:click={`@post('${base()}cards/sheet/dismiss')`}
        >Cancel</button>
      </div>
    </div>
  )
}

function ColumnSheet({ col, colIndex, columnCount, boardId }) {
  return (
    <div class="action-sheet-backdrop" data-on:click={`@post('${base()}columns/sheet/dismiss')`}>
      <div class="action-sheet" data-on:click__stop="void 0">
        <div class="action-sheet-header">
          <span class="action-sheet-title">{col.title}</span>
        </div>
        <div class="action-sheet-section">
          <span class="action-sheet-label">Reorder</span>
          {colIndex > 0 && (
            <button
              class="action-sheet-btn"
              data-on:click={`@post('${base()}columns/${col.id}/sheet-move-left')`}
            >← Move left</button>
          )}
          {colIndex < columnCount - 1 && (
            <button
              class="action-sheet-btn"
              data-on:click={`@post('${base()}columns/${col.id}/sheet-move-right')`}
            >Move right →</button>
          )}
        </div>
        {columnCount > 1 && (
          <div class="action-sheet-section">
            <button
              class="action-sheet-btn action-sheet-btn--danger"
              data-on:click__viewtransition={`@delete('${base()}columns/${col.id}')`}
            >Delete column</button>
          </div>
        )}
        <button
          class="action-sheet-btn action-sheet-btn--cancel"
          data-on:click={`@post('${base()}columns/sheet/dismiss')`}
        >Cancel</button>
      </div>
    </div>
  )
}

function Column({ col, cards, columnCount, uiState, columns }) {
  const colCards = cards
    .filter(c => c.columnId === col.id)
    .sort(cmpPosition)

  return (
    <div
      class="column"
      id={`column-${col.id}`}
      style={`view-transition-name: col-${col.id}; view-transition-class: col`}
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
          : colCards.map(card => <Card card={card} uiState={uiState} />)}
      </div>
      {!uiState?.selectionMode && (
        <form
          class="add-form"
          data-on:submit__prevent__viewtransition={`@post('${base()}columns/${col.id}/cards', {contentType: 'form'}); evt.target.reset()`}
        >
          <input name="title" type="text" placeholder="Add a card..." autocomplete="off" />
          <button type="submit">+</button>
        </form>
      )}
    </div>
  )
}

function Board({ board, columns, cards, uiState }) {
  const isSelecting = uiState?.selectionMode
  const selectedCount = uiState?.selectedCards?.size || 0
  const sheetCard = uiState?.activeCardSheet
    ? cards.find(c => c.id === uiState.activeCardSheet) || null
    : null
  const sheetColIndex = uiState?.activeColSheet
    ? columns.findIndex(c => c.id === uiState.activeColSheet)
    : -1
  const sheetCol = sheetColIndex >= 0 ? columns[sheetColIndex] : null
  return (
    <div id="board">
      <div class="board-header">
        <a href={base()} class="back-link">← Boards</a>
        <h1>{board.title}</h1>
        {!isSelecting && (
          <button
            class="select-mode-btn"
            data-on:click={`@post('${base()}boards/${board.id}/select-mode')`}
          >Select</button>
        )}
      </div>
      <div class="columns">
        {columns.map(col => (
          <Column col={col} cards={cards} columnCount={columns.length} uiState={uiState} columns={columns} />
        ))}
      </div>
      {!isSelecting && (
        <form
          class="add-col-form"
          data-on:submit__prevent__viewtransition={`@post('${base()}boards/${board.id}/columns', {contentType: 'form'}); evt.target.reset()`}
        >
          <input name="title" type="text" placeholder="Add a column..." autocomplete="off" />
          <button type="submit">+ Column</button>
        </form>
      )}
      {isSelecting && (
        <SelectionBar boardId={board.id} columns={columns} selectedCount={selectedCount} />
      )}
      {sheetCard && (
        <ActionSheet card={sheetCard} columns={columns} />
      )}
      {sheetCol && (
        <ColumnSheet col={sheetCol} colIndex={sheetColIndex} columnCount={columns.length} boardId={board.id} />
      )}
    </div>
  )
}

function SelectionBar({ boardId, columns, selectedCount }) {
  return (
    <div class="selection-bar" data-signals="{showColumnPicker: false}">
      <span class="selection-bar-count">{selectedCount} selected</span>
      <div class="selection-bar-actions">
        <button
          class="selection-bar-btn"
          data-on:click="$showColumnPicker = !$showColumnPicker"
          disabled={selectedCount === 0}
        >Move to…</button>
        <div class="column-picker" data-show="$showColumnPicker">
          {columns.map(col => (
            <button
              class="column-picker-btn"
              data-on:click={`@post('${base()}boards/${boardId}/batch-move/${col.id}'); $showColumnPicker = false`}
            >{col.title}</button>
          ))}
        </div>
        <button
          class="selection-bar-btn selection-bar-btn--danger"
          data-on:click__viewtransition={`@post('${base()}boards/${boardId}/batch-delete')`}
          disabled={selectedCount === 0}
        >Delete</button>
        <button
          class="selection-bar-btn"
          data-on:click={`@post('${base()}boards/${boardId}/select-mode/cancel')`}
        >Cancel</button>
      </div>
    </div>
  )
}

function BoardCard({ board }) {
  return (
    <div class="board-card" style={`view-transition-name: board-${board.id}`}>
      <a class="board-card-link" href={`${base()}boards/${board.id}`}>
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
        <button class="toolbar-btn" id="export-btn">Export</button>
        <button class="toolbar-btn" id="import-btn">Import</button>
        <input type="file" id="import-file" accept=".json" style="display:none" />
      </div>
      <script>{raw(`
        document.getElementById('export-btn').addEventListener('click', async function() {
          var resp = await fetch('${base()}export');
          var blob = await resp.blob();
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'kanban-export.json';
          a.click();
          URL.revokeObjectURL(url);
        });
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
  min-height: 100dvh;
  -webkit-text-size-adjust: 100%;
}

/* ── Boards list ─────────────────────────────────────── */

#boards-list {
  padding: clamp(12px, 4vw, 24px);
  max-width: 800px;
  margin: 0 auto;
}
#boards-list h1 {
  font-size: clamp(1.25rem, 1rem + 1vw, 1.5rem);
  font-weight: 600;
  margin-bottom: clamp(16px, 3vw, 24px);
}

.boards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(200px, 100%), 1fr));
  gap: clamp(10px, 2vw, 16px);
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
  padding: clamp(14px, 3vw, 20px);
  text-decoration: none;
  color: inherit;
  cursor: pointer;
}
.board-card h2 { font-size: 1rem; font-weight: 600; margin-bottom: 8px; }
.board-meta { font-size: 0.8rem; color: #64748b; display: flex; gap: 6px; flex-wrap: wrap; }

.board-delete-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  background: none;
  border: none;
  color: #475569;
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
  padding: 6px 8px;
  min-width: 44px;
  min-height: 44px;
  display: grid;
  place-items: center;
}
.board-delete-btn:hover { color: #ef4444; }

.board-new {
  background: transparent;
  border: 2px dashed #334155;
  border-radius: 12px;
  padding: clamp(14px, 3vw, 20px);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.board-new input {
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 10px;
  color: #e2e8f0;
  font-size: 0.875rem;
}
.board-new input::placeholder { color: #475569; }
.board-new input:focus { outline: none; border-color: #6366f1; }
.board-new button {
  background: #6366f1;
  border: none;
  border-radius: 6px;
  color: #fff;
  padding: 10px 14px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 600;
}
.board-new button:hover { background: #4f46e5; }

.boards-toolbar {
  margin-top: clamp(16px, 3vw, 24px);
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}
.toolbar-btn {
  background: #1e293b;
  color: #94a3b8;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 0.875rem;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
}
.toolbar-btn:hover { background: #334155; color: #e2e8f0; }

/* ── Board detail ───────────────────────────────────── */

.board-header {
  display: flex;
  align-items: center;
  gap: clamp(8px, 2vw, 16px);
  margin-bottom: clamp(12px, 3vw, 24px);
  flex-wrap: wrap;
}
.board-header h1 {
  font-size: clamp(1.125rem, 1rem + 1vw, 1.5rem);
  font-weight: 600;
}
.back-link {
  color: #6366f1;
  text-decoration: none;
  font-size: 0.85rem;
  white-space: nowrap;
}
.back-link:hover { text-decoration: underline; }

#board { padding: clamp(8px, 2vw, 24px); }

.columns {
  display: flex;
  gap: clamp(10px, 2vw, 16px);
  overflow-x: auto;
  /* Let columns scroll edge-to-edge; padding on scroll container
     so first/last column aren't flush against the viewport edge. */
  padding: 0 clamp(8px, 2vw, 24px) 16px;
  align-items: flex-start;
  /* Momentum scrolling on iOS */
  -webkit-overflow-scrolling: touch;
  /* Snap columns into view on swipe */
  scroll-snap-type: x mandatory;
  scroll-padding: 0 clamp(8px, 2vw, 24px);
}

.column {
  background: #1e293b;
  border-radius: 12px;
  padding: clamp(10px, 2vw, 16px);
  /* Fluid column width: 85vw on phones, capped at 300px on wider screens */
  width: clamp(260px, 75vw, 300px);
  min-width: clamp(260px, 75vw, 300px);
  max-width: 300px;
  flex-shrink: 0;
  user-select: none;
  scroll-snap-align: center;
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
  padding: 6px;
  min-width: 44px;
  min-height: 44px;
  display: grid;
  place-items: center;
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
  font-size: 0.9rem; padding: 6px; min-width: 44px; min-height: 44px;
  display: grid; place-items: center; line-height: 1; transition: color 0.15s;
}
.card-edit-btn:hover { color: #6366f1; }

.card-edit-form {
  width: 100%; margin-top: 8px; display: flex; flex-direction: column; gap: 6px;
}
.card-edit-form input,
.card-edit-form textarea {
  background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 6px;
  padding: 8px 10px; font-size: 0.875rem; font-family: inherit; resize: vertical;
}
.card-edit-form input:focus,
.card-edit-form textarea:focus { outline: none; border-color: #6366f1; }
.card-edit-actions { display: flex; gap: 6px; }
.card-edit-actions button {
  padding: 8px 14px; border-radius: 6px; border: 1px solid #334155; cursor: pointer;
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

/* Suppress text selection on everything during drag */
#board[data-kanban-active] { user-select: none; -webkit-user-select: none; }

/* Disable scroll snap during drag — lets auto-scroll work smoothly */
#board[data-kanban-active] .columns { scroll-snap-type: none; }

/* Pointer drag needs touch-action: none to prevent browser scroll stealing
   the pointer. Only set for fine pointer (mouse/trackpad) — touch devices
   use native scroll + tap-for-action-sheet instead of drag. */
@media (pointer: fine) {
  .card, .column { touch-action: none; }
}

.delete-btn {
  background: none;
  border: none;
  color: #475569;
  cursor: pointer;
  font-size: 1.1rem;
  padding: 6px;
  min-width: 44px;
  min-height: 44px;
  display: grid;
  place-items: center;
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
  min-width: 0;
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 10px;
  color: #e2e8f0;
  font-size: 0.875rem;
}

.add-form input::placeholder { color: #475569; }
.add-form input:focus { outline: none; border-color: #6366f1; }

.add-form button {
  background: #6366f1;
  border: none;
  border-radius: 6px;
  color: #fff;
  padding: 10px 14px;
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
  padding: 0 clamp(8px, 2vw, 24px);
  flex-wrap: wrap;
}

.add-col-form input {
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 10px 14px;
  color: #e2e8f0;
  font-size: 0.875rem;
  flex: 1;
  min-width: 0;
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
  font-size: 0.875rem;
  font-weight: 600;
  white-space: nowrap;
  transition: background 0.15s;
}

.add-col-form button:hover { background: #475569; }

/* ── Select mode button ───────────────────────────── */

.select-mode-btn {
  background: #334155;
  border: 1px solid #475569;
  border-radius: 6px;
  color: #94a3b8;
  padding: 6px 14px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
  min-height: 44px;
}
.select-mode-btn:hover { background: #475569; color: #e2e8f0; }

/* ── Card selection checkbox ─────────────────────── */

.card-select-checkbox {
  background: none;
  border: none;
  font-size: 1.2rem;
  color: #64748b;
  cursor: pointer;
  padding: 4px;
  min-width: 44px;
  min-height: 44px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  line-height: 1;
}
.card--selected { border-color: #6366f1; background: #1e1b4b; }
.card--selected .card-select-checkbox { color: #818cf8; }

/* ── Action sheet ────────────────────────────────── */

.action-sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 200;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
}

.action-sheet {
  background: #1e293b;
  border-radius: 16px 16px 0 0;
  padding: 16px;
  width: 100%;
  max-width: 400px;
  max-height: 80vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* Slide up animation */
  animation: sheet-slide-up 200ms cubic-bezier(0.2, 0, 0, 1);
}
@keyframes sheet-slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.action-sheet-header {
  padding: 4px 0 8px;
  border-bottom: 1px solid #334155;
  margin-bottom: 4px;
}
.action-sheet-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: #e2e8f0;
  word-break: break-word;
}

.action-sheet-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.action-sheet-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748b;
  padding: 4px 0;
}

.action-sheet-btn {
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 8px;
  color: #e2e8f0;
  padding: 12px 16px;
  font-size: 0.9rem;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
  min-height: 44px;
}
.action-sheet-btn:hover { background: #1e293b; border-color: #475569; }
.action-sheet-btn--danger { color: #f87171; }
.action-sheet-btn--danger:hover { background: #1c1917; border-color: #991b1b; }
.action-sheet-btn--cancel {
  background: #334155;
  border-color: #475569;
  text-align: center;
  font-weight: 600;
  margin-top: 4px;
}
.action-sheet-btn--cancel:hover { background: #475569; }

/* ── Selection bar (bottom action bar) ───────────── */

.selection-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: #1e293b;
  border-top: 1px solid #334155;
  padding: 12px clamp(12px, 4vw, 24px);
  display: flex;
  align-items: center;
  gap: 12px;
  z-index: 150;
  /* Slide up */
  animation: sheet-slide-up 200ms cubic-bezier(0.2, 0, 0, 1);
}
.selection-bar-count {
  font-size: 0.85rem;
  color: #94a3b8;
  white-space: nowrap;
}
.selection-bar-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-left: auto;
  position: relative;
}
.selection-bar-btn {
  background: #334155;
  border: 1px solid #475569;
  border-radius: 6px;
  color: #e2e8f0;
  padding: 8px 14px;
  font-size: 0.85rem;
  cursor: pointer;
  min-height: 44px;
  transition: background 0.15s;
  white-space: nowrap;
}
.selection-bar-btn:hover { background: #475569; }
.selection-bar-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.selection-bar-btn--danger { color: #f87171; border-color: #991b1b; }
.selection-bar-btn--danger:hover { background: #1c1917; }

/* Column picker dropdown above the "Move to…" button */
.column-picker {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 6px;
  background: #1e293b;
  border: 1px solid #475569;
  border-radius: 8px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 160px;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.3);
  z-index: 160;
}
.column-picker-btn {
  background: none;
  border: none;
  color: #e2e8f0;
  padding: 10px 12px;
  font-size: 0.85rem;
  cursor: pointer;
  border-radius: 6px;
  text-align: left;
  transition: background 0.15s;
  min-height: 44px;
}
.column-picker-btn:hover { background: #334155; }

/* Extra bottom padding on board when selection bar is visible */
#board:has(.selection-bar) .columns { padding-bottom: 80px; }

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

          // Touch card tap → open action sheet (server-tracked)
          document.getElementById('app').addEventListener('kanban-card-tap', function(e) {
            var d = e.detail;
            if (!d.cardId) return;
            fetch('${base()}cards/' + d.cardId + '/sheet', { method: 'POST' });
          });

          // Touch column tap → open column action sheet
          document.getElementById('app').addEventListener('kanban-column-tap', function(e) {
            var d = e.detail;
            if (!d.columnId) return;
            fetch('${base()}columns/' + d.columnId + '/sheet', { method: 'POST' });
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
  padding: clamp(12px, 4vw, 24px);
  min-height: 100dvh;
  font-size: 0.875rem;
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
        const ui = getUIState(boardId)
        await stream.writeSSE(dsePatch(selector, <Board board={data.board} columns={data.columns} cards={data.cards} uiState={ui} />, mode, opts))
      }

      const topic = `board:${boardId}:changed`
      const handler = () => pushBoard('#board', 'outer', { useViewTransition: true })
      bus.addEventListener(topic, handler)

      // Also re-push on UI-only changes (action sheet, selection mode)
      const uiTopic = `board:${boardId}:ui`
      const uiHandler = () => pushBoard('#board', 'outer')
      bus.addEventListener(uiTopic, uiHandler)

      stream.onAbort(() => {
        bus.removeEventListener(topic, handler)
        bus.removeEventListener(uiTopic, uiHandler)
      })

      await pushBoard('#app', 'inner')
      while (!stream.closed) { await stream.sleep(30000) }
    })
  }

  const data = await getBoard(boardId)
  const ui = getUIState(boardId)
  return c.html('<!DOCTYPE html>' + (
    <Shell path={`/boards/${boardId}`}>
      {data ? <Board board={data.board} columns={data.columns} cards={data.cards} uiState={ui} /> : <p>Board not found</p>}
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

  const boardId = await boardIdFromCard(cardId)
  if (events.length > 0) {
    await appendEventsWithUndo(events, boardId)
  }
  // Clear editing state after save
  if (boardId) {
    const ui = getUIState(boardId)
    ui.editingCard = null
    // Data change already triggers SSE push if events were appended;
    // if no data changed but we still need to dismiss the form, emit UI
    if (events.length === 0) emitUI(boardId)
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
  if (boardId) {
    const ui = getUIState(boardId)
    if (ui.activeColSheet === columnId) ui.activeColSheet = null
  }
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
  // Clean up UI state referencing this card
  if (boardId) {
    const ui = getUIState(boardId)
    if (ui.activeCardSheet === cardId) ui.activeCardSheet = null
    if (ui.editingCard === cardId) ui.editingCard = null
    ui.selectedCards.delete(cardId)
  }
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

// --- UI state commands (server-tracked, morph-pushed) ---

// Helper: emit UI change event to trigger SSE re-push
function emitUI(boardId) {
  bus.dispatchEvent(new CustomEvent(`board:${boardId}:ui`, { detail: null }))
}

// Action sheet: open for a card (or toggle-select if selection mode is active)
app.post('/cards/:cardId/sheet', async (c) => {
  const cardId = c.req.param('cardId')
  const boardId = await boardIdFromCard(cardId)
  if (!boardId) return c.body(null, 404)
  const ui = getUIState(boardId)
  // In selection mode, tap toggles selection instead of opening sheet
  if (ui.selectionMode) {
    if (ui.selectedCards.has(cardId)) {
      ui.selectedCards.delete(cardId)
    } else {
      ui.selectedCards.add(cardId)
    }
    emitUI(boardId)
    return c.body(null, 204)
  }
  // Toggle: if already open for this card, close it
  ui.activeCardSheet = ui.activeCardSheet === cardId ? null : cardId
  ui.editingCard = null
  emitUI(boardId)
  return c.body(null, 204)
})

// Action sheet: dismiss (card or column)
app.post('/cards/sheet/dismiss', async (c) => {
  for (const [boardId, ui] of boardUIState) {
    if (ui.activeCardSheet) {
      ui.activeCardSheet = null
      emitUI(boardId)
      return c.body(null, 204)
    }
  }
  return c.body(null, 204)
})

// Column sheet: open
app.post('/columns/:columnId/sheet', async (c) => {
  const columnId = c.req.param('columnId')
  const boardId = await boardIdFromColumn(columnId)
  if (!boardId) return c.body(null, 404)
  const ui = getUIState(boardId)
  ui.activeColSheet = ui.activeColSheet === columnId ? null : columnId
  ui.activeCardSheet = null
  ui.editingCard = null
  emitUI(boardId)
  return c.body(null, 204)
})

// Column sheet: dismiss
app.post('/columns/sheet/dismiss', async (c) => {
  for (const [boardId, ui] of boardUIState) {
    if (ui.activeColSheet) {
      ui.activeColSheet = null
      emitUI(boardId)
      return c.body(null, 204)
    }
  }
  return c.body(null, 204)
})

// Column sheet: move left (swap with previous sibling)
app.post('/columns/:columnId/sheet-move-left', async (c) => {
  const columnId = c.req.param('columnId')
  const db = await dbPromise
  const col = await db.get('columns', columnId)
  if (!col) return c.body(null, 404)

  const siblings = (await db.getAllFromIndex('columns', 'byBoard', col.boardId))
    .filter(c => c.id !== columnId)
    .sort(cmpPosition)
  const allCols = (await db.getAllFromIndex('columns', 'byBoard', col.boardId)).sort(cmpPosition)
  const idx = allCols.findIndex(c => c.id === columnId)
  if (idx <= 0) return c.body(null, 204)

  const evt = createEvent('column.moved', {
    id: columnId,
    position: positionForIndex(idx - 1, siblings),
  })
  await appendEventsWithUndo([evt], col.boardId)
  // Dismiss sheet
  const ui = getUIState(col.boardId)
  ui.activeColSheet = null
  return c.body(null, 204)
})

// Column sheet: move right (swap with next sibling)
app.post('/columns/:columnId/sheet-move-right', async (c) => {
  const columnId = c.req.param('columnId')
  const db = await dbPromise
  const col = await db.get('columns', columnId)
  if (!col) return c.body(null, 404)

  const siblings = (await db.getAllFromIndex('columns', 'byBoard', col.boardId))
    .filter(c => c.id !== columnId)
    .sort(cmpPosition)
  const allCols = (await db.getAllFromIndex('columns', 'byBoard', col.boardId)).sort(cmpPosition)
  const idx = allCols.findIndex(c => c.id === columnId)
  if (idx >= allCols.length - 1) return c.body(null, 204)

  const evt = createEvent('column.moved', {
    id: columnId,
    position: positionForIndex(idx + 1, siblings),
  })
  await appendEventsWithUndo([evt], col.boardId)
  // Dismiss sheet
  const ui = getUIState(col.boardId)
  ui.activeColSheet = null
  return c.body(null, 204)
})

// Action sheet: move card to column (from sheet)
app.post('/cards/:cardId/sheet-move/:columnId', async (c) => {
  const cardId = c.req.param('cardId')
  const columnId = c.req.param('columnId')

  const db = await dbPromise
  const card = await db.get('cards', cardId)
  if (!card) return c.body(null, 404)

  // Place at end of target column
  const siblings = (await db.getAllFromIndex('cards', 'byColumn', columnId))
    .sort(cmpPosition)
  const lastPos = siblings.length > 0 ? siblings[siblings.length - 1].position : null

  const boardId = await boardIdFromCard(cardId)
  const evt = createEvent('card.moved', {
    id: cardId,
    columnId,
    position: generateKeyBetween(lastPos, null),
  })
  await appendEventsWithUndo([evt], boardId)

  // Dismiss sheet
  if (boardId) {
    const ui = getUIState(boardId)
    ui.activeCardSheet = null
    // Data change already triggers SSE push via bus, no need for emitUI
  }
  return c.body(null, 204)
})

// Edit card (server-tracked): toggle inline edit form
app.post('/cards/:cardId/edit', async (c) => {
  const cardId = c.req.param('cardId')
  const boardId = await boardIdFromCard(cardId)
  if (!boardId) return c.body(null, 404)
  const ui = getUIState(boardId)
  ui.editingCard = ui.editingCard === cardId ? null : cardId
  ui.activeCardSheet = null
  emitUI(boardId)
  return c.body(null, 204)
})

// Edit card: cancel
app.post('/cards/:cardId/edit-cancel', async (c) => {
  const cardId = c.req.param('cardId')
  const boardId = await boardIdFromCard(cardId)
  if (!boardId) return c.body(null, 404)
  const ui = getUIState(boardId)
  ui.editingCard = null
  emitUI(boardId)
  return c.body(null, 204)
})

// Selection mode: enter
app.post('/boards/:boardId/select-mode', async (c) => {
  const boardId = c.req.param('boardId')
  const ui = getUIState(boardId)
  ui.selectionMode = true
  ui.selectedCards.clear()
  ui.activeCardSheet = null
  ui.editingCard = null
  emitUI(boardId)
  return c.body(null, 204)
})

// Selection mode: cancel
app.post('/boards/:boardId/select-mode/cancel', async (c) => {
  const boardId = c.req.param('boardId')
  const ui = getUIState(boardId)
  ui.selectionMode = false
  ui.selectedCards.clear()
  emitUI(boardId)
  return c.body(null, 204)
})

// Selection mode: toggle card selection
app.post('/cards/:cardId/toggle-select', async (c) => {
  const cardId = c.req.param('cardId')
  const boardId = await boardIdFromCard(cardId)
  if (!boardId) return c.body(null, 404)
  const ui = getUIState(boardId)
  if (ui.selectedCards.has(cardId)) {
    ui.selectedCards.delete(cardId)
  } else {
    ui.selectedCards.add(cardId)
  }
  emitUI(boardId)
  return c.body(null, 204)
})

// Batch move: move all selected cards to target column
app.post('/boards/:boardId/batch-move/:columnId', async (c) => {
  const boardId = c.req.param('boardId')
  const columnId = c.req.param('columnId')
  const ui = getUIState(boardId)

  if (ui.selectedCards.size === 0) return c.body(null, 204)

  const db = await dbPromise
  // Get existing cards in target column to place after them
  const existing = (await db.getAllFromIndex('cards', 'byColumn', columnId))
    .sort(cmpPosition)
  const lastPos = existing.length > 0 ? existing[existing.length - 1].position : null

  // Generate positions for all selected cards
  const cardIds = [...ui.selectedCards]
  const positions = generateNKeysBetween(lastPos, null, cardIds.length)
  const correlationId = crypto.randomUUID()

  const events = cardIds.map((cardId, i) =>
    createEvent('card.moved', {
      id: cardId,
      columnId,
      position: positions[i],
    }, { correlationId })
  )

  await appendEventsWithUndo(events, boardId)
  // Exit selection mode
  ui.selectionMode = false
  ui.selectedCards.clear()
  // Data change triggers SSE push
  return c.body(null, 204)
})

// Batch delete: delete all selected cards
app.post('/boards/:boardId/batch-delete', async (c) => {
  const boardId = c.req.param('boardId')
  const ui = getUIState(boardId)

  if (ui.selectedCards.size === 0) return c.body(null, 204)

  const correlationId = crypto.randomUUID()
  const events = [...ui.selectedCards].map(cardId =>
    createEvent('card.deleted', { id: cardId }, { correlationId })
  )

  await appendEventsWithUndo(events, boardId)
  // Exit selection mode
  ui.selectionMode = false
  ui.selectedCards.clear()
  // Data change triggers SSE push
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
