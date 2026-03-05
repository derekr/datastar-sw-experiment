/** @jsxImportSource hono/jsx */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { openDB } from 'idb'
import { raw } from 'hono/html'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
// eg-kanban.js and stellar.css are bundled through Vite with content hashes.
// Referenced via __KANBAN_JS__ and __STELLAR_CSS__ globals (injected by vite-plugin-sw.js).
// Not imported here because Safari's SW fetch handler doesn't reliably
// intercept <script src> subresource requests on SW-served pages.

// Base path derived from SW scope — '/' locally, '/repo-name/' on GitHub Pages.
// Lazy-init because self.registration isn't available at module parse time.
let _base
function base() {
  if (!_base) _base = new URL(self.registration.scope).pathname
  return _base
}

// --- Compression helpers (board sharing) ---

// Max decompressed size: 2 MB (prevents zip bombs)
const MAX_DECOMPRESS_BYTES = 2 * 1024 * 1024
// Max events per import
const MAX_IMPORT_EVENTS = 5000

function mergeChunks(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { merged.set(c, offset); offset += c.length }
  return merged
}

// Uint8Array → base64url (chunked to avoid call stack overflow)
function uint8ToBase64url(buf) {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function compressToBase64url(jsonStr) {
  const buf = new TextEncoder().encode(jsonStr)
  const cs = new CompressionStream('deflate')
  const writer = cs.writable.getWriter()
  writer.write(buf)
  writer.close()
  const chunks = []
  const reader = cs.readable.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return uint8ToBase64url(mergeChunks(chunks))
}

async function decompressFromBase64url(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - b64url.length % 4) % 4)
  const bin = atob(b64)
  const buf = Uint8Array.from(bin, c => c.charCodeAt(0))
  const ds = new DecompressionStream('deflate')
  const writer = ds.writable.getWriter()
  writer.write(buf)
  writer.close()
  const chunks = []
  let totalBytes = 0
  const reader = ds.readable.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.length
    if (totalBytes > MAX_DECOMPRESS_BYTES) {
      throw new Error('Decompressed data exceeds size limit')
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(mergeChunks(chunks))
}

// --- Event Sourcing ---

// Event schema versions. Bump when event shape changes.
const EVENT_VERSIONS = {
  'board.created': 1,
  'board.titleUpdated': 1,
  'board.deleted': 1,
  'column.created': 2,
  'column.deleted': 1,
  'column.moved': 1,
  'card.created': 1,
  'card.moved': 1,
  'card.deleted': 1,
  'card.titleUpdated': 1,
  'card.descriptionUpdated': 1,
  'card.labelUpdated': 1,
}

// Allowed event types for import validation
const ALLOWED_EVENT_TYPES = new Set(Object.keys(EVENT_VERSIONS))

const LABEL_COLORS = {
  red: 'var(--error-7)',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  blue: 'var(--primary-9)',
  purple: '#8b5cf6',
  pink: '#ec4899',
}

// --- Board templates ---
// Templates are pre-defined event arrays. On first access, they're compressed
// to base64url hash fragments so the existing import flow handles everything.

function templateEvent(type, data) {
  return { id: crypto.randomUUID(), type, v: EVENT_VERSIONS[type], data, ts: Date.now(), synced: false, correlationId: null, causationId: null, actorId: null }
}

function buildTemplateEvents(title, columns) {
  const boardId = 'tpl-board'
  const events = [templateEvent('board.created', { id: boardId, title, createdAt: Date.now() })]
  for (const col of columns) {
    const colId = `tpl-col-${col.title.toLowerCase().replace(/\s+/g, '-')}`
    events.push(templateEvent('column.created', { id: colId, title: col.title, position: col.position, boardId }))
    if (col.cards) {
      for (const card of col.cards) {
        const cardId = `tpl-card-${crypto.randomUUID().slice(0, 8)}`
        events.push(templateEvent('card.created', { id: cardId, columnId: colId, title: card.title, position: card.position }))
        if (card.description) {
          events.push(templateEvent('card.descriptionUpdated', { id: cardId, description: card.description }))
        }
        if (card.label) {
          events.push(templateEvent('card.labelUpdated', { id: cardId, label: card.label }))
        }
      }
    }
  }
  return events
}

const BOARD_TEMPLATES = [
  {
    id: 'kanban',
    title: 'Kanban',
    description: 'To Do / In Progress / Done',
    events: () => buildTemplateEvents('Kanban', [
      { title: 'To Do', position: 'a0', cards: [
        { title: 'Define project scope', position: 'a0', label: 'blue' },
        { title: 'Research competitors', position: 'a1' },
        { title: 'Draft initial wireframes', position: 'a2', label: 'purple' },
      ]},
      { title: 'In Progress', position: 'a1', cards: [
        { title: 'Set up dev environment', position: 'a0', label: 'green' },
      ]},
      { title: 'Done', position: 'a2', cards: [] },
    ]),
  },
  {
    id: 'sprint',
    title: 'Sprint Board',
    description: 'Backlog / Sprint / In Review / Done',
    events: () => buildTemplateEvents('Sprint Board', [
      { title: 'Backlog', position: 'a0', cards: [
        { title: 'User authentication', position: 'a0', label: 'red', description: 'OAuth + email/password login' },
        { title: 'Dashboard analytics', position: 'a1', label: 'blue' },
        { title: 'Export to CSV', position: 'a2' },
      ]},
      { title: 'Sprint', position: 'a1', cards: [
        { title: 'API rate limiting', position: 'a0', label: 'orange' },
        { title: 'Fix pagination bug', position: 'a1', label: 'red' },
      ]},
      { title: 'In Review', position: 'a2', cards: [] },
      { title: 'Done', position: 'a3', cards: [] },
    ]),
  },
  {
    id: 'personal',
    title: 'Personal',
    description: 'Today / This Week / Later / Done',
    events: () => buildTemplateEvents('Personal', [
      { title: 'Today', position: 'a0', cards: [
        { title: 'Morning workout', position: 'a0', label: 'green' },
        { title: 'Grocery shopping', position: 'a1' },
      ]},
      { title: 'This Week', position: 'a1', cards: [
        { title: 'Schedule dentist', position: 'a0', label: 'yellow' },
        { title: 'Read chapter 5', position: 'a1', label: 'purple' },
      ]},
      { title: 'Later', position: 'a2', cards: [
        { title: 'Plan weekend trip', position: 'a0', label: 'blue' },
      ]},
      { title: 'Done', position: 'a3', cards: [] },
    ]),
  },
  {
    id: 'project',
    title: 'Project Tracker',
    description: 'Ideas / Planning / Active / Shipped',
    events: () => buildTemplateEvents('Project Tracker', [
      { title: 'Ideas', position: 'a0', cards: [
        { title: 'Mobile app redesign', position: 'a0', label: 'purple' },
        { title: 'Public API', position: 'a1', label: 'blue' },
      ]},
      { title: 'Planning', position: 'a1', cards: [
        { title: 'v2.0 launch', position: 'a0', label: 'orange', description: 'Target Q2 — new onboarding flow + perf improvements' },
      ]},
      { title: 'Active', position: 'a2', cards: [] },
      { title: 'Shipped', position: 'a3', cards: [] },
    ]),
  },
]

// Cache compressed template hashes (computed on first access)
const _templateHashCache = new Map()
async function getTemplateHash(tpl) {
  if (!_templateHashCache.has(tpl.id)) {
    const events = tpl.events()
    const hash = await compressToBase64url(JSON.stringify(events))
    _templateHashCache.set(tpl.id, hash)
  }
  return _templateHashCache.get(tpl.id)
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

    case 'board.titleUpdated': {
      const board = await tx.objectStore('boards').get(data.id)
      if (!board) break
      await tx.objectStore('boards').put({ ...board, title: data.title })
      break
    }

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

    case 'card.labelUpdated': {
      const store = tx.objectStore('cards')
      const card = await store.get(data.id)
      if (!card) break
      await store.put({ ...card, label: data.label })
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

// Annotate events with _boardId for filtering in the event log viewer.
// Uses a read-only transaction to resolve card → column → board relationships.
async function annotateEventsWithBoardId(events) {
  const db = await dbPromise
  const tx = db.transaction(ALL_STORES, 'readonly')
  const annotated = []
  for (const evt of events) {
    const boardId = await boardIdForEvent(evt, tx)
    annotated.push(boardId ? { ...evt, _boardId: boardId } : evt)
  }
  return annotated
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

      case 'card.labelUpdated': {
        const card = await db.get('cards', data.id)
        if (card) {
          undoEvents.push({ type: 'card.labelUpdated', data: { id: data.id, label: card.label || null } })
          redoEvents.push({ type: 'card.labelUpdated', data: { ...data } })
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

      case 'board.titleUpdated': {
        const board = await db.get('boards', data.id)
        if (board) {
          undoEvents.push({ type: 'board.titleUpdated', data: { id: data.id, title: board.title } })
          redoEvents.push({ type: 'board.titleUpdated', data: { ...data } })
        }
        break
      }

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

const boardUIState = new Map()

function getUIState(boardId) {
  if (!boardUIState.has(boardId)) {
    boardUIState.set(boardId, {
      activeCardSheet: null,   // card ID whose action sheet is open, or null
      activeColSheet: null,    // column ID whose action sheet is open, or null
      selectionMode: false,    // whether selection mode is active
      selectedCards: new Set(), // set of selected card IDs
      editingCard: null,       // card ID being edited inline, or null
      editingBoardTitle: false, // whether the board title is being edited inline
      timeTravelEvents: null,  // array of { seq, type, data, ts } for this board, or null
      timeTravelPos: -1,       // current position in timeTravelEvents (-1 = not active)
      showHelp: false,         // whether keyboard shortcut help overlay is visible
      highlightCard: null,     // card ID to highlight (scroll-into-view + pulse), or null
    })
  }
  return boardUIState.get(boardId)
}

// ── Global UI state (not per-board) ──────────────────────────────────────────
// Command menu lives here so it works on any page (boards list or board detail).

const globalUIState = {
  commandMenu: null,  // { query, results, context } or null when closed
}

function emitGlobalUI() {
  bus.dispatchEvent(new CustomEvent('global:ui'))
}

function clearUIState(boardId) {
  const ui = getUIState(boardId)
  ui.activeCardSheet = null
  ui.activeColSheet = null
  ui.selectionMode = false
  ui.selectedCards.clear()
  ui.editingCard = null
  ui.editingBoardTitle = false
  ui.timeTravelEvents = null
  ui.timeTravelPos = -1
}

// ── Time travel: in-memory replay ────────────────────────────────────────────

// Fake IDB transaction backed by Maps — allows reusing applyEvent for replay.
function createMemoryTx() {
  const stores = { boards: new Map(), columns: new Map(), cards: new Map() }
  function makeStore(map, indexes) {
    const s = {
      get(key) { return map.get(key) },
      put(obj) { map.set(obj.id, obj) },
      delete(key) { map.delete(key) },
      getAll() { return [...map.values()] },
      getAllKeys() { return [...map.keys()] },
      clear() { map.clear() },
      index(name) {
        const fn = indexes[name]
        return { getAll(key) { return [...map.values()].filter(v => fn(v) === key) } }
      },
    }
    return s
  }
  const txStores = {
    boards: makeStore(stores.boards, {}),
    columns: makeStore(stores.columns, { byBoard: c => c.boardId }),
    cards: makeStore(stores.cards, { byColumn: c => c.columnId }),
    events: { put() {} }, // no-op: don't persist upcasts during replay
  }
  return {
    objectStore(name) { return txStores[name] },
    stores,
  }
}

// Replay events up to position idx in the given event list.
// Returns { board, columns, cards } for the specified boardId, or null.
async function replayToPosition(events, idx, boardId) {
  const memTx = createMemoryTx()
  for (let i = 0; i <= idx && i < events.length; i++) {
    await applyEvent(events[i], memTx)
  }
  const { stores } = memTx
  const board = stores.boards.get(boardId)
  if (!board) return null
  const columns = [...stores.columns.values()]
    .filter(c => c.boardId === boardId)
    .sort((a, b) => (a.position || '').localeCompare(b.position || ''))
  const cards = [...stores.cards.values()]
    .filter(c => columns.some(col => col.id === c.columnId))
    .sort((a, b) => (a.position || '').localeCompare(b.position || ''))
  return { board, columns, cards }
}

// Load all events and identify which ones affect the given board.
// Returns the full event array (for replay) and a filtered array of
// { idx, seq, type, summary, ts } entries for the scrubber.
async function loadTimeTravelEvents(boardId) {
  const db = await dbPromise
  const allEvents = await db.getAll('events')
  // Replay all events, tracking which indices affect this board
  const memTx = createMemoryTx()
  const boardEvents = []
  for (let i = 0; i < allEvents.length; i++) {
    const event = upcast(allEvents[i])
    // Resolve board BEFORE applying (same as appendEvents)
    const evtBoardId = await boardIdForEvent(event, memTx)
    await applyEvent(event, memTx)
    if (evtBoardId === boardId) {
      boardEvents.push({
        idx: i,
        seq: event.seq,
        type: event.type,
        ts: event.ts,
      })
    }
  }
  return { allEvents: allEvents.map(e => upcast(e)), boardEvents }
}

// Load events scoped to a single card (for card detail history)
async function loadCardEvents(cardId) {
  const db = await dbPromise
  const allEvents = await db.getAll('events')
  const CARD_EVENT_TYPES = new Set([
    'card.created', 'card.moved', 'card.deleted',
    'card.titleUpdated', 'card.descriptionUpdated', 'card.labelUpdated',
  ])
  const cardEvents = []
  for (const event of allEvents) {
    const e = upcast(event)
    if (CARD_EVENT_TYPES.has(e.type) && e.data?.id === cardId) {
      cardEvents.push({ type: e.type, ts: e.ts, data: e.data })
    }
  }
  return cardEvents
}

// ── Per-board tab presence (via clients API) ─────────────────────────────────
async function getTabCount(boardId) {
  const clients = await self.clients.matchAll({ type: 'window' })
  const boardPath = `${base()}boards/${boardId}`
  return clients.filter(c => new URL(c.url).pathname === boardPath).length
}

// Debounced UI push after connection changes settle
const boardConnDebounce = new Map()
function notifyTabChange(boardId) {
  clearTimeout(boardConnDebounce.get(boardId))
  boardConnDebounce.set(boardId, setTimeout(() => {
    boardConnDebounce.delete(boardId)
    bus.dispatchEvent(new CustomEvent(`board:${boardId}:ui`))
  }, 300))
}

// Push UI update to all active boards when connection status changes
function notifyConnectionChange() {
  for (const boardId of boardUIState.keys()) {
    bus.dispatchEvent(new CustomEvent(`board:${boardId}:ui`))
  }
}
self.addEventListener('online', notifyConnectionChange)
self.addEventListener('offline', notifyConnectionChange)

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

async function getConnectionStatus() {
  const db = await dbPromise
  const isOnline = navigator.onLine
  const config = await db.get('meta', 's2Config')
  const hasSyncConfig = !!config?.value
  // All events are unsynced until sync is implemented (synced field is boolean,
  // not a valid IDB key type, so bySynced index doesn't work — just count all)
  const unsyncedCount = await db.count('events')
  return { isOnline, hasSyncConfig, unsyncedCount }
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

function LabelPicker({ cardId, currentLabel }) {
  const swatches = Object.entries(LABEL_COLORS).map(([name, color]) => {
    const target = currentLabel === name ? 'none' : name
    return (
      <button
        type="button"
        class={`label-swatch${currentLabel === name ? ' label-swatch--active' : ''}`}
        style={`--swatch-color: ${color}`}
        data-on:click={`@post('${base()}cards/${cardId}/label/${target}')`}
        title={name}
      >{' '}</button>
    )
  })
  return (
    <div class="label-picker">
      <span class="label-picker-label">Label</span>
      <div class="label-picker-swatches">
        {swatches}
        {currentLabel && (
          <button
            type="button"
            class="label-swatch-clear"
            data-on:click={`@post('${base()}cards/${cardId}/label/none')`}
            title="Remove label"
          >×</button>
        )}
      </div>
    </div>
  )
}

function Card({ card, uiState, boardId }) {
  const desc = card.description || ''
  const label = card.label || null
  const isReadOnly = uiState?.timeTravelPos >= 0
  const isEditing = !isReadOnly && uiState?.editingCard === card.id
  const isSelecting = !isReadOnly && uiState?.selectionMode
  const isSelected = uiState?.selectedCards?.has(card.id)
  const isHighlighted = uiState?.highlightCard === card.id

  return (
    <div
      class={`card${isSelected ? ' card--selected' : ''}${label ? ' card--labeled' : ''}${isHighlighted ? ' card--highlighted' : ''}`}
      id={`card-${card.id}`}
      data-card-id={card.id}
      tabindex="0"
      style={label ? `border-top: 3px solid ${LABEL_COLORS[label] || 'var(--neutral-7)'}` : ''}
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
      {!isSelecting && !isReadOnly && (
        <div class="card-actions">
          <button
            class="card-edit-btn"
            data-on:click={`@post('${base()}cards/${card.id}/edit')`}
            title="Edit"
          >&#9998;</button>
          {boardId && (
            <a
              class="card-expand-btn"
              href={`${base()}boards/${boardId}/cards/${card.id}`}
              title="Open"
            >&#x2197;</a>
          )}
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
          <LabelPicker cardId={card.id} currentLabel={label} />
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
          <span class="action-sheet-label">Label</span>
          <div class="action-sheet-swatches">
            {Object.entries(LABEL_COLORS).map(([name, color]) => {
              const target = card.label === name ? 'none' : name
              return (
                <button
                  class={`label-swatch label-swatch--lg${card.label === name ? ' label-swatch--active' : ''}`}
                  style={`--swatch-color: ${color}`}
                  data-on:click={`@post('${base()}cards/${card.id}/label/${target}')`}
                  title={name}
                >{' '}</button>
              )
            })}
            {card.label && (
              <button
                class="label-swatch-clear"
                data-on:click={`@post('${base()}cards/${card.id}/label/none')`}
                title="Remove label"
              >×</button>
            )}
          </div>
        </div>
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

function Column({ col, cards, columnCount, uiState, columns, boardId }) {
  const colCards = cards
    .filter(c => c.columnId === col.id)
    .sort(cmpPosition)
  const isReadOnly = uiState?.timeTravelPos >= 0

  return (
    <div
      class="column"
      id={`column-${col.id}`}
      style={`view-transition-name: col-${col.id}; view-transition-class: col`}
    >
      <div class="column-header" tabindex="0">
        <h2>{col.title}</h2>
        <span class="count">{colCards.length}</span>
        {!isReadOnly && columnCount > 1 && (
          <button
            class="col-delete-btn"
            data-on:click__viewtransition={`@delete('${base()}columns/${col.id}')`}
          >×</button>
        )}
      </div>
      <div class="cards-container" data-column-id={col.id}>
        {colCards.length === 0
          ? <p class="empty">No cards yet</p>
          : colCards.map(card => <Card card={card} uiState={uiState} boardId={boardId} />)}
      </div>
      {!isReadOnly && !uiState?.selectionMode && (
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

function eventLabel(type) {
  const labels = {
    'board.created': 'Board created',
    'board.titleUpdated': 'Title renamed',
    'board.deleted': 'Board deleted',
    'column.created': 'Column added',
    'column.deleted': 'Column deleted',
    'column.moved': 'Column moved',
    'card.created': 'Card added',
    'card.moved': 'Card moved',
    'card.deleted': 'Card deleted',
    'card.titleUpdated': 'Card renamed',
    'card.descriptionUpdated': 'Description edited',
    'card.labelUpdated': 'Label changed',
  }
  return labels[type] || type
}

function TimeTravelBar({ boardId, events, pos }) {
  const current = events[pos]
  const ts = current ? new Date(current.ts).toLocaleTimeString() : ''
  const seekUrl = `${base()}boards/${boardId}/time-travel/seek`
  return (
    <div id="time-travel-bar" class="time-travel-bar">
      <div class="tt-header">
        <span class="tt-label">History</span>
        <span id="tt-info" class="tt-info">
          {current ? `${eventLabel(current.type)} — ${ts}` : 'No events'}
        </span>
        <button
          id="tt-exit"
          class="tt-exit"
          data-on:click={`@post('${base()}boards/${boardId}/time-travel/exit')`}
        >Exit</button>
      </div>
      <div id="tt-form" class="tt-controls">
        <button
          id="tt-prev"
          type="button"
          class="tt-step"
          disabled={pos <= 0}
          data-on:click={`fetch('${seekUrl}', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'position=${pos - 1}'})`}
        >&larr;</button>
        <input
          id="tt-slider"
          type="range"
          min="0"
          max={String(events.length - 1)}
          value={String(pos)}
          data-on:input__debounce_100ms={`fetch('${seekUrl}', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'position='+evt.target.value})`}
        />
        <button
          id="tt-next"
          type="button"
          class="tt-step"
          disabled={pos >= events.length - 1}
          data-on:click={`fetch('${seekUrl}', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'position=${pos + 1}'})`}
        >&rarr;</button>
        <span id="tt-counter" class="tt-counter">{pos + 1} / {events.length}</span>
      </div>
    </div>
  )
}

function HelpOverlay({ boardId }) {
  return (
    <div id="help-overlay" class="help-overlay-backdrop" data-on:click={`@post('${base()}boards/${boardId}/help-dismiss')`}>
      <div class="help-overlay" data-on:click__stop="void 0">
        <div class="help-overlay-header">
          <span class="help-overlay-title">Keyboard shortcuts</span>
          <button class="help-overlay-close" data-on:click={`@post('${base()}boards/${boardId}/help-dismiss')`}>×</button>
        </div>
        <div class="help-overlay-body">
          <div class="help-section">
            <h3 class="help-section-title">Navigate</h3>
            <div class="help-row"><kbd>{'↑ ↓ ← →'}</kbd><span>Move focus between cards</span></div>
            <div class="help-row"><kbd>h j k l</kbd><span>Vim-style navigation</span></div>
          </div>
          <div class="help-section">
            <h3 class="help-section-title">Move items</h3>
            <div class="help-row"><kbd>{'Ctrl + ↑ ↓ ← →'}</kbd><span>Move card or column</span></div>
            <div class="help-row"><kbd>Ctrl + h j k l</kbd><span>Vim-style move</span></div>
          </div>
          <div class="help-section">
            <h3 class="help-section-title">Actions</h3>
            <div class="help-row"><kbd>Ctrl + Z</kbd><span>Undo</span></div>
            <div class="help-row"><kbd>Ctrl + Shift + Z</kbd><span>Redo</span></div>
            <div class="help-row"><kbd>{'\u2318'}K</kbd><span>Command menu</span></div>
            <div class="help-row"><kbd>Escape</kbd><span>Cancel drag / close overlay</span></div>
            <div class="help-row"><kbd>?</kbd><span>Toggle this help</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}

function CommandMenu({ query, results }) {
  // Group results by their group header
  const groups = []
  let currentGroup = null
  for (const r of results) {
    if (!currentGroup || currentGroup.name !== r.group) {
      currentGroup = { name: r.group, items: [] }
      groups.push(currentGroup)
    }
    currentGroup.items.push(r)
  }

  // Build click handler per result type
  function clickHandler(r) {
    // Card: close menu + navigate to card detail route
    if (r.type === 'card') {
      return `fetch('${base()}command-menu/close',{method:'POST'}).then(function(){window.location.href='${base()}boards/${r.boardId}/cards/${r.id}'})`
    }
    // Popup: close menu + open in new window
    if (r.popupUrl) {
      return `fetch('${base()}command-menu/close',{method:'POST'}).then(function(){window.open('${r.popupUrl}','${r.popupName || '_blank'}','width=720,height=640')})`
    }
    // Inline JS action: close menu + run arbitrary JS
    if (r.jsAction) {
      return `fetch('${base()}command-menu/close',{method:'POST'}).then(function(){${r.jsAction}})`
    }
    // Board navigation
    if (r.href) {
      return `fetch('${base()}command-menu/close',{method:'POST'}).then(function(){window.location.href='${r.href}'})`
    }
    // Action: close menu + execute
    if (r.actionUrl) {
      return `fetch('${base()}command-menu/close',{method:'POST'}); fetch('${r.actionUrl}',{method:'POST'})`
    }
    return `@post('${base()}command-menu/close')`
  }

  const TYPE_ICONS = { action: '\u26A1', board: '\u25A1', card: '\uD83C\uDFF7', column: '\u2630' }

  let flatIdx = 0
  return (
    <div id="command-menu" class="command-menu-backdrop" data-on:click={`if(window.revertTheme)revertTheme();@post('${base()}command-menu/close')`}>
      <div class="command-menu-panel" data-on:click__stop="void 0" data-signals={`{cmdIdx: 0, cmdCount: ${results.length}}`}>
        <form id="command-menu-form" data-on:submit__prevent="void 0">
          <div class="command-menu-input-wrap">
            <span class="command-menu-icon">{'\u2315'}</span>
            <input
              id="command-menu-input"
              class="command-menu-input"
              type="text"
              placeholder="Search boards, cards, actions..."
              value={query}
              autocomplete="off"
              data-on:input__debounce_150ms={`$cmdIdx = 0; @post('${base()}command-menu/search', {contentType: 'form'})`}
              data-on:keydown={`
                if (event.key === 'ArrowDown') { event.preventDefault(); $cmdIdx = ($cmdIdx + 1) % $cmdCount; requestAnimationFrame(function(){var a=document.querySelector('.command-menu-result--active');if(a&&a.dataset.themePreview&&window.previewTheme)previewTheme(a.dataset.themePreview)}); }
                else if (event.key === 'ArrowUp') { event.preventDefault(); $cmdIdx = ($cmdIdx - 1 + $cmdCount) % $cmdCount; requestAnimationFrame(function(){var a=document.querySelector('.command-menu-result--active');if(a&&a.dataset.themePreview&&window.previewTheme)previewTheme(a.dataset.themePreview)}); }
                else if (event.key === 'Enter') { event.preventDefault(); var a = document.querySelector('.command-menu-result--active'); if (a) a.click(); }
                else if (event.key === 'Escape') { event.preventDefault(); if(window.revertTheme)revertTheme(); @post('${base()}command-menu/close'); }
              `}
              name="query"
            />
          </div>
        </form>
        {results.length > 0 ? (
          <div class="command-menu-results">
            {groups.map(g => {
              const section = (
                <div class="command-menu-section" key={g.name}>
                  <div class="command-menu-section-header">{g.name}</div>
                  <ul class="command-menu-section-list">
                    {g.items.map(r => {
                      const idx = flatIdx++
                      return (
                        <li
                          class="command-menu-result"
                          data-class={`{'command-menu-result--active': $cmdIdx === ${idx}}`}
                          data-on:click={clickHandler(r)}
                          {...(r.themeId ? { 'data-theme-preview': r.themeId, 'data-on:mouseenter': `if(window.previewTheme)previewTheme('${r.themeId}')` } : {})}
                        >
                          <span class="command-menu-result-title">
                            <span class="command-menu-type-icon">{TYPE_ICONS[r.type] || ''}</span>
                            {r.type === 'card' && r.label && <span class="command-menu-label-dot" style={`background: ${LABEL_COLORS[r.label] || 'var(--neutral-7)'}`}>{' '}</span>}
                            {r.title}
                          </span>
                          <span class="command-menu-result-sub">{r.subtitle || ''}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
              return section
            })}
          </div>
        ) : query ? (
          <div class="command-menu-empty">No results found</div>
        ) : (
          <div class="command-menu-hint">Type to search across all boards and cards</div>
        )}
      </div>
    </div>
  )
}

function StatusChip({ isOnline, unsyncedCount, hasSyncConfig }) {
  if (!isOnline) {
    return <span id="status-chip" class="status-chip status-chip--offline" title="No network connection">Offline</span>
  }
  if (!hasSyncConfig) {
    return <span id="status-chip" class="status-chip status-chip--local" title={`${unsyncedCount} event${unsyncedCount !== 1 ? 's' : ''} stored locally`}>Local</span>
  }
  if (unsyncedCount > 0) {
    return <span id="status-chip" class="status-chip status-chip--pending" title={`${unsyncedCount} event${unsyncedCount !== 1 ? 's' : ''} pending sync`}>{unsyncedCount} pending</span>
  }
  return <span id="status-chip" class="status-chip status-chip--synced" title="All events synced">Synced</span>
}

function Board({ board, columns, cards, uiState, tabCount, connStatus, commandMenu }) {
  const isTimeTraveling = uiState?.timeTravelPos >= 0
  const isSelecting = !isTimeTraveling && uiState?.selectionMode
  const isEditingTitle = !isTimeTraveling && uiState?.editingBoardTitle
  const selectedCount = uiState?.selectedCards?.size || 0
  const sheetCard = !isTimeTraveling && uiState?.activeCardSheet
    ? cards.find(c => c.id === uiState.activeCardSheet) || null
    : null
  const sheetColIndex = !isTimeTraveling && uiState?.activeColSheet
    ? columns.findIndex(c => c.id === uiState.activeColSheet)
    : -1
  const sheetCol = sheetColIndex >= 0 ? columns[sheetColIndex] : null
  return (
    <div id="board" class={isTimeTraveling ? 'board--time-travel' : ''}>
      <div id="board-header" class="board-header">
        <a id="board-back" href={base()} class="back-link">← Boards</a>
        {isEditingTitle
          ? <form
              id="board-title-form"
              class="board-title-form"
              data-on:submit__prevent={`@put('${base()}boards/${board.id}', {contentType: 'form'})`}
            >
              <input id="board-title-input" name="title" type="text" value={board.title} autocomplete="off" />
              <button type="submit" class="board-title-save">Save</button>
              <button type="button" class="board-title-cancel" data-on:click={`@post('${base()}boards/${board.id}/title-edit-cancel')`}>Cancel</button>
            </form>
          : <h1 id="board-title" class={isTimeTraveling ? '' : 'board-title-editable'} {...(!isTimeTraveling ? { 'data-on:click': `@post('${base()}boards/${board.id}/title-edit')` } : {})}>{board.title}</h1>
        }
        <span id="tab-count" class={`tab-count${tabCount > 1 ? '' : ' tab-count--hidden'}`} title={`${tabCount} tabs viewing this board`}>{tabCount > 1 ? `${tabCount} tabs` : ''}</span>
        {connStatus && <StatusChip isOnline={connStatus.isOnline} unsyncedCount={connStatus.unsyncedCount} hasSyncConfig={connStatus.hasSyncConfig} />}
        {!isSelecting && !isTimeTraveling && (
          <button
            id="select-mode-btn"
            class="select-mode-btn"
            data-on:click={`@post('${base()}boards/${board.id}/select-mode')`}
          >Select</button>
        )}
        {!isTimeTraveling && (
          <button
            id="time-travel-btn"
            class="select-mode-btn"
            data-on:click={`@post('${base()}boards/${board.id}/time-travel')`}
          >History</button>
        )}
        {!isSelecting && !isTimeTraveling && (
          <button
            id="share-btn"
            class="select-mode-btn"
            data-on:click={`
              fetch('${base()}boards/${board.id}/share', {method:'POST'})
                .then(r => r.json())
                .then(d => {
                  var url = location.origin + d.shareUrl;
                  navigator.clipboard.writeText(url).then(function() {
                    var btn = document.getElementById('share-btn');
                    if (btn) { btn.textContent = 'Copied!'; setTimeout(function(){ btn.textContent = 'Share'; }, 2000); }
                  });
                })
            `}
          >Share</button>
        )}
      </div>
      {isTimeTraveling && (
        <TimeTravelBar boardId={board.id} events={uiState.timeTravelEvents} pos={uiState.timeTravelPos} />
      )}
      <div class="columns">
        {columns.map(col => (
          <Column col={col} cards={cards} columnCount={columns.length} uiState={uiState} columns={columns} boardId={board.id} />
        ))}
      </div>
      {!isSelecting && !isTimeTraveling && (
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
      {uiState?.showHelp && (
        <HelpOverlay boardId={board.id} />
      )}
      {commandMenu && (
        <CommandMenu
          query={commandMenu.query}
          results={commandMenu.results || []}
        />
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

function CardDetail({ card, column, columns, board, events, commandMenu }) {
  const desc = card.description || ''
  const label = card.label || null
  const created = events.find(e => e.type === 'card.created')
  const lastModified = events.length > 0 ? events[events.length - 1] : null

  return (
    <div id="card-detail" style={`view-transition-name: card-expand${label ? `; --card-label-color: ${LABEL_COLORS[label] || 'var(--neutral-7)'}` : ''}`}>
      <div class="card-detail-header">
        <a id="card-detail-back" href={`${base()}boards/${board.id}`} class="back-link">← {board.title}</a>
      </div>
      <div class="card-detail-body">
        <div class="card-detail-main">
          {label && <div class="card-detail-label-bar" style={`background: ${LABEL_COLORS[label]}`}></div>}
          <form
            class="card-detail-form"
            data-on:submit__prevent={`@put('${base()}cards/${card.id}', {contentType: 'form'})`}
          >
            <input
              id="card-detail-title"
              name="title"
              type="text"
              value={card.title}
              class="card-detail-title-input"
              placeholder="Card title"
              autocomplete="off"
            />
            <textarea
              id="card-detail-desc"
              name="description"
              class="card-detail-desc-input"
              placeholder="Add a description..."
              rows="6"
            >{desc}</textarea>
            <div class="card-detail-form-actions">
              <button type="submit" class="btn btn--primary">Save</button>
            </div>
          </form>

          <div class="card-detail-section">
            <h3 class="card-detail-section-title">Label</h3>
            <LabelPicker cardId={card.id} currentLabel={label} />
          </div>

          <div class="card-detail-section">
            <h3 class="card-detail-section-title">Column</h3>
            <div class="card-detail-column-picker">
              {columns.map(col => (
                <button
                  class={`card-detail-col-btn${col.id === card.columnId ? ' card-detail-col-btn--active' : ''}`}
                  data-on:click={col.id !== card.columnId ? `@post('${base()}cards/${card.id}/move-to/${col.id}')` : 'void 0'}
                  disabled={col.id === card.columnId}
                >{col.title}</button>
              ))}
            </div>
          </div>
        </div>

        <div class="card-detail-sidebar">
          <div class="card-detail-section">
            <h3 class="card-detail-section-title">Details</h3>
            <dl class="card-detail-meta">
              {created && <>
                <dt>Created</dt>
                <dd>{new Date(created.ts).toLocaleDateString()} {new Date(created.ts).toLocaleTimeString()}</dd>
              </>}
              {lastModified && lastModified !== created && <>
                <dt>Last modified</dt>
                <dd>{new Date(lastModified.ts).toLocaleDateString()} {new Date(lastModified.ts).toLocaleTimeString()}</dd>
              </>}
              <dt>Column</dt>
              <dd>{column?.title || 'Unknown'}</dd>
            </dl>
          </div>

          <div class="card-detail-section">
            <h3 class="card-detail-section-title">History</h3>
            {events.length > 0 ? (
              <ul class="card-detail-history">
                {[...events].reverse().map(e => (
                  <li class="card-detail-history-item">
                    <span class="card-detail-history-label">{eventLabel(e.type)}</span>
                    <time class="card-detail-history-time">{new Date(e.ts).toLocaleDateString()} {new Date(e.ts).toLocaleTimeString()}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="card-detail-empty">No history yet</p>
            )}
          </div>

          <div class="card-detail-section card-detail-danger">
            <button
              class="btn btn--danger"
              data-on:click={`if(confirm('Delete this card?')) { fetch('${base()}cards/${card.id}',{method:'DELETE'}).then(function(){window.location.href='${base()}boards/${board.id}'}) }`}
            >Delete card</button>
          </div>
        </div>
      </div>
      {commandMenu && (
        <CommandMenu
          query={commandMenu.query}
          results={commandMenu.results || []}
        />
      )}
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

function BoardsList({ boards, templates, commandMenu }) {
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
      {templates && templates.length > 0 && (
        <div id="templates-section">
          <h2 class="templates-heading">Start from a template</h2>
          <div class="templates-grid">
            {templates.map(t => (
              <button
                class="template-card"
                id={`template-${t.id}`}
                data-template-hash={t.hash}
              >
                <span class="template-card-icon">{
                  t.id === 'kanban' ? '\u{1F4CB}' :
                  t.id === 'sprint' ? '\u{1F3C3}' :
                  t.id === 'personal' ? '\u{2705}' :
                  '\u{1F680}'
                }</span>
                <span class="template-card-title">{t.title}</span>
                <span class="template-card-desc">{t.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div class="boards-toolbar">
        <button class="toolbar-btn" id="export-btn">Export</button>
        <button class="toolbar-btn" id="import-btn">Import</button>
        <input type="file" id="import-file" accept=".json" style="display:none" />
      </div>
      <script>{raw(`
        // Template card click handler — POST compressed hash directly to import
        document.querySelectorAll('.template-card[data-template-hash]').forEach(function(btn) {
          btn.addEventListener('click', async function() {
            var hash = this.getAttribute('data-template-hash');
            if (!hash) return;
            // Disable all template buttons to prevent double-click
            document.querySelectorAll('.template-card').forEach(function(b) { b.disabled = true; });
            this.querySelector('.template-card-title').textContent = 'Creating...';
            try {
              var resp = await fetch('${base()}import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: hash })
              });
              var result = await resp.json();
              if (resp.ok && result.boardId) {
                window.location.href = '${base()}boards/' + result.boardId;
              } else {
                alert('Template failed: ' + (result.error || resp.statusText));
                document.querySelectorAll('.template-card').forEach(function(b) { b.disabled = false; });
              }
            } catch(err) {
              alert('Template failed: ' + err.message);
              document.querySelectorAll('.template-card').forEach(function(b) { b.disabled = false; });
            }
          });
        });
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
          // File import: compress events to base64url and POST as { data: compressed }
          // so it goes through the same validated import route as share URLs
          try {
            var events = JSON.parse(text);
            if (!Array.isArray(events)) throw new Error('Expected array');
            // Compress using browser-native CompressionStream
            var jsonStr = JSON.stringify(events);
            var encoded = new TextEncoder().encode(jsonStr);
            var cs = new CompressionStream('deflate');
            var writer = cs.writable.getWriter();
            writer.write(encoded);
            writer.close();
            var reader = cs.readable.getReader();
            var chunks = [];
            while (true) {
              var result = await reader.read();
              if (result.done) break;
              chunks.push(result.value);
            }
            var totalLen = chunks.reduce(function(s,c) { return s + c.length; }, 0);
            var merged = new Uint8Array(totalLen);
            var offset = 0;
            for (var i = 0; i < chunks.length; i++) {
              merged.set(chunks[i], offset);
              offset += chunks[i].length;
            }
            // base64url encode in 32K chunks to avoid RangeError
            var CHUNK = 32768;
            var b64 = '';
            for (var j = 0; j < merged.length; j += CHUNK) {
              b64 += String.fromCharCode.apply(null, merged.subarray(j, j + CHUNK));
            }
            b64 = btoa(b64).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
            var resp = await fetch('${base()}import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ data: b64 })
            });
            var result = await resp.json();
            if (resp.ok && result.boardId) {
              window.location.href = '${base()}boards/' + result.boardId;
            } else {
              alert('Import failed: ' + (result.error || resp.statusText));
            }
          } catch(err) {
            alert('Import failed: ' + err.message);
          }
          e.target.value = '';
        });
      `)}</script>
      {commandMenu && (
        <CommandMenu
          query={commandMenu.query}
          results={commandMenu.results || []}
        />
      )}
    </div>
  )
}

// --- Shell ---

const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* Remove 300ms tap delay on all interactive elements */
a, button, input, textarea, select, [data-on\\:click], [tabindex] {
  touch-action: manipulation;
}

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background: var(--neutral-1);
  color: var(--neutral-11);
  min-height: 100dvh;
  -webkit-text-size-adjust: 100%;
  overscroll-behavior: none;
  /* Safe area insets for notched devices (landscape) */
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
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
  background: var(--neutral-3);
  border: 1px solid var(--neutral-5);
  border-radius: 12px;
  position: relative;
  transition: border-color 0.15s;
}
.board-card:hover { border-color: var(--primary-7); }
.board-card-link {
  display: block;
  padding: clamp(14px, 3vw, 20px);
  text-decoration: none;
  color: inherit;
  cursor: pointer;
}
.board-card h2 { font-size: 1rem; font-weight: 600; margin-bottom: 8px; }
.board-meta { font-size: 0.8rem; color: var(--neutral-7); display: flex; gap: 6px; flex-wrap: wrap; }

.board-delete-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  background: none;
  border: none;
  color: var(--neutral-6);
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
  padding: 6px 8px;
  min-width: 44px;
  min-height: 44px;
  display: grid;
  place-items: center;
}
.board-delete-btn:hover { color: var(--error-7); }

.board-new {
  background: transparent;
  border: 2px dashed var(--neutral-5);
  border-radius: 12px;
  padding: clamp(14px, 3vw, 20px);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* 16px min on all inputs/textareas prevents iOS Safari auto-zoom on focus.
   Doubled selector for specificity to beat .class input rules. */
input:not(#_), textarea:not(#_), select:not(#_) { font-size: max(1rem, 16px); }

.board-new input {
  background: var(--neutral-1);
  border: 1px solid var(--neutral-5);
  border-radius: 6px;
  padding: 10px;
  color: var(--neutral-11);
  font-size: 0.875rem;
}
.board-new input::placeholder { color: var(--neutral-6); }
.board-new input:focus { outline: none; border-color: var(--primary-7); }
.board-new button {
  background: var(--primary-7);
  border: none;
  border-radius: 6px;
  color: #fff;
  padding: 10px 14px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 600;
}
.board-new button:hover { background: var(--primary-6); }

.boards-toolbar {
  margin-top: clamp(16px, 3vw, 24px);
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}
.toolbar-btn {
  background: var(--neutral-3);
  color: var(--neutral-8);
  border: 1px solid var(--neutral-5);
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 0.875rem;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
}
.toolbar-btn:hover { background: var(--neutral-5); color: var(--neutral-11); }

/* ── Templates ───────────────────────────────────────── */

#templates-section {
  margin-top: clamp(24px, 4vw, 40px);
}
.templates-heading {
  font-size: clamp(0.875rem, 0.75rem + 0.5vw, 1rem);
  font-weight: 500;
  color: var(--neutral-7);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: clamp(10px, 2vw, 16px);
}
.templates-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(160px, 100%), 1fr));
  gap: clamp(8px, 1.5vw, 12px);
}
.template-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: clamp(14px, 3vw, 20px) clamp(10px, 2vw, 14px);
  background: var(--neutral-3);
  border: 1px solid var(--neutral-5);
  border-radius: 12px;
  text-decoration: none;
  color: inherit;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  text-align: center;
}
.template-card:hover {
  border-color: var(--primary-7);
  background: var(--neutral-3);
}
.template-card:active {
  background: var(--neutral-5);
}
.template-card-icon {
  font-size: 1.5rem;
  line-height: 1;
}
.template-card-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--neutral-11);
}
.template-card-desc {
  font-size: 0.75rem;
  color: var(--neutral-7);
  line-height: 1.3;
}

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
.board-title-editable { cursor: pointer; }
.board-title-editable:hover { color: var(--primary-7); }
.board-title-form {
  display: flex;
  align-items: center;
  gap: 8px;
}
.board-title-form input {
  font-size: clamp(1.125rem, 1rem + 1vw, 1.5rem);
  font-weight: 600;
  background: var(--neutral-3);
  border: 1px solid var(--neutral-6);
  border-radius: 6px;
  color: var(--neutral-11);
  padding: 2px 8px;
  min-width: 0;
  width: 20ch;
}
.board-title-save, .board-title-cancel {
  background: var(--neutral-5);
  color: var(--neutral-11);
  border: 1px solid var(--neutral-6);
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 0.85rem;
  cursor: pointer;
}
.board-title-save:hover { background: var(--primary-7); border-color: var(--primary-7); }
.board-title-cancel:hover { background: var(--neutral-6); }
.back-link {
  color: var(--primary-7);
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
  /* Prevent horizontal overscroll from triggering back-navigation */
  overscroll-behavior-x: contain;
  /* Snap columns into view on swipe */
  scroll-snap-type: x mandatory;
  scroll-padding: 0 clamp(8px, 2vw, 24px);
}

.column {
  background: var(--neutral-3);
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
  border: 2px dashed var(--primary-7);
  border-radius: 12px;
  background: color-mix(in oklch, var(--primary-7) 5%, transparent);
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
  -webkit-touch-callout: none;
}

.column-header:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--primary-7); border-radius: 6px; }

.column-header h2 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--neutral-8);
  font-weight: 600;
  flex: 1;
}

.col-delete-btn {
  background: none;
  border: none;
  color: var(--neutral-6);
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

.col-delete-btn:hover { color: var(--error-7); }

.count {
  font-size: 0.75rem;
  background: var(--neutral-5);
  color: var(--neutral-8);
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
  color: var(--neutral-6);
  font-size: 0.9rem;
  text-align: center;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
}

/* Hide "No cards yet" when a drag ghost is in the same container */
.cards-container:has(.card-ghost) .empty { display: none; }

.card {
  background: var(--neutral-1);
  border: 1px solid var(--neutral-5);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  cursor: grab;
  transition: border-color 0.15s;
  user-select: none;
  -webkit-touch-callout: none;
}

.card:hover { border-color: var(--neutral-6); }
.card:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--primary-7); }
.card[data-kanban-dragging],
.card[data-kanban-hold] { opacity: 0.5; z-index: 100; }
.card[data-kanban-dropping] { position: relative; z-index: 50; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3); }

.card--labeled { padding-top: 8px; }

.card-content { flex: 1; min-width: 0; }
.card-title { font-size: 0.9rem; word-break: break-word; }
.card-desc { font-size: 0.8rem; color: var(--neutral-8); margin: 4px 0 0; word-break: break-word; }
.card-actions { display: flex; gap: 2px; flex-shrink: 0; margin-left: 4px; }

.card-edit-btn {
  background: none; border: none; color: var(--neutral-6); cursor: pointer;
  font-size: 0.9rem; padding: 6px; min-width: 44px; min-height: 44px;
  display: grid; place-items: center; line-height: 1; transition: color 0.15s;
}
.card-edit-btn:hover { color: var(--primary-7); }

.card-edit-form {
  width: 100%; margin-top: 8px; display: flex; flex-direction: column; gap: 6px;
}
.card-edit-form input,
.card-edit-form textarea {
  background: var(--neutral-3); color: var(--neutral-11); border: 1px solid var(--neutral-5); border-radius: 6px;
  padding: 8px 10px; font-size: 0.875rem; font-family: inherit; resize: vertical;
}
.card-edit-form input:focus,
.card-edit-form textarea:focus { outline: none; border-color: var(--primary-7); }
.card-edit-actions { display: flex; gap: 6px; }
.card-edit-actions button {
  padding: 8px 14px; border-radius: 6px; border: 1px solid var(--neutral-5); cursor: pointer;
  font-size: 0.8rem; transition: background 0.15s;
}
.card-edit-actions button[type="submit"] { background: var(--primary-7); color: #fff; border-color: var(--primary-7); }
.card-edit-actions button[type="submit"]:hover { background: var(--primary-6); }
.card-edit-actions button[type="button"] { background: var(--neutral-3); color: var(--neutral-8); }
.card-edit-actions button[type="button"]:hover { background: var(--neutral-5); }

/* ── Label picker + swatches ─────────────────────── */

.label-picker {
  display: flex;
  align-items: center;
  gap: 8px;
}
.label-picker-label {
  font-size: 0.75rem;
  color: var(--neutral-8);
  white-space: nowrap;
}
.label-picker-swatches,
.action-sheet-swatches {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.label-swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid transparent;
  background: var(--swatch-color);
  cursor: pointer;
  padding: 0;
  transition: border-color 0.15s, transform 0.15s;
}
.label-swatch:hover { transform: scale(1.2); }
.label-swatch--active {
  border-color: #fff;
  box-shadow: 0 0 0 2px var(--swatch-color);
}
.label-swatch--lg {
  width: 28px;
  height: 28px;
}
.label-swatch-clear {
  background: none;
  border: 1px solid var(--neutral-6);
  border-radius: 50%;
  width: 20px;
  height: 20px;
  color: var(--neutral-8);
  cursor: pointer;
  padding: 0;
  font-size: 0.7rem;
  display: grid;
  place-items: center;
  transition: color 0.15s;
}
.label-swatch-clear:hover { color: var(--error-8); }

.card-ghost {
  border: 2px dashed var(--primary-7);
  border-radius: 8px;
  background: color-mix(in oklch, var(--primary-7) 8%, transparent);
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
  color: var(--neutral-6);
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

.delete-btn:hover { color: var(--error-7); }

.add-form {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.add-form input {
  flex: 1;
  min-width: 0;
  background: var(--neutral-1);
  border: 1px solid var(--neutral-5);
  border-radius: 6px;
  padding: 10px;
  color: var(--neutral-11);
  font-size: 0.875rem;
}

.add-form input::placeholder { color: var(--neutral-6); }
.add-form input:focus { outline: none; border-color: var(--primary-7); }

.add-form button {
  background: var(--primary-7);
  border: none;
  border-radius: 6px;
  color: #fff;
  padding: 10px 14px;
  cursor: pointer;
  font-size: 1rem;
  font-weight: 600;
  transition: background 0.15s;
}

.add-form button:hover { background: var(--primary-6); }

.add-col-form {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  padding: 0 clamp(8px, 2vw, 24px);
  flex-wrap: wrap;
}

.add-col-form input {
  background: var(--neutral-3);
  border: 1px solid var(--neutral-5);
  border-radius: 8px;
  padding: 10px 14px;
  color: var(--neutral-11);
  font-size: 0.875rem;
  flex: 1;
  min-width: 0;
}

.add-col-form input::placeholder { color: var(--neutral-6); }
.add-col-form input:focus { outline: none; border-color: var(--primary-7); }

.add-col-form button {
  background: var(--neutral-5);
  border: 1px solid var(--neutral-6);
  border-radius: 8px;
  color: var(--neutral-11);
  padding: 10px 16px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 600;
  white-space: nowrap;
  transition: background 0.15s;
}

.add-col-form button:hover { background: var(--neutral-6); }

/* ── Select mode button ───────────────────────────── */

.tab-count {
  font-size: 0.7rem;
  color: var(--primary-7);
  background: color-mix(in oklch, var(--primary-7) 15%, transparent);
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
}
.tab-count--hidden { display: none; }

/* ── Status chip (offline / local / synced) ──────── */

.status-chip {
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.status-chip::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}
.status-chip--offline {
  color: var(--error-8);
  background: color-mix(in oklch, var(--error-8) 15%, transparent);
}
.status-chip--offline::before { background: var(--error-8); }
.status-chip--local {
  color: var(--neutral-8);
  background: color-mix(in oklch, var(--neutral-8) 15%, transparent);
}
.status-chip--local::before { background: var(--neutral-8); }
.status-chip--pending {
  color: var(--secondary-8);
  background: color-mix(in oklch, var(--secondary-8) 15%, transparent);
}
.status-chip--pending::before { background: var(--secondary-8); }
.status-chip--synced {
  color: var(--secondary-7);
  background: color-mix(in oklch, var(--secondary-7) 15%, transparent);
}
.status-chip--synced::before { background: var(--secondary-7); }

.select-mode-btn {
  background: var(--neutral-5);
  border: 1px solid var(--neutral-6);
  border-radius: 6px;
  color: var(--neutral-8);
  padding: 6px 14px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
  min-height: 44px;
}
.select-mode-btn:hover { background: var(--neutral-6); color: var(--neutral-11); }

/* ── Card selection checkbox ─────────────────────── */

.card-select-checkbox {
  background: none;
  border: none;
  font-size: 1.2rem;
  color: var(--neutral-7);
  cursor: pointer;
  padding: 4px;
  min-width: 44px;
  min-height: 44px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  line-height: 1;
}
.card--selected { border-color: var(--primary-7); background: var(--primary-4); }
.card--selected .card-select-checkbox { color: var(--primary-8); }

/* ── Help overlay ────────────────────────────────── */

.help-overlay-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: grid;
  place-items: center;
  z-index: 1000;
  animation: fade-in 150ms ease-out;
}
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }

.help-overlay {
  background: var(--neutral-3);
  border: 1px solid var(--neutral-5);
  border-radius: 12px;
  padding: 24px;
  max-width: 420px;
  width: calc(100% - 32px);
  max-height: calc(100vh - 64px);
  overflow-y: auto;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
}

.help-overlay-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.help-overlay-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--neutral-11);
}
.help-overlay-close {
  background: none;
  border: none;
  color: var(--neutral-8);
  font-size: 1.2rem;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}
.help-overlay-close:hover { background: var(--neutral-5); color: var(--neutral-11); }

.help-section { margin-bottom: 16px; }
.help-section:last-child { margin-bottom: 0; }
.help-section-title {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--neutral-7);
  margin-bottom: 8px;
}

.help-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 0.85rem;
  color: var(--neutral-9);
}
.help-row kbd {
  background: var(--neutral-1);
  border: 1px solid var(--neutral-5);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 0.75rem;
  font-family: inherit;
  color: var(--neutral-11);
  white-space: nowrap;
}

/* ── Card highlight (search result) ──────────────── */

.card--highlighted {
  outline: 2px solid var(--primary-8);
  outline-offset: 2px;
  animation: card-highlight-pulse 1.5s ease-in-out 2;
}
@keyframes card-highlight-pulse {
  0%, 100% { outline-color: var(--primary-8); box-shadow: 0 0 0 0 transparent; }
  50% { outline-color: var(--primary-9); box-shadow: 0 0 12px 2px color-mix(in oklch, var(--primary-8) 30%, transparent); }
}

/* ── Command menu (Cmd+K) ────────────────────────── */

.command-menu-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: min(20vh, 120px);
  z-index: 1100;
  animation: fade-in 150ms ease-out;
}

.command-menu-panel {
  background: var(--neutral-3);
  border: 1px solid var(--neutral-5);
  border-radius: 12px;
  width: min(520px, calc(100% - 32px));
  max-height: calc(100vh - 180px);
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.command-menu-input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--neutral-5);
}

.command-menu-icon {
  color: var(--neutral-7);
  font-size: 1.1rem;
  flex-shrink: 0;
}

.command-menu-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--neutral-11);
  font-size: 1rem;
  font-family: inherit;
}
.command-menu-input::placeholder { color: var(--neutral-7); }

.command-menu-results {
  overflow-y: auto;
  padding-bottom: 4px;
}

.command-menu-section-header {
  padding: 8px 16px 4px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--neutral-7);
}

.command-menu-section-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.command-menu-result {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  cursor: pointer;
  color: var(--neutral-9);
  font-size: 0.9rem;
  gap: 12px;
}
.command-menu-result:hover { background: var(--neutral-5); }
.command-menu-result--active {
  background: var(--neutral-5);
  color: var(--neutral-12);
}

.command-menu-result-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-menu-type-icon {
  flex-shrink: 0;
  font-size: 0.75rem;
  opacity: 0.6;
  width: 1.1em;
  text-align: center;
}

.command-menu-label-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
  font-size: 0;
  line-height: 0;
}

.command-menu-result-sub {
  color: var(--neutral-7);
  font-size: 0.8rem;
  flex-shrink: 0;
  white-space: nowrap;
}

.command-menu-empty,
.command-menu-hint {
  padding: 16px;
  text-align: center;
  color: var(--neutral-7);
  font-size: 0.9rem;
}

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
  background: var(--neutral-3);
  border-radius: 16px 16px 0 0;
  padding: 16px;
  padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
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
  border-bottom: 1px solid var(--neutral-5);
  margin-bottom: 4px;
}
.action-sheet-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--neutral-11);
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
  color: var(--neutral-7);
  padding: 4px 0;
}

.action-sheet-btn {
  background: var(--neutral-1);
  border: 1px solid var(--neutral-5);
  border-radius: 8px;
  color: var(--neutral-11);
  padding: 12px 16px;
  font-size: 0.9rem;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
  min-height: 44px;
}
.action-sheet-btn:hover { background: var(--neutral-3); border-color: var(--neutral-6); }
.action-sheet-btn--danger { color: var(--error-8); }
.action-sheet-btn--danger:hover { background: var(--error-2); border-color: var(--error-4); }
.action-sheet-btn--cancel {
  background: var(--neutral-5);
  border-color: var(--neutral-6);
  text-align: center;
  font-weight: 600;
  margin-top: 4px;
}
.action-sheet-btn--cancel:hover { background: var(--neutral-6); }

/* ── Selection bar (bottom action bar) ───────────── */

/* ── Time travel ──────────────────────────────────── */
.board--time-travel { opacity: 0.85; }
.time-travel-bar {
  background: var(--neutral-3);
  border: 1px solid var(--primary-7);
  border-radius: 10px;
  padding: 12px 16px;
  margin-bottom: clamp(12px, 3vw, 24px);
}
.tt-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.tt-label {
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--primary-7);
}
.tt-info {
  flex: 1;
  font-size: 0.8rem;
  color: var(--neutral-8);
}
.tt-exit {
  background: var(--neutral-5);
  color: var(--neutral-11);
  border: 1px solid var(--neutral-6);
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 0.8rem;
  cursor: pointer;
}
.tt-exit:hover { background: var(--primary-7); border-color: var(--primary-7); }
.tt-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tt-step {
  background: var(--neutral-5);
  color: var(--neutral-11);
  border: 1px solid var(--neutral-6);
  border-radius: 6px;
  width: 36px;
  height: 28px;
  font-size: 0.9rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tt-step:hover:not(:disabled) { background: var(--neutral-6); }
.tt-step:disabled { opacity: 0.3; cursor: default; }
#tt-slider {
  flex: 1;
  accent-color: var(--primary-7);
  height: 6px;
}
.tt-counter {
  font-size: 0.75rem;
  color: var(--neutral-7);
  min-width: 5ch;
  text-align: right;
}

.selection-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--neutral-3);
  border-top: 1px solid var(--neutral-5);
  padding: 12px clamp(12px, 4vw, 24px);
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  display: flex;
  align-items: center;
  gap: 12px;
  z-index: 150;
  /* Slide up */
  animation: sheet-slide-up 200ms cubic-bezier(0.2, 0, 0, 1);
}
.selection-bar-count {
  font-size: 0.85rem;
  color: var(--neutral-8);
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
  background: var(--neutral-5);
  border: 1px solid var(--neutral-6);
  border-radius: 6px;
  color: var(--neutral-11);
  padding: 8px 14px;
  font-size: 0.85rem;
  cursor: pointer;
  min-height: 44px;
  transition: background 0.15s;
  white-space: nowrap;
}
.selection-bar-btn:hover { background: var(--neutral-6); }
.selection-bar-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.selection-bar-btn--danger { color: var(--error-8); border-color: var(--error-4); }
.selection-bar-btn--danger:hover { background: var(--error-2); }

/* Column picker dropdown above the "Move to…" button */
.column-picker {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 6px;
  background: var(--neutral-3);
  border: 1px solid var(--neutral-6);
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
  color: var(--neutral-11);
  padding: 10px 12px;
  font-size: 0.85rem;
  cursor: pointer;
  border-radius: 6px;
  text-align: left;
  transition: background 0.15s;
  min-height: 44px;
}
.column-picker-btn:hover { background: var(--neutral-5); }

/* Extra bottom padding on board when selection bar is visible */
#board:has(.selection-bar) .columns { padding-bottom: 80px; }

/* MPA cross-document view transitions */
@view-transition { navigation: auto; }

::view-transition-group(*) {
  animation-duration: 200ms;
  animation-timing-function: cubic-bezier(0.2, 0, 0, 1);
}
/* Default: named groups morph, everything else instant */
::view-transition-old(*) { animation: none; opacity: 0; }
::view-transition-new(*) { animation: none; }
/* Root: subtle crossfade so the page doesn't pop during card transitions */
::view-transition-old(root) { animation: vt-fade-out 250ms ease both; opacity: 1; }
::view-transition-new(root) { animation: vt-fade-in 200ms ease 50ms both; }

/* Card expand/collapse — group morphs position+size,
   old/new crossfade so content swaps smoothly during resize */
::view-transition-group(card-expand) {
  animation-duration: 300ms;
  animation-timing-function: cubic-bezier(0.2, 0, 0, 1);
  overflow: hidden;
  z-index: 100;
}
::view-transition-old(card-expand) {
  animation: vt-fade-out 200ms ease both;
}
::view-transition-new(card-expand) {
  animation: vt-fade-in 200ms ease 100ms both;
}
@keyframes vt-fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
@keyframes vt-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
/* ── Card detail page ────────────────────────────── */

#card-detail {
  max-width: 900px;
  margin: 0 auto;
  padding: 16px;
}
.card-detail-header {
  margin-bottom: 20px;
}
.card-detail-body {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 24px;
}
@media (max-width: 700px) {
  .card-detail-body {
    grid-template-columns: 1fr;
  }
}
.card-detail-main {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.card-detail-label-bar {
  height: 4px;
  border-radius: 4px;
}
.card-detail-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.card-detail-title-input {
  font-size: 1.5rem;
  font-weight: 700;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--neutral-11);
  padding: 8px;
  width: 100%;
  box-sizing: border-box;
}
.card-detail-title-input:focus {
  border-color: var(--primary-9);
  outline: none;
  background: var(--neutral-3);
}
.card-detail-desc-input {
  background: var(--neutral-3);
  border: 1px solid var(--neutral-5);
  border-radius: 6px;
  color: var(--neutral-11);
  padding: 10px;
  font-size: 0.95rem;
  resize: vertical;
  min-height: 120px;
  width: 100%;
  box-sizing: border-box;
  font-family: inherit;
}
.card-detail-desc-input:focus {
  border-color: var(--primary-9);
  outline: none;
}
.card-detail-form-actions {
  display: flex;
  gap: 8px;
}
.card-detail-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.card-detail-section-title {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--neutral-7);
  letter-spacing: 0.05em;
  margin: 0;
}
.card-detail-column-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.card-detail-col-btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid var(--neutral-5);
  background: var(--neutral-3);
  color: var(--neutral-11);
  cursor: pointer;
  font-size: 0.85rem;
}
.card-detail-col-btn--active {
  background: var(--primary-9);
  border-color: var(--primary-9);
  color: #fff;
  cursor: default;
}
.card-detail-col-btn:not(:disabled):hover {
  background: var(--neutral-5);
}

/* Sidebar */
.card-detail-sidebar {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.card-detail-meta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  font-size: 0.85rem;
  margin: 0;
}
.card-detail-meta dt {
  color: var(--neutral-7);
}
.card-detail-meta dd {
  margin: 0;
  color: var(--neutral-9);
}
.card-detail-history {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 300px;
  overflow-y: auto;
}
.card-detail-history-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 8px;
  background: var(--neutral-3);
  border-radius: 4px;
  font-size: 0.8rem;
}
.card-detail-history-label {
  color: var(--neutral-11);
}
.card-detail-history-time {
  color: var(--neutral-7);
  font-size: 0.75rem;
}
.card-detail-empty {
  color: var(--neutral-7);
  font-size: 0.85rem;
}
.card-detail-danger {
  padding-top: 12px;
  border-top: 1px solid var(--neutral-5);
}

/* Expand button on board cards */
.card-expand-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  color: var(--neutral-7);
  cursor: pointer;
  border-radius: 4px;
  font-size: 0.85rem;
  text-decoration: none;
  line-height: 1;
}
.card-expand-btn:hover {
  background: var(--neutral-5);
  color: var(--neutral-11);
}

/* Generic button styles */
.btn {
  padding: 8px 18px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
}
.btn--primary {
  background: var(--primary-9);
  color: #fff;
}
.btn--primary:hover { background: var(--primary-8); }
.btn--danger {
  background: var(--error-7);
  color: #fff;
}
.btn--danger:hover { background: var(--error-6); }

::view-transition-new(*) { animation: none; }
/* Columns above default during view transitions so moving column renders on top */
::view-transition-group(*.col) { z-index: 50; }

/* body cursor during drag (set by eg-kanban) */
body[style*="cursor: grabbing"] * { cursor: grabbing !important; }
`

function Shell({ path, children }) {
  const routePath = path || '/'
  const isCardPage = /^\/boards\/[^/]+\/cards\//.test(routePath)
  const isBoardPage = routePath.startsWith('/boards/') && !isCardPage
  // Client-side SSE URL needs the base path so the browser hits the SW scope.
  const sseUrl = base() + routePath.replace(/^\//, '')
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        <meta id="theme-color-meta" name="theme-color" content="#121017" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="manifest" href={`${base()}manifest.json`} />
        <link rel="icon" href={`${base()}icon.svg`} type="image/svg+xml" />
        <link rel="apple-touch-icon" href={`${base()}icon-192.png`} />
        <script>{raw(`(function(){var t=localStorage.getItem('theme')||'system';function apply(t){var dark=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.dataset.theme=dark?'dark':'light';var m=document.getElementById('theme-color-meta');if(m)m.content=dark?'#121017':'#f4eefa'}apply(t);matchMedia('(prefers-color-scheme:dark)').addEventListener('change',function(){var t=localStorage.getItem('theme')||'system';if(t==='system')apply(t)});window.applyTheme=function(t){localStorage.setItem('theme',t);apply(t)};window.previewTheme=function(t){apply(t)};window.revertTheme=function(){apply(localStorage.getItem('theme')||'system')}})()`)}</script>
        <link rel="stylesheet" href={`${base()}${__STELLAR_CSS__}`} />
        <title>Kanban</title>
        <style>{raw(CSS)}</style>
        <script
          type="module"
          src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.8/bundles/datastar.js"
        ></script>
        {isBoardPage && <script src={`${base()}${__KANBAN_JS__}`}></script>}
        {!isBoardPage && <script type="speculationrules">{raw(JSON.stringify({
          prefetch: [{
            source: 'document',
            where: { href_matches: `${base()}boards/*` },
            eagerness: 'moderate',
          }],
        }))}</script>}
      </head>
      <body>
        <main
          id="app"
          data-init={`@get('${sseUrl}', { retry: 'always', retryMaxCount: 1000 })`}
        >
          {children || <p>Loading...</p>}
        </main>
        <script>{raw(`
          // Board import: detect #import=<compressed> in URL hash
          (function() {
            var m = location.hash.match(/^#import=(.+)$/);
            if (!m) return;
            var data = m[1];
            history.replaceState(null, '', location.pathname + location.search);
            var app = document.getElementById('app');
            if (app) app.innerHTML = '<p>Importing board...</p>';
            // Remove data-init to prevent SSE stream from starting during import
            if (app) app.removeAttribute('data-init');
            fetch('${base()}import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ data: data }),
            }).then(function(r) { return r.json(); }).then(function(result) {
              if (result.boardId) {
                window.location.replace('${base()}boards/' + result.boardId);
              } else {
                window.location.replace('${base()}');
              }
            }).catch(function(e) {
              console.error('Board import failed:', e);
              if (app) app.innerHTML = '<p>Import failed. <a href="${base()}">Go to boards</a></p>';
            });
          })();

          if (navigator.serviceWorker) {
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              window.location.reload();
            });
            navigator.serviceWorker.ready.then(reg => {
              setInterval(() => reg.update(), 60 * 1000);
            });
          }
          navigator.storage?.persist?.();

          // Haptic feedback via Vibration API (no-op on desktop / unsupported browsers)
          var _noHaptics = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          function haptic(pattern) {
            if (_noHaptics || !navigator.vibrate) return;
            navigator.vibrate(pattern);
          }
          haptic.tap = function() { haptic(8); };
          haptic.drop = function() { haptic(15); };
          haptic.warn = function() { haptic([12, 40, 12]); };

          // Initialize eg-kanban when #board appears.
          // Runs on mutations (SSE morph) AND immediately for pre-rendered content.
          // Track the DOM node reference so we re-init if Idiomorph replaces #board.
          var kanbanCleanup = null;
          var kanbanBoardEl = null;
          function checkKanban() {
            var board = document.getElementById('board');
            // If #board is a different DOM node than what we initialized, tear down old one
            if (board && kanbanCleanup && board !== kanbanBoardEl) {
              kanbanCleanup();
              kanbanCleanup = null;
              kanbanBoardEl = null;
            }
            if (board && !kanbanCleanup && window.initKanban) {
              kanbanCleanup = window.initKanban(board);
              kanbanBoardEl = board;
            }
            if (!board && kanbanCleanup) {
              kanbanCleanup();
              kanbanCleanup = null;
              kanbanBoardEl = null;
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
          var _lastCmdMenuSeen = false;
          var focusObserver = new MutationObserver(function() {
            // Auto-focus command menu input when it first appears
            var cmdMenu = document.getElementById('command-menu');
            if (cmdMenu && !_lastCmdMenuSeen) {
              var cmdInput = document.getElementById('command-menu-input');
              if (cmdInput) cmdInput.focus();
            }
            _lastCmdMenuSeen = !!cmdMenu;
            // Scroll highlighted card into view (command menu search result)
            var highlighted = document.querySelector('.card--highlighted');
            if (highlighted) {
              highlighted.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            }
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
            haptic.drop();
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
            haptic.tap();
            fetch('${base()}cards/' + d.cardId + '/sheet', { method: 'POST' });
          });

          // Touch column tap → open column action sheet
          document.getElementById('app').addEventListener('kanban-column-tap', function(e) {
            var d = e.detail;
            if (!d.columnId) return;
            haptic.tap();
            fetch('${base()}columns/' + d.columnId + '/sheet', { method: 'POST' });
          });

          // Enter on focused card → open for editing
          document.getElementById('app').addEventListener('kanban-card-open', function(e) {
            var d = e.detail;
            if (!d.cardId) return;
            pendingFocus = { cardId: d.cardId };
            fetch('${base()}cards/' + d.cardId + '/edit', { method: 'POST' });
          });

          document.getElementById('app').addEventListener('kanban-column-drag-end', function(e) {
            var d = e.detail;
            if (!d.columnId) return;
            haptic.drop();
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

          // Cmd+K → toggle command menu (works on any page)
          document.addEventListener('keydown', function(e) {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
              e.preventDefault();
              fetch('${base()}command-menu/open', {
                method: 'POST',
                headers: { 'X-Context': location.pathname }
              });
            }
          });

          // Escape → dismiss command menu (global) or help overlay (board-specific)
          // ? key → toggle help overlay (board-specific)
          document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
              if (document.getElementById('command-menu')) {
                e.preventDefault();
                fetch('${base()}command-menu/close', { method: 'POST' });
                return;
              }
              var boardMatch = location.pathname.match(/boards\\/([^/]+)/);
              if (boardMatch && document.getElementById('help-overlay')) {
                e.preventDefault();
                fetch('${base()}boards/' + boardMatch[1] + '/help-dismiss', { method: 'POST' });
              }
              return;
            }
            var tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea') return;
            var boardMatch = location.pathname.match(/boards\\/([^/]+)/);
            if (!boardMatch) return;
            if (e.key === '?') {
              e.preventDefault();
              fetch('${base()}boards/' + boardMatch[1] + '/help', { method: 'POST' });
            }
          });

          // Notify SW of connection changes so status chip updates
          window.addEventListener('online', function() {
            fetch('${base()}connection-change', { method: 'POST' });
          });
          window.addEventListener('offline', function() {
            fetch('${base()}connection-change', { method: 'POST' });
          });

          // Haptic feedback on Datastar-driven actions via event delegation
          document.getElementById('app').addEventListener('click', function(e) {
            var t = e.target;
            if (!t || !t.closest) return;
            if (t.closest('.action-sheet-btn--danger') || t.closest('.delete-btn')) {
              haptic.warn();
            } else if (t.closest('.card-select-checkbox') || t.closest('.card--selected') || t.closest('[data-on\\\\:click*="toggle-select"]')) {
              haptic.tap();
            } else if (t.closest('.label-swatch')) {
              haptic.tap();
            }
          }, true);

          // View transition: card expand / collapse
          // When navigating TO a card detail page, tag the card element so the
          // browser animates it into the detail view.
          window.addEventListener('pageswap', function(e) {
            if (!e.viewTransition) return;
            var url = new URL(e.activation.entry.url);
            var m = url.pathname.match(/boards\\/[^/]+\\/cards\\/([^/]+)/);
            if (m) {
              var el = document.getElementById('card-' + m[1]);
              if (el) el.style.viewTransitionName = 'card-expand';
            }
          });
          // When navigating FROM a card detail page back to a board, tag the
          // card element on the new page so the detail collapses back into it.
          window.addEventListener('pagereveal', function(e) {
            if (!e.viewTransition) return;
            var from = navigation.activation && navigation.activation.from;
            if (!from) return;
            var m = new URL(from.url).pathname.match(/boards\\/[^/]+\\/cards\\/([^/]+)/);
            if (m) {
              var el = document.getElementById('card-' + m[1]);
              if (el) el.style.viewTransitionName = 'card-expand';
            }
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
  font-family: 'Inconsolata', ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace;
  background: var(--neutral-1);
  color: var(--neutral-11);
  padding: clamp(12px, 4vw, 24px);
  min-height: 100dvh;
  font-size: 0.875rem;
}

a { color: var(--primary-8); }

h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 16px; display: flex; align-items: center; gap: 12px; }
h1 span { font-size: 0.75rem; color: var(--neutral-7); font-weight: 400; }

.event-list { display: flex; flex-direction: column; gap: 2px; }

details {
  background: var(--neutral-3);
  border-radius: 6px;
  border: 1px solid var(--neutral-5);
  transition: border-color 0.15s;
}

details[open] { border-color: var(--neutral-6); }

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
  color: var(--neutral-6);
  font-size: 0.7rem;
  transition: transform 0.15s;
  flex-shrink: 0;
}

details[open] summary::before { transform: rotate(90deg); }

.seq { color: var(--neutral-6); min-width: 3ch; text-align: right; }
.type { color: var(--primary-8); font-weight: 600; font-size: 0.8em; }
.type--delete { color: var(--error-8); }
.type--move { color: var(--secondary-8); }
.type--create { color: var(--secondary-7); }
.type--update { color: var(--primary-8); }
.evt-summary { color: var(--neutral-9); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ts { color: var(--neutral-6); margin-left: auto; font-size: 0.8em; flex-shrink: 0; }
.synced { font-size: 0.75em; padding: 1px 6px; border-radius: 4px; flex-shrink: 0; }
.synced--no { background: var(--error-4); color: var(--secondary-8); }
.synced--yes { background: var(--secondary-4); color: var(--secondary-7); }

pre {
  padding: 12px;
  margin: 0;
  border-top: 1px solid var(--neutral-5);
  overflow-x: auto;
  font-size: 0.85em;
  line-height: 1.5;
  color: var(--neutral-9);
}

.actions { display: flex; gap: 8px; margin-bottom: 16px; }

.actions button {
  background: var(--neutral-5);
  border: 1px solid var(--neutral-6);
  border-radius: 6px;
  color: var(--neutral-11);
  padding: 6px 12px;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.85em;
  transition: background 0.15s;
}

.actions button:hover { background: var(--neutral-6); }
.actions button:disabled { opacity: 0.5; cursor: wait; }

.board-filter {
  background: var(--neutral-5);
  border: 1px solid var(--neutral-6);
  border-radius: 6px;
  color: var(--neutral-11);
  padding: 6px 12px;
  font-family: inherit;
  font-size: 0.85em;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2394a3b8'%3E%3Cpath d='M2 4l4 4 4-4'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  padding-right: 28px;
}
.board-filter:hover { background-color: var(--neutral-6); }

.event-count {
  color: var(--neutral-7);
  font-size: 0.8em;
  padding: 4px 0 8px;
}

.events-scroll {
  overflow-y: auto;
  max-height: calc(100dvh - 120px);
  scroll-behavior: smooth;
}
`

function typeClass(type) {
  if (type.includes('deleted') || type.includes('Deleted')) return 'type type--delete'
  if (type.includes('moved') || type.includes('Moved')) return 'type type--move'
  if (type.includes('created') || type.includes('Created')) return 'type type--create'
  if (type.includes('Updated') || type.includes('updated')) return 'type type--update'
  return 'type'
}

function summarizeEvent(evt) {
  const { type, data } = evt
  switch (type) {
    case 'board.created': return `Created board "${data.title}"`
    case 'board.titleUpdated': return `Renamed board to "${data.title}"`
    case 'board.deleted': return `Deleted board`
    case 'column.created': return `Created column "${data.title}"`
    case 'column.deleted': return `Deleted column`
    case 'column.moved': return `Moved column`
    case 'card.created': return `Created card "${data.title}"`
    case 'card.moved': return `Moved card`
    case 'card.titleUpdated': return `Renamed card to "${data.title}"`
    case 'card.descriptionUpdated': return data.description ? `Updated card description` : `Cleared card description`
    case 'card.labelUpdated': return data.label ? `Set card label to ${data.label}` : `Removed card label`
    case 'card.deleted': return `Deleted card`
    default: return type
  }
}

function EventList({ events, boardFilter, boards }) {
  const filtered = boardFilter ? events.filter(e => {
    // board events: data.id is the boardId
    if (e.type.startsWith('board.')) return e.data.id === boardFilter
    // column/card events: data.boardId if present
    if (e.data.boardId) return e.data.boardId === boardFilter
    // card events without boardId — need column lookup (resolved at render time via _boardId annotation)
    if (e._boardId) return e._boardId === boardFilter
    return false
  }) : events
  const synced = filtered.filter(e => e.synced).length
  const local = filtered.length - synced
  return (
    <div id="event-list" class="event-list">
      <p class="event-count">{filtered.length} events — {local} local{synced > 0 ? `, ${synced} synced` : ''}{boardFilter && boards ? ` — filtered to "${boards.find(b => b.id === boardFilter)?.title || boardFilter}"` : ''}</p>
      {filtered.length === 0
        ? <p style="color: var(--neutral-6); padding: 16px;">No events yet.</p>
        : [...filtered].reverse().map(evt => (
            <details id={`evt-${evt.seq}`}>
              <summary>
                <span class="seq">{evt.seq}</span>
                <span class={typeClass(evt.type)}>{evt.type}</span>
                <span class="evt-summary">{summarizeEvent(evt)}</span>
                <span class={evt.synced ? 'synced synced--yes' : 'synced synced--no'}>
                  {evt.synced ? 'synced' : 'local'}
                </span>
                <span class="ts">{new Date(evt.ts).toLocaleTimeString()}</span>
              </summary>
              <pre>{raw(JSON.stringify(evt, (k, v) => k === '_boardId' ? undefined : v, 2).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '&#10;'))}</pre>
            </details>
          ))}
    </div>
  )
}

function EventsPage({ boards, boardFilter }) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        <meta id="theme-color-meta" name="theme-color" content="#121017" />
        <link rel="manifest" href={`${base()}manifest.json`} />
        <link rel="icon" href={`${base()}icon.svg`} type="image/svg+xml" />
        <script>{raw(`(function(){var t=localStorage.getItem('theme')||'system';var dark=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.dataset.theme=dark?'dark':'light';var m=document.getElementById('theme-color-meta');if(m)m.content=dark?'#121017':'#f4eefa'})()`)}</script>
        <link rel="stylesheet" href={`${base()}${__STELLAR_CSS__}`} />
        <title>Event Log{boardFilter && boards ? ` — ${boards.find(b => b.id === boardFilter)?.title || ''}` : ''}</title>
        <style>{raw(EVENTS_CSS)}</style>
        <script
          type="module"
          src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.8/bundles/datastar.js"
        ></script>
      </head>
      <body>
        <h1>Event Log <span><a href={base()}>← boards</a></span></h1>
        <div class="actions">
          <select class="board-filter" onchange={`window.location.href='${base()}events' + (this.value ? '?board=' + this.value : '')`}>
            <option value="">All boards</option>
            {boards.map(b => (
              <option value={b.id} selected={b.id === boardFilter}>{b.title}</option>
            ))}
          </select>
          <button
            data-indicator="_rebuilding"
            data-on:click={`@post('${base()}rebuild')`}
            data-attr:disabled="$_rebuilding"
          >
            <span data-show="!$_rebuilding">Rebuild Projection</span>
            <span data-show="$_rebuilding">Rebuilding...</span>
          </button>
        </div>
        <div class="events-scroll"
          id="events-app"
          data-init={`@get('${base()}events${boardFilter ? `?board=${boardFilter}` : ''}', { retry: 'always', retryMaxCount: 1000 })`}
        >
          <p style="color: var(--neutral-6);">Connecting...</p>
        </div>
        <script>{raw(`
          if (navigator.serviceWorker) {
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              window.location.reload();
            });
          }
          // Auto-scroll to top when new events arrive (list is reverse-chronological)
          const target = document.getElementById('events-app');
          if (target) {
            new MutationObserver(() => {
              target.scrollTop = 0;
            }).observe(target, { childList: true, subtree: true });
          }
        `)}</script>
      </body>
    </html>
  )
}

// --- Hono app ---

const app = new Hono()

// ── Boards list (index) ──────────────────────────────────────────────────────

app.get('/', async (c) => {
  await initialize()

  if (c.req.header('Datastar-Request') === 'true') {
    return streamSSE(c, async (stream) => {
      const templateHashes = await Promise.all(BOARD_TEMPLATES.map(async t => ({ id: t.id, title: t.title, description: t.description, hash: await getTemplateHash(t) })))
      const push = async (selector, mode, opts) => {
        const boards = await getBoards()
        await stream.writeSSE(dsePatch(selector, <BoardsList boards={boards} templates={templateHashes} commandMenu={globalUIState.commandMenu} />, mode, opts))
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

      // Re-push when global UI changes (command menu open/close/search)
      const globalUIHandler = () => push('#boards-list', 'outer')
      bus.addEventListener('global:ui', globalUIHandler)

      stream.onAbort(() => {
        bus.removeEventListener('boards:changed', handler)
        bus.removeEventListener('global:ui', globalUIHandler)
      })

      await push('#app', 'inner')
      while (!stream.closed) { await stream.sleep(30000) }
    })
  }

  const boards = await getBoards()
  const templateHashes = await Promise.all(BOARD_TEMPLATES.map(async t => ({ id: t.id, title: t.title, description: t.description, hash: await getTemplateHash(t) })))
  return c.html('<!DOCTYPE html>' + (<Shell path="/"><BoardsList boards={boards} templates={templateHashes} commandMenu={globalUIState.commandMenu} /></Shell>).toString())
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

// ── Board sharing ────────────────────────────────────────────────────────────

// Export: compress board events into a share URL hash fragment
app.post('/boards/:boardId/share', async (c) => {
  await initialize()
  const boardId = c.req.param('boardId')
  const db = await dbPromise
  const allEvents = await db.getAll('events')
  // Collect events belonging to this board (board.*, column.*, card.*)
  const tx = db.transaction(ALL_STORES, 'readonly')
  const boardEvents = []
  for (const evt of allEvents) {
    const bid = await boardIdForEvent(evt, tx)
    if (bid === boardId) boardEvents.push(evt)
  }
  // Strip runtime-only fields (seq, synced) for portability
  const portable = boardEvents.map(({ seq, synced, _boardId, ...rest }) => rest)
  const json = JSON.stringify(portable)
  const compressed = await compressToBase64url(json)
  const shareUrl = `${base()}#import=${compressed}`
  return c.json({ shareUrl, eventCount: portable.length, compressedSize: compressed.length })
})

// Import: receive compressed events from hash fragment, replay into local store
app.post('/import', async (c) => {
  await initialize()
  const body = await c.req.json()
  if (!body || typeof body.data !== 'string') {
    return c.json({ error: 'Missing or invalid data field' }, 400)
  }
  // Decompress (size-limited by decompressFromBase64url)
  let json
  try {
    json = await decompressFromBase64url(body.data)
  } catch (e) {
    return c.json({ error: 'Decompression failed: ' + e.message }, 400)
  }
  let events
  try {
    events = JSON.parse(json)
  } catch (e) {
    return c.json({ error: 'Invalid JSON' }, 400)
  }
  if (!Array.isArray(events)) {
    return c.json({ error: 'Expected array of events' }, 400)
  }
  if (events.length > MAX_IMPORT_EVENTS) {
    return c.json({ error: `Too many events (max ${MAX_IMPORT_EVENTS})` }, 400)
  }
  if (events.length === 0) {
    return c.json({ error: 'No events to import' }, 400)
  }
  // Validate each event: must have known type, string data.id, and data object
  for (let i = 0; i < events.length; i++) {
    const evt = events[i]
    if (!evt || typeof evt !== 'object') {
      return c.json({ error: `Event ${i} is not an object` }, 400)
    }
    if (!ALLOWED_EVENT_TYPES.has(evt.type)) {
      return c.json({ error: `Event ${i} has unknown type: ${evt.type}` }, 400)
    }
    if (!evt.data || typeof evt.data !== 'object') {
      return c.json({ error: `Event ${i} missing data object` }, 400)
    }
    // Sanitize string fields to prevent XSS — cap lengths
    if (evt.data.title != null) {
      if (typeof evt.data.title !== 'string') return c.json({ error: `Event ${i} title not a string` }, 400)
      evt.data.title = evt.data.title.slice(0, 500)
    }
    if (evt.data.description != null) {
      if (typeof evt.data.description !== 'string') return c.json({ error: `Event ${i} description not a string` }, 400)
      evt.data.description = evt.data.description.slice(0, 10000)
    }
    if (evt.data.label != null && typeof evt.data.label !== 'string') {
      return c.json({ error: `Event ${i} label not a string` }, 400)
    }
  }
  // Must contain exactly one board.created
  const boardCreatedCount = events.filter(e => e.type === 'board.created').length
  if (boardCreatedCount !== 1) {
    return c.json({ error: `Expected exactly 1 board.created event, got ${boardCreatedCount}` }, 400)
  }
  // Re-assign new IDs to the board so imports don't collide with existing data.
  // Map old entity IDs → new IDs for board, columns, and cards.
  const idMap = new Map()
  function remap(oldId) {
    if (!idMap.has(oldId)) idMap.set(oldId, crypto.randomUUID())
    return idMap.get(oldId)
  }
  const remapped = events.map(evt => {
    const e = { ...evt, id: crypto.randomUUID(), synced: false }
    const d = { ...e.data }
    switch (e.type) {
      case 'board.created':
      case 'board.titleUpdated':
      case 'board.deleted':
        d.id = remap(evt.data.id)
        break
      case 'column.created':
        d.id = remap(evt.data.id)
        d.boardId = remap(evt.data.boardId)
        break
      case 'column.deleted':
      case 'column.moved':
        d.id = remap(evt.data.id)
        break
      case 'card.created':
        d.id = remap(evt.data.id)
        d.columnId = remap(evt.data.columnId)
        break
      case 'card.moved':
        d.id = remap(evt.data.id)
        if (d.columnId) d.columnId = remap(evt.data.columnId)
        break
      case 'card.titleUpdated':
      case 'card.descriptionUpdated':
      case 'card.labelUpdated':
      case 'card.deleted':
        d.id = remap(evt.data.id)
        break
    }
    e.data = d
    return e
  })
  await appendEvents(remapped)
  // Find the new board ID
  const boardEvt = remapped.find(e => e.type === 'board.created')
  const newBoardId = boardEvt ? boardEvt.data.id : null
  return c.json({ boardId: newBoardId, eventCount: remapped.length })
})

// ── Board detail ─────────────────────────────────────────────────────────────

app.get('/boards/:boardId', async (c) => {
  await initialize()
  const boardId = c.req.param('boardId')

  if (c.req.header('Datastar-Request') === 'true') {
    return streamSSE(c, async (stream) => {
      const pushBoard = async (selector, mode, opts) => {
        const ui = getUIState(boardId)
        let data
        if (ui.timeTravelPos >= 0 && ui.timeTravelAllEvents && ui.timeTravelEvents) {
          // Time travel mode: replay to the current position
          const targetIdx = ui.timeTravelEvents[ui.timeTravelPos].idx
          data = await replayToPosition(ui.timeTravelAllEvents, targetIdx, boardId)
        } else {
          data = await getBoard(boardId)
        }
        if (!data) return
        const tabCount = await getTabCount(boardId)
        const connStatus = await getConnectionStatus()
        await stream.writeSSE(dsePatch(selector, <Board board={data.board} columns={data.columns} cards={data.cards} uiState={ui} tabCount={tabCount} connStatus={connStatus} commandMenu={globalUIState.commandMenu} />, mode, opts))
      }

      const topic = `board:${boardId}:changed`
      const handler = () => pushBoard('#board', 'outer', { useViewTransition: true })
      bus.addEventListener(topic, handler)

      // Also re-push on UI-only changes (action sheet, selection mode, tab count)
      const uiTopic = `board:${boardId}:ui`
      const uiHandler = () => pushBoard('#board', 'outer')
      bus.addEventListener(uiTopic, uiHandler)

      // Re-push when global UI changes (command menu open/close/search)
      const globalUIHandler = () => pushBoard('#board', 'outer')
      bus.addEventListener('global:ui', globalUIHandler)

      stream.onAbort(() => {
        bus.removeEventListener(topic, handler)
        bus.removeEventListener(uiTopic, uiHandler)
        bus.removeEventListener('global:ui', globalUIHandler)
        notifyTabChange(boardId)
      })

      await pushBoard('#app', 'inner')
      notifyTabChange(boardId)
      while (!stream.closed) { await stream.sleep(30000) }
    })
  }

  const data = await getBoard(boardId)
  const ui = getUIState(boardId)
  const connStatus = await getConnectionStatus()
  return c.html('<!DOCTYPE html>' + (
    <Shell path={`/boards/${boardId}`}>
      {data ? <Board board={data.board} columns={data.columns} cards={data.cards} uiState={ui} tabCount={0} connStatus={connStatus} commandMenu={globalUIState.commandMenu} /> : <p>Board not found</p>}
    </Shell>
  ).toString())
})

// ── Card detail ──────────────────────────────────────────────────────────────

app.get('/boards/:boardId/cards/:cardId', async (c) => {
  await initialize()
  const boardId = c.req.param('boardId')
  const cardId = c.req.param('cardId')

  if (c.req.header('Datastar-Request') === 'true') {
    return streamSSE(c, async (stream) => {
      const pushCard = async (selector, mode) => {
        const db = await dbPromise
        const card = await db.get('cards', cardId)
        if (!card) return
        const board = await db.get('boards', boardId)
        if (!board) return
        const columns = (await db.getAllFromIndex('columns', 'byBoard', boardId)).sort(cmpPosition)
        const col = columns.find(c => c.id === card.columnId)
        const events = await loadCardEvents(cardId)
        await stream.writeSSE(dsePatch(selector,
          <CardDetail card={card} column={col} columns={columns} board={board} events={events} commandMenu={globalUIState.commandMenu} />,
          mode
        ))
      }

      const topic = `board:${boardId}:changed`
      const handler = () => pushCard('#card-detail', 'outer')
      bus.addEventListener(topic, handler)

      const uiTopic = `board:${boardId}:ui`
      const uiHandler = () => pushCard('#card-detail', 'outer')
      bus.addEventListener(uiTopic, uiHandler)

      const globalUIHandler = () => pushCard('#card-detail', 'outer')
      bus.addEventListener('global:ui', globalUIHandler)

      stream.onAbort(() => {
        bus.removeEventListener(topic, handler)
        bus.removeEventListener(uiTopic, uiHandler)
        bus.removeEventListener('global:ui', globalUIHandler)
      })

      await pushCard('#app', 'inner')
      while (!stream.closed) { await stream.sleep(30000) }
    })
  }

  const db = await dbPromise
  const card = await db.get('cards', cardId)
  const board = await db.get('boards', boardId)
  if (!card || !board) {
    return c.html('<!DOCTYPE html>' + (
      <Shell path={`/boards/${boardId}`}><p>Card not found</p></Shell>
    ).toString())
  }
  const columns = (await db.getAllFromIndex('columns', 'byBoard', boardId)).sort(cmpPosition)
  const col = columns.find(co => co.id === card.columnId)
  const events = await loadCardEvents(cardId)
  return c.html('<!DOCTYPE html>' + (
    <Shell path={`/boards/${boardId}/cards/${cardId}`}>
      <CardDetail card={card} column={col} columns={columns} board={board} events={events} commandMenu={globalUIState.commandMenu} />
    </Shell>
  ).toString())
})

// Command: move card to specific column (from card detail)
app.post('/cards/:cardId/move-to/:columnId', async (c) => {
  const cardId = c.req.param('cardId')
  const columnId = c.req.param('columnId')
  const db = await dbPromise
  const card = await db.get('cards', cardId)
  if (!card || card.columnId === columnId) return c.body(null, 204)
  const boardId = await boardIdFromCard(cardId)
  // Place at end of target column
  const colCards = (await db.getAllFromIndex('cards', 'byColumn', columnId)).sort(cmpPosition)
  const lastPos = colCards.length > 0 ? colCards[colCards.length - 1].position : null
  await appendEventsWithUndo([createEvent('card.moved', {
    id: cardId,
    columnId,
    position: generateKeyBetween(lastPos, null),
  })], boardId)
  return c.body(null, 204)
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

// Set/remove card label
app.post('/cards/:cardId/label/:label', async (c) => {
  const cardId = c.req.param('cardId')
  const labelParam = c.req.param('label')
  const label = labelParam === 'none' ? null : (LABEL_COLORS[labelParam] ? labelParam : null)

  const db = await dbPromise
  const card = await db.get('cards', cardId)
  if (!card) return c.body(null, 404)

  const currentLabel = card.label || null
  if (label === currentLabel) return c.body(null, 204)

  const boardId = await boardIdFromCard(cardId)
  const evt = createEvent('card.labelUpdated', { id: cardId, label })
  await appendEventsWithUndo([evt], boardId)

  // Dismiss action sheet if open
  if (boardId) {
    const ui = getUIState(boardId)
    ui.activeCardSheet = null
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
// Board title editing: toggle edit mode
app.post('/boards/:boardId/title-edit', async (c) => {
  const boardId = c.req.param('boardId')
  const ui = getUIState(boardId)
  ui.editingBoardTitle = !ui.editingBoardTitle
  emitUI(boardId)
  return c.body(null, 204)
})

// Board title editing: cancel
app.post('/boards/:boardId/title-edit-cancel', async (c) => {
  const boardId = c.req.param('boardId')
  const ui = getUIState(boardId)
  ui.editingBoardTitle = false
  emitUI(boardId)
  return c.body(null, 204)
})

// Board title editing: save
app.put('/boards/:boardId', async (c) => {
  const boardId = c.req.param('boardId')
  const body = await c.req.parseBody()

  const db = await dbPromise
  const board = await db.get('boards', boardId)
  if (!board) return c.body(null, 404)

  const newTitle = String(body.title || '').trim()
  if (newTitle && newTitle !== board.title) {
    const correlationId = crypto.randomUUID()
    const event = createEvent('board.titleUpdated', { id: boardId, title: newTitle }, { correlationId })
    await appendEventsWithUndo([event], boardId)
  }

  const ui = getUIState(boardId)
  ui.editingBoardTitle = false
  emitUI(boardId)
  return c.body(null, 204)
})

// Help overlay: toggle
app.post('/boards/:boardId/help', async (c) => {
  const boardId = c.req.param('boardId')
  const ui = getUIState(boardId)
  ui.showHelp = !ui.showHelp
  emitUI(boardId)
  return c.body(null, 204)
})

// Help overlay: dismiss
app.post('/boards/:boardId/help-dismiss', async (c) => {
  const boardId = c.req.param('boardId')
  const ui = getUIState(boardId)
  ui.showHelp = false
  emitUI(boardId)
  return c.body(null, 204)
})

// ── Global command menu (Cmd+K) ──────────────────────────────────────────────

// Build contextual results for the command menu.
// `context` is the URL path the user is on (e.g. '/' or '/boards/abc').
async function buildCommandMenuResults(query, context) {
  await initialize()
  const db = await dbPromise
  const q = (query || '').toLowerCase()

  const boardMatch = context.match(/\/boards\/([^/]+)/)
  const currentBoardId = boardMatch ? boardMatch[1] : null
  const isCardDetail = /\/boards\/[^/]+\/cards\//.test(context)

  const boards = await db.getAll('boards')
  const columns = await db.getAll('columns')
  const cards = await db.getAll('cards')

  const boardMap = Object.fromEntries(boards.map(b => [b.id, b]))
  const colMap = Object.fromEntries(columns.map(c => [c.id, c]))
  const boardColCount = {}
  const boardCardCount = {}
  for (const col of columns) {
    boardColCount[col.boardId] = (boardColCount[col.boardId] || 0) + 1
  }
  for (const card of cards) {
    const col = colMap[card.columnId]
    if (col) boardCardCount[col.boardId] = (boardCardCount[col.boardId] || 0) + 1
  }

  const results = []

  // --- Contextual actions (state-aware) ---
  const actions = []
  const shareAction = currentBoardId ? {
    type: 'action', id: 'a-share', title: 'Share board', subtitle: 'Copy link', group: 'Actions',
    jsAction: `fetch('${base()}boards/${currentBoardId}/share',{method:'POST'}).then(function(r){return r.json()}).then(function(d){var url=location.origin+d.shareUrl;navigator.clipboard.writeText(url)})`
  } : null

  if (currentBoardId && isCardDetail) {
    // Card detail page — show navigation actions only
    actions.push(
      { type: 'action', id: 'a-back-board', title: 'Back to board', subtitle: '', group: 'Actions', href: `${base()}boards/${currentBoardId}` },
      shareAction,
      { type: 'action', id: 'a-events', title: 'Event log', subtitle: 'This board', group: 'Actions', popupUrl: `${base()}events?board=${currentBoardId}`, popupName: 'event-log' },
      { type: 'action', id: 'a-events-all', title: 'Event log (all)', subtitle: 'All boards', group: 'Actions', popupUrl: `${base()}events`, popupName: 'event-log' },
      { type: 'action', id: 'a-boards', title: 'All boards', subtitle: '', group: 'Actions', href: base() },
    )
  } else if (currentBoardId) {
    const ui = getUIState(currentBoardId)
    const isSelecting = ui.selectionMode
    const isTimeTraveling = ui.timeTravelPos >= 0
    const selectedCount = ui.selectedCards?.size || 0
    const boardColumns = columns.filter(c => c.boardId === currentBoardId).sort(cmpPosition)

    if (isSelecting) {
      // Selection mode active — show exit + batch actions
      actions.push(
        { type: 'action', id: 'a-exit-select', title: 'Exit selection mode', subtitle: `${selectedCount} selected`, group: 'Actions', actionUrl: `${base()}boards/${currentBoardId}/select-mode/cancel` },
      )
      if (selectedCount > 0) {
        actions.push(
          { type: 'action', id: 'a-batch-delete', title: `Delete ${selectedCount} selected`, subtitle: '', group: 'Actions', actionUrl: `${base()}boards/${currentBoardId}/batch-delete` },
        )
        for (const col of boardColumns) {
          actions.push(
            { type: 'action', id: `a-move-${col.id}`, title: `Move to ${col.title}`, subtitle: `${selectedCount} cards`, group: 'Move selected', actionUrl: `${base()}boards/${currentBoardId}/batch-move/${col.id}` },
          )
        }
      }
    } else if (isTimeTraveling) {
      // Time travel active — show exit
      actions.push(
        { type: 'action', id: 'a-exit-tt', title: 'Exit time travel', subtitle: '', group: 'Actions', actionUrl: `${base()}boards/${currentBoardId}/time-travel/exit` },
      )
    } else {
      // Normal mode
      actions.push(
        { type: 'action', id: 'a-undo', title: 'Undo', subtitle: 'Ctrl+Z', group: 'Actions', actionUrl: `${base()}boards/${currentBoardId}/undo` },
        { type: 'action', id: 'a-redo', title: 'Redo', subtitle: 'Ctrl+Shift+Z', group: 'Actions', actionUrl: `${base()}boards/${currentBoardId}/redo` },
        { type: 'action', id: 'a-select', title: 'Selection mode', subtitle: '', group: 'Actions', actionUrl: `${base()}boards/${currentBoardId}/select-mode` },
        { type: 'action', id: 'a-history', title: 'History', subtitle: '', group: 'Actions', actionUrl: `${base()}boards/${currentBoardId}/time-travel` },
      )
    }
    // Always available regardless of mode
    actions.push(
      { type: 'action', id: 'a-help', title: ui.showHelp ? 'Close help' : 'Keyboard shortcuts', subtitle: '?', group: 'Actions', actionUrl: `${base()}boards/${currentBoardId}/help` },
      shareAction,
      { type: 'action', id: 'a-events', title: 'Event log', subtitle: 'This board', group: 'Actions', popupUrl: `${base()}events?board=${currentBoardId}`, popupName: 'event-log' },
      { type: 'action', id: 'a-events-all', title: 'Event log (all)', subtitle: 'All boards', group: 'Actions', popupUrl: `${base()}events`, popupName: 'event-log' },
      { type: 'action', id: 'a-boards', title: 'All boards', subtitle: '', group: 'Actions', href: base() },
    )
  } else {
    // Boards list page — no board context
    actions.push(
      { type: 'action', id: 'a-events-all', title: 'Event log', subtitle: 'All boards', group: 'Actions', popupUrl: `${base()}events`, popupName: 'event-log' },
    )
  }
  // Always available on every page
  actions.push(
    { type: 'action', id: 'a-theme', title: 'Change theme', subtitle: '\u263E', group: 'Actions',
      jsAction: `fetch('${base()}command-menu/theme',{method:'POST',headers:{'X-Current-Theme':localStorage.getItem('theme')||'system'}})` },
  )

  for (const action of actions) {
    if (!q || action.title.toLowerCase().includes(q)) results.push(action)
  }

  // --- Cards: unified section across all boards, current board first ---
  if (q) {
    const currentColIds = currentBoardId
      ? new Set(columns.filter(c => c.boardId === currentBoardId).map(c => c.id))
      : new Set()

    // Current board cards first (if on a board)
    if (currentBoardId) {
      const localCards = cards
        .filter(c => currentColIds.has(c.columnId) && (
          c.title.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q)
        ))
        .sort(cmpPosition)
        .slice(0, 12)
      for (const card of localCards) {
        const col = colMap[card.columnId]
        results.push({
          type: 'card', id: card.id, title: card.title,
          subtitle: col ? col.title : '',
          group: 'Cards',
          boardId: currentBoardId, sameBoard: true,
          label: card.label || null,
        })
      }
    }

    // Cross-board cards (or all cards when on boards list)
    const crossCards = cards
      .filter(c => {
        const col = colMap[c.columnId]
        if (!col) return false
        if (currentBoardId && currentColIds.has(c.columnId)) return false // already shown above
        return c.title.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q)
      })
      .sort(cmpPosition)
      .slice(0, 10)
    for (const card of crossCards) {
      const col = colMap[card.columnId]
      const board = col ? boardMap[col.boardId] : null
      results.push({
        type: 'card', id: card.id, title: card.title,
        subtitle: `${board?.title || ''} / ${col?.title || ''}`,
        group: 'Cards',
        boardId: col?.boardId, sameBoard: false,
        label: card.label || null,
      })
    }
  }

  // --- Boards ---
  // On card detail, include all boards (parent board is relevant for navigation back).
  // On board page, exclude the current board.
  if (currentBoardId) {
    const excludeId = isCardDetail ? null : currentBoardId
    const matchingBoards = q
      ? boards.filter(b => b.id !== excludeId && b.title.toLowerCase().includes(q))
      : boards.filter(b => b.id !== excludeId)
    for (const b of matchingBoards.slice(0, 6)) {
      results.push({
        type: 'board', id: b.id, title: b.title,
        subtitle: `${boardColCount[b.id] || 0} cols \u00B7 ${boardCardCount[b.id] || 0} cards`,
        group: 'Boards',
        href: `${base()}boards/${b.id}`,
      })
    }
  } else {
    const matchingBoards = q ? boards.filter(b => b.title.toLowerCase().includes(q)) : boards
    for (const b of matchingBoards.slice(0, 10)) {
      results.push({
        type: 'board', id: b.id, title: b.title,
        subtitle: `${boardColCount[b.id] || 0} cols \u00B7 ${boardCardCount[b.id] || 0} cards`,
        group: 'Boards',
        href: `${base()}boards/${b.id}`,
      })
    }
  }

  return results
}

// Command menu: open (toggle)
app.post('/command-menu/open', async (c) => {
  const context = c.req.header('X-Context') || '/'
  if (globalUIState.commandMenu) {
    globalUIState.commandMenu = null
  } else {
    const results = await buildCommandMenuResults('', context)
    globalUIState.commandMenu = { query: '', results, context }
  }
  emitGlobalUI()
  return c.body(null, 204)
})

// Command menu: close
app.post('/command-menu/close', async (c) => {
  globalUIState.commandMenu = null
  emitGlobalUI()
  return c.body(null, 204)
})

// Command menu: search
app.post('/command-menu/search', async (c) => {
  const body = await c.req.parseBody()
  const query = (body.query || '').trim()
  const cm = globalUIState.commandMenu
  if (!cm) return c.body(null, 204)

  const results = await buildCommandMenuResults(query, cm.context || '/')
  cm.query = body.query || ''
  cm.results = results
  emitGlobalUI()
  return c.body(null, 204)
})

// Command menu: theme picker sub-menu
app.post('/command-menu/theme', async (c) => {
  const current = c.req.header('X-Current-Theme') || 'system'
  const THEMES = [
    { id: 'system', title: 'System', subtitle: 'Follow OS preference', icon: '\uD83D\uDCBB' },
    { id: 'light', title: 'Light', subtitle: '', icon: '\u2600\uFE0F' },
    { id: 'dark', title: 'Dark', subtitle: '', icon: '\uD83C\uDF19' },
  ]
  const results = THEMES.map(t => ({
    type: 'action', id: `t-${t.id}`,
    title: `${t.icon}  ${t.title}${t.id === current ? '  \u2713' : ''}`,
    subtitle: t.subtitle,
    group: 'Theme',
    themeId: t.id,
    jsAction: `applyTheme('${t.id}');fetch('${base()}command-menu/close',{method:'POST'})`,
  }))
  globalUIState.commandMenu = { query: '', results, context: globalUIState.commandMenu?.context || '/' }
  emitGlobalUI()
  return c.body(null, 204)
})

// Time travel: enter
app.post('/boards/:boardId/time-travel', async (c) => {
  await initialize()
  const boardId = c.req.param('boardId')
  const ui = getUIState(boardId)
  const { allEvents, boardEvents } = await loadTimeTravelEvents(boardId)
  ui.timeTravelEvents = boardEvents
  ui.timeTravelAllEvents = allEvents // stash for replay
  ui.timeTravelPos = boardEvents.length - 1 // start at latest
  ui.editingCard = null
  ui.editingBoardTitle = false
  ui.activeCardSheet = null
  ui.activeColSheet = null
  emitUI(boardId)
  return c.body(null, 204)
})

// Time travel: seek to position
app.post('/boards/:boardId/time-travel/seek', async (c) => {
  const boardId = c.req.param('boardId')
  const body = await c.req.parseBody()
  const ui = getUIState(boardId)
  if (!ui.timeTravelEvents) return c.body(null, 400)
  const pos = Math.max(0, Math.min(parseInt(body.position, 10) || 0, ui.timeTravelEvents.length - 1))
  ui.timeTravelPos = pos
  emitUI(boardId)
  return c.body(null, 204)
})

// Time travel: exit
app.post('/boards/:boardId/time-travel/exit', async (c) => {
  const boardId = c.req.param('boardId')
  const ui = getUIState(boardId)
  ui.timeTravelEvents = null
  ui.timeTravelAllEvents = null
  ui.timeTravelPos = -1
  emitUI(boardId)
  return c.body(null, 204)
})

// Client notifies SW of connection change (page online/offline events are more
// reliable than SW self.online/offline in some browsers / DevTools emulation)
app.post('/connection-change', async (c) => {
  notifyConnectionChange()
  return c.body(null, 204)
})

app.post('/boards/:boardId/select-mode', async (c) => {
  const boardId = c.req.param('boardId')
  const ui = getUIState(boardId)
  ui.selectionMode = true
  ui.selectedCards.clear()
  ui.activeCardSheet = null
  ui.editingCard = null
  ui.editingBoardTitle = false
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



// Debug: inspect event log (real-time)
app.get('/events', async (c) => {
  await initialize()
  const boardFilter = c.req.query('board') || ''
  const db = await dbPromise
  const boards = (await db.getAll('boards')).sort((a, b) => (a.title || '').localeCompare(b.title || ''))

  if (c.req.header('Datastar-Request') === 'true') {
    return streamSSE(c, async (stream) => {
      const pushEventList = async (selector, mode) => {
        const db = await dbPromise
        const allEvents = await annotateEventsWithBoardId(await db.getAll('events'))
        const boards = await db.getAll('boards')
        await stream.writeSSE(dsePatch(selector, <EventList events={allEvents} boardFilter={boardFilter} boards={boards} />, mode))
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

  return c.html('<!DOCTYPE html>' + (<EventsPage boards={boards} boardFilter={boardFilter} />).toString())
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
  // Let static assets fall through to network/cache.
  // The SW only serves HTML (Hono routes) and SSE streams — all other file
  // types (JS, CSS, images, manifest) are served by the host (Vite / GH Pages).
  if (/\.(js|css|png|svg|ico|woff2?|json|webmanifest)(\?.*)?$/.test(url.pathname)) return
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
