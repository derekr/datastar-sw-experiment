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

// Icons via CSS mask-image. CSS rules are generated at build time by @iconify/utils
// from @iconify-json/lucide and injected as __LUCIDE_ICON_CSS__. No JS needed.
// Usage: <Icon name="lucide:x" /> renders <span class="icon--lucide icon--lucide--x">
function Icon({ name, ...props }) {
  const iconName = name.startsWith('lucide:') ? name.slice(7) : name
  return <span class={`icon--lucide icon--lucide--${iconName}`} aria-hidden="true" {...props}></span>
}

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

// --- Docs topics ---

const DOCS_TOPICS = [
  { slug: 'core/hypermedia',    title: 'Hypermedia — The Missing Pattern', section: 'core' },
  { slug: 'core/event-sourcing', title: 'Event Sourcing & CQRS',          section: 'core' },
  { slug: 'core/sse-fat-morph', title: 'SSE & Fat Morphing',              section: 'core' },
  { slug: 'core/signals',       title: 'Signals & Server-Owned UI State', section: 'core' },
  { slug: 'core/mpa',          title: 'MPA Navigations',                section: 'core' },
  { slug: 'bonus/sw',           title: 'Service Worker as Server',         section: 'bonus' },
  { slug: 'bonus/indexeddb',    title: 'IndexedDB: Keeping It Light',    section: 'bonus' },
  { slug: 'bonus/fractional',   title: 'Fractional Indexing',            section: 'bonus' },
  { slug: 'bonus/local-first',  title: 'Local-First in the Browser',      section: 'bonus' },
  { slug: 'bonus/brotli',      title: 'Brotli Compression for SSE',     section: 'bonus' },
]

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
  performance?.mark('dsePatch-start')
  const html = flattenJsx(jsx)
  performance?.mark('dsePatch-render')
  const lines = [`mode ${mode}`, `selector ${selector}`]
  if (useViewTransition) lines.push('useViewTransition true')
  lines.push(`elements ${html}`)
  performance?.mark('dsePatch-end')
  performance?.measure('dsePatch', 'dsePatch-start', 'dsePatch-end')
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
          ><Icon name="lucide:x" /></button>
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
        <span class="card-select-checkbox">{isSelected ? <Icon name="lucide:square-check" /> : <Icon name="lucide:square" />}</span>
      )}
      <div class="card-content">
        <span class="card-title">{card.title}</span>
        {desc && <p class="card-desc">{desc}</p>}
      </div>
      {!isSelecting && !isReadOnly && (
        <div class="card-actions">
          <button
            class="card-edit-btn icon-btn"
            data-on:click={`@post('${base()}cards/${card.id}/edit')`}
            title="Edit"
          ><Icon name="lucide:pencil" /></button>
          {boardId && (
            <a
              class="card-expand-btn icon-btn"
              href={`${base()}boards/${boardId}/cards/${card.id}`}
              title="Open"
            ><Icon name="lucide:arrow-up-right" /></a>
          )}
          <button
            class="delete-btn icon-btn icon-btn--danger"
            data-on:click__viewtransition={`@delete('${base()}cards/${card.id}')`}
          >
            <Icon name="lucide:x" />
          </button>
        </div>
      )}
      {isEditing && (
        <form
          class="card-edit-form"
          data-on:submit__prevent={`@put('${base()}cards/${card.id}', {contentType: 'form'})`}
        >
          <div class="card-edit-inputs">
            <input name="title" type="text" value={card.title} placeholder="Title" autocomplete="off" />
            <textarea name="description" placeholder="Description (optional)" rows="2">{desc}</textarea>
          </div>
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
              ><Icon name="lucide:x" /></button>
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
            ><Icon name="lucide:arrow-left" /> Move left</button>
          )}
          {colIndex < columnCount - 1 && (
            <button
              class="action-sheet-btn"
              data-on:click={`@post('${base()}columns/${col.id}/sheet-move-right')`}
            >Move right <Icon name="lucide:arrow-right" /></button>
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
            class="col-delete-btn icon-btn icon-btn--danger"
            data-on:click__viewtransition={`@delete('${base()}columns/${col.id}')`}
          ><Icon name="lucide:x" /></button>
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
          <button type="submit"><Icon name="lucide:plus" /></button>
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
        ><Icon name="lucide:chevron-left" /></button>
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
        ><Icon name="lucide:chevron-right" /></button>
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
          <button class="help-overlay-close icon-btn" data-on:click={`@post('${base()}boards/${boardId}/help-dismiss')`}><Icon name="lucide:x" /></button>
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

  const TYPE_ICONS = { action: 'lucide:zap', board: 'lucide:layout-dashboard', card: 'lucide:tag', column: 'lucide:columns-3' }

  let flatIdx = 0
  return (
    <div id="command-menu" class="command-menu-backdrop" data-on:click={`if(window.revertTheme)revertTheme();@post('${base()}command-menu/close')`}>
      <div class="command-menu-panel" data-on:click__stop="void 0" data-signals={`{cmdIdx: 0, cmdCount: ${results.length}}`}>
        <form id="command-menu-form" data-on:submit__prevent="void 0">
          <div class="command-menu-input-wrap">
            <span class="command-menu-icon"><Icon name="lucide:search" /></span>
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
                            <span class="command-menu-type-icon">{TYPE_ICONS[r.type] ? <Icon name={TYPE_ICONS[r.type]} /> : ''}</span>
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
        {isEditingTitle
          ? <>
              <a id="board-back" href={base()} class="back-link board-back-title"><Icon name="lucide:arrow-left" /> {board.title}</a>
              <form
                id="board-title-form"
                class="board-title-form"
                data-on:submit__prevent={`@put('${base()}boards/${board.id}', {contentType: 'form'})`}
              >
                <input id="board-title-input" name="title" type="text" value={board.title} autocomplete="off" />
                <button type="submit" class="board-title-save">Save</button>
                <button type="button" class="board-title-cancel" data-on:click={`@post('${base()}boards/${board.id}/title-edit-cancel')`}>Cancel</button>
              </form>
            </>
          : <>
              <a id="board-back" href={base()} class="back-link board-back-title"><Icon name="lucide:arrow-left" /> {board.title}</a>
              {!isTimeTraveling && (
                <button
                  id="board-title-edit-btn"
                  class="board-title-edit-btn icon-btn"
                  data-on:click={`@post('${base()}boards/${board.id}/title-edit')`}
                  title="Edit board title"
                ><Icon name="lucide:pencil" /></button>
              )}
            </>
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
          <button type="submit"><Icon name="lucide:plus" /> Column</button>
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
        <a id="card-detail-back" href={`${base()}boards/${board.id}`} class="back-link"><Icon name="lucide:arrow-left" /> {board.title}</a>
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
        class="board-delete-btn icon-btn icon-btn--danger"
        data-on:click__prevent__viewtransition={`@delete('${base()}boards/${board.id}')`}
      ><Icon name="lucide:x" /></button>
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
          <button type="submit"><Icon name="lucide:plus" /> Board</button>
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
        <a href={`${base()}docs`} class="toolbar-btn"><Icon name="lucide:book-open" /> Docs</a>
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

/* Lucide icons via CSS mask-image (generated at build time by @iconify/utils) */
${__LUCIDE_ICON_CSS__}
.icon--lucide { vertical-align: -0.125em; }

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

/* ── Shared icon-only button ─────────────────────────── */
.icon-btn {
  background: none; border: none; color: var(--neutral-6); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 6px; border-radius: 4px; line-height: 1;
  font-size: var(--font-size--1);
  transition: color var(--anim-duration-fast), background var(--anim-duration-fast);
}
.icon-btn:hover { background: var(--neutral-5); color: var(--neutral-11); }
.icon-btn--danger:hover { color: var(--error-7); }

/* ── Boards list ─────────────────────────────────────── */

#boards-list {
  padding: clamp(12px, 4vw, 24px);
  max-width: 800px;
  margin: 0 auto;
}
#boards-list h1 {
  font-size: var(--font-size-2);
  font-weight: var(--font-weight-semi-bold);
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
  border-radius: var(--border-radius-2);
  position: relative;
  transition: border-color var(--anim-duration-fast);
}
.board-card:hover { border-color: var(--primary-7); }
.board-card-link {
  display: block;
  padding: clamp(14px, 3vw, 20px);
  text-decoration: none;
  color: inherit;
  cursor: pointer;
}
.board-card h2 { font-size: var(--font-size-0); font-weight: var(--font-weight-semi-bold); margin-bottom: 8px; }
.board-meta { font-size: var(--font-size--2); color: var(--neutral-7); display: flex; gap: 6px; flex-wrap: wrap; }

.board-delete-btn {
  position: absolute;
  top: 8px;
  right: 8px;
}

.board-new {
  background: transparent;
  border: var(--border-width-1) dashed var(--neutral-5);
  border-radius: var(--border-radius-2);
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
  border-radius: var(--border-radius-0);
  padding: 10px;
  color: var(--neutral-11);
  font-size: var(--font-size--1);
}
.board-new input::placeholder { color: var(--neutral-6); }
.board-new input:focus { outline: none; border-color: var(--primary-7); }
.board-new button {
  background: var(--primary-7);
  border: none;
  border-radius: var(--border-radius-0);
  color: #fff;
  padding: 10px 14px;
  cursor: pointer;
  font-size: var(--font-size--1);
  font-weight: var(--font-weight-semi-bold);
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
  border-radius: var(--border-radius-0);
  padding: 8px 16px;
  font-size: var(--font-size--1);
  cursor: pointer;
  text-decoration: none;
  transition: background var(--anim-duration-fast), color var(--anim-duration-fast);
}
.toolbar-btn:hover { background: var(--neutral-5); color: var(--neutral-11); }

/* ── Templates ───────────────────────────────────────── */

#templates-section {
  margin-top: clamp(24px, 4vw, 40px);
}
.templates-heading {
  font-size: var(--font-size--1);
  font-weight: var(--font-weight-medium);
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
  border-radius: var(--border-radius-2);
  text-decoration: none;
  color: inherit;
  cursor: pointer;
  transition: border-color var(--anim-duration-fast), background var(--anim-duration-fast);
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
  font-size: var(--font-size-2);
  line-height: 1;
}
.template-card-title {
  font-size: var(--font-size--1);
  font-weight: var(--font-weight-semi-bold);
  color: var(--neutral-11);
}
.template-card-desc {
  font-size: var(--font-size--2);
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
.board-back-title {
  font-size: var(--font-size-1);
  font-weight: var(--font-weight-semi-bold);
  color: var(--neutral-11);
}
.board-back-title:hover { color: var(--primary-7); text-decoration: none; }
.board-title-edit-btn { font-size: var(--font-size--2); padding: 4px; }
.board-title-edit-btn:hover { color: var(--primary-7); }
.board-title-form {
  display: flex;
  align-items: center;
  gap: 8px;
}
.board-title-form input {
  font-size: var(--font-size-2);
  font-weight: var(--font-weight-semi-bold);
  background: var(--neutral-3);
  border: 1px solid var(--neutral-6);
  border-radius: var(--border-radius-0);
  color: var(--neutral-11);
  padding: 2px 8px;
  min-width: 0;
  width: 20ch;
}
.board-title-save, .board-title-cancel {
  background: var(--neutral-5);
  color: var(--neutral-11);
  border: 1px solid var(--neutral-6);
  border-radius: var(--border-radius-0);
  padding: 4px 12px;
  font-size: var(--font-size--1);
  cursor: pointer;
}
.board-title-save:hover { background: var(--primary-7); border-color: var(--primary-7); }
.board-title-cancel:hover { background: var(--neutral-6); }
.back-link {
  color: var(--primary-7);
  text-decoration: none;
  font-size: var(--font-size--1);
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
  border-radius: var(--border-radius-2);
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
.column[data-kanban-dropping] { position: relative; z-index: 50; box-shadow: var(--shadow-4); }

.column-ghost {
  border: var(--border-width-1) dashed var(--primary-7);
  border-radius: var(--border-radius-2);
  background: color-mix(in oklch, var(--primary-7) 5%, transparent);
  flex-shrink: 0;
  box-sizing: border-box;
}

.column input, .column textarea { user-select: text; }

.column-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: var(--size--2);
  cursor: grab;
  -webkit-touch-callout: none;
}

.column-header:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--primary-7); border-radius: var(--border-radius-0); }

.column-header h2 {
  font-size: var(--font-size--2);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--neutral-8);
  font-weight: var(--font-weight-semi-bold);
  flex: 1;
}

/* col-delete-btn: positioning only — base styles from .icon-btn */

.count {
  font-size: var(--font-size--2);
  background: var(--neutral-5);
  color: var(--neutral-8);
  padding: 2px 8px;
  border-radius: var(--border-radius-1);
}

.cards-container {
  min-height: 48px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: var(--border-radius-0);
  padding: 4px;
  transition: background var(--anim-duration-fast), box-shadow var(--anim-duration-fast);
}

.empty {
  color: var(--neutral-6);
  font-size: var(--font-size--1);
  text-align: center;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: var(--border-radius-0);
}

/* Hide "No cards yet" when a drag ghost is in the same container */
.cards-container:has(.card-ghost) .empty { display: none; }

.card {
  background: var(--neutral-1);
  border: 1px solid var(--neutral-5);
  border-radius: var(--border-radius-0);
  padding: 10px 12px;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  cursor: grab;
  transition: border-color var(--anim-duration-fast);
  user-select: none;
  -webkit-touch-callout: none;
}

.card:hover { border-color: var(--neutral-6); }
.card:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--primary-7); }
.card[data-kanban-dragging],
.card[data-kanban-hold] { opacity: 0.5; z-index: 100; }
.card[data-kanban-dropping] { position: relative; z-index: 50; box-shadow: var(--shadow-4); }

.card--labeled { padding-top: 8px; }

.card-content { flex: 1; min-width: 0; }
.card-title { font-size: var(--font-size--1); word-break: break-word; }
.card-desc { font-size: var(--font-size--2); color: var(--neutral-8); margin: 4px 0 0; word-break: break-word; }
.card-actions { display: flex; align-items: center; gap: 0; flex-shrink: 0; margin-left: 4px; }

.card-edit-btn .icon--lucide { font-size: 0.85em; }
.card-edit-btn:hover { color: var(--primary-7); }

.card-edit-form {
  width: 100%; margin-top: 8px; display: flex; flex-direction: column; gap: var(--size-0);
}
.card-edit-inputs {
  display: flex; flex-direction: column; gap: 6px;
}
.card-edit-form input,
.card-edit-form textarea {
  background: var(--neutral-3); color: var(--neutral-11); border: 1px solid var(--neutral-5); border-radius: var(--border-radius-0);
  padding: 8px 10px; font-size: var(--font-size--1); font-family: inherit; resize: vertical;
}
.card-edit-form input:focus,
.card-edit-form textarea:focus { outline: none; border-color: var(--primary-7); }
.card-edit-actions { display: flex; gap: 6px; }
.card-edit-actions button {
  padding: 8px 14px; border-radius: var(--border-radius-0); border: 1px solid var(--neutral-5); cursor: pointer;
  font-size: var(--font-size--2); transition: background var(--anim-duration-fast);
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
  font-size: var(--font-size--2);
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
  transition: border-color var(--anim-duration-fast), transform var(--anim-duration-fast);
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
  font-size: var(--font-size--2);
  display: grid;
  place-items: center;
  transition: color var(--anim-duration-fast);
}
.label-swatch-clear:hover { color: var(--error-8); }

.card-ghost {
  border: var(--border-width-1) dashed var(--primary-7);
  border-radius: var(--border-radius-0);
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

.delete-btn { flex-shrink: 0; }

.add-form {
  display: flex;
  gap: 8px;
  margin-top: var(--size--2);
}

.add-form input {
  flex: 1;
  min-width: 0;
  background: var(--neutral-1);
  border: 1px solid var(--neutral-5);
  border-radius: var(--border-radius-0);
  padding: 10px;
  color: var(--neutral-11);
  font-size: var(--font-size--1);
}

.add-form input::placeholder { color: var(--neutral-6); }
.add-form input:focus { outline: none; border-color: var(--primary-7); }

.add-form button {
  background: var(--primary-7);
  border: none;
  border-radius: var(--border-radius-0);
  color: #fff;
  padding: 10px 14px;
  cursor: pointer;
  font-size: var(--font-size-0);
  font-weight: var(--font-weight-semi-bold);
  transition: background var(--anim-duration-fast);
}

.add-form button:hover { background: var(--primary-6); }

.add-col-form {
  display: flex;
  gap: 8px;
  margin-top: var(--size-0);
  padding: 0 clamp(8px, 2vw, 24px);
  flex-wrap: wrap;
}

.add-col-form input {
  background: var(--neutral-3);
  border: 1px solid var(--neutral-5);
  border-radius: var(--border-radius-0);
  padding: 10px 14px;
  color: var(--neutral-11);
  font-size: var(--font-size--1);
  flex: 1;
  min-width: 0;
}

.add-col-form input::placeholder { color: var(--neutral-6); }
.add-col-form input:focus { outline: none; border-color: var(--primary-7); }

.add-col-form button {
  background: var(--neutral-5);
  border: 1px solid var(--neutral-6);
  border-radius: var(--border-radius-0);
  color: var(--neutral-11);
  padding: 10px 16px;
  cursor: pointer;
  font-size: var(--font-size--1);
  font-weight: var(--font-weight-semi-bold);
  white-space: nowrap;
  transition: background var(--anim-duration-fast);
}

.add-col-form button:hover { background: var(--neutral-6); }

/* ── Select mode button ───────────────────────────── */

.tab-count {
  font-size: var(--font-size--2);
  color: var(--primary-7);
  background: color-mix(in oklch, var(--primary-7) 15%, transparent);
  padding: 2px 8px;
  border-radius: var(--border-radius-1);
  white-space: nowrap;
}
.tab-count--hidden { display: none; }

/* ── Status chip (offline / local / synced) ──────── */

.status-chip {
  font-size: var(--font-size--2);
  padding: 2px 8px;
  border-radius: var(--border-radius-1);
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
  border-radius: var(--border-radius-0);
  color: var(--neutral-8);
  padding: 4px 10px;
  font-size: var(--font-size--2);
  cursor: pointer;
  transition: background var(--anim-duration-fast), color var(--anim-duration-fast);
  white-space: nowrap;
}
.select-mode-btn:hover { background: var(--neutral-6); color: var(--neutral-11); }

/* ── Card selection checkbox ─────────────────────── */

.card-select-checkbox {
  background: none;
  border: none;
  font-size: var(--font-size-1);
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
  z-index: var(--zindex-dialog);
  animation: fade-in 150ms ease-out;
}
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }

.help-overlay {
  background: var(--neutral-3);
  border: 1px solid var(--neutral-5);
  border-radius: var(--border-radius-2);
  padding: var(--size-2);
  max-width: 420px;
  width: calc(100% - 32px);
  max-height: calc(100vh - 64px);
  overflow-y: auto;
  box-shadow: var(--shadow-6);
}

.help-overlay-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--size-0);
}
.help-overlay-title {
  font-size: var(--font-size-0);
  font-weight: var(--font-weight-semi-bold);
  color: var(--neutral-11);
}
.help-overlay-close { font-size: var(--font-size-1); color: var(--neutral-8); padding: 4px 8px; }

.help-section { margin-bottom: var(--size-0); }
.help-section:last-child { margin-bottom: 0; }
.help-section-title {
  font-size: var(--font-size--2);
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
  font-size: var(--font-size--1);
  color: var(--neutral-9);
}
.help-row kbd {
  background: var(--neutral-1);
  border: 1px solid var(--neutral-5);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: var(--font-size--2);
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
  z-index: var(--zindex-dropdown);
  animation: fade-in 150ms ease-out;
}

.command-menu-panel {
  background: var(--neutral-3);
  border: 1px solid var(--neutral-5);
  border-radius: var(--border-radius-2);
  width: min(520px, calc(100% - 32px));
  max-height: calc(100vh - 180px);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-6);
  overflow: hidden;
}

.command-menu-input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: var(--size--2) var(--size-0);
  border-bottom: 1px solid var(--neutral-5);
}

.command-menu-icon {
  color: var(--neutral-7);
  font-size: var(--font-size-1);
  flex-shrink: 0;
}

.command-menu-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--neutral-11);
  font-size: var(--font-size-0);
  font-family: inherit;
}
.command-menu-input::placeholder { color: var(--neutral-7); }

.command-menu-results {
  overflow-y: auto;
  padding-bottom: 4px;
}

.command-menu-section-header {
  padding: 8px var(--size-0) 4px;
  font-size: var(--font-size--2);
  font-weight: var(--font-weight-semi-bold);
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
  padding: 8px var(--size-0);
  cursor: pointer;
  color: var(--neutral-9);
  font-size: var(--font-size--1);
  gap: var(--size--2);
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
  font-size: var(--font-size--2);
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
  font-size: var(--font-size--2);
  flex-shrink: 0;
  white-space: nowrap;
}

.command-menu-empty,
.command-menu-hint {
  padding: var(--size-0);
  text-align: center;
  color: var(--neutral-7);
  font-size: var(--font-size--1);
}

/* ── Action sheet ────────────────────────────────── */

.action-sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: var(--zindex-drawer);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
}

.action-sheet {
  background: var(--neutral-3);
  border-radius: var(--border-radius-3) var(--border-radius-3) 0 0;
  padding: var(--size-0);
  padding-bottom: calc(var(--size-0) + env(safe-area-inset-bottom, 0px));
  width: 100%;
  max-width: 400px;
  max-height: 80vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* Slide up animation */
  animation: sheet-slide-up 200ms var(--anim-ease-emphasized);
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
  font-size: var(--font-size--1);
  font-weight: var(--font-weight-semi-bold);
  color: var(--neutral-11);
  word-break: break-word;
}

.action-sheet-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.action-sheet-label {
  font-size: var(--font-size--2);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--neutral-7);
  padding: 4px 0;
}

.action-sheet-btn {
  background: var(--neutral-1);
  border: 1px solid var(--neutral-5);
  border-radius: var(--border-radius-0);
  color: var(--neutral-11);
  padding: var(--size--2) var(--size-0);
  font-size: var(--font-size--1);
  cursor: pointer;
  text-align: left;
  transition: background var(--anim-duration-fast);
  min-height: 44px;
}
.action-sheet-btn:hover { background: var(--neutral-3); border-color: var(--neutral-6); }
.action-sheet-btn--danger { color: var(--error-8); }
.action-sheet-btn--danger:hover { background: var(--error-2); border-color: var(--error-4); }
.action-sheet-btn--cancel {
  background: var(--neutral-5);
  border-color: var(--neutral-6);
  text-align: center;
  font-weight: var(--font-weight-semi-bold);
  margin-top: 4px;
}
.action-sheet-btn--cancel:hover { background: var(--neutral-6); }

/* ── Selection bar (bottom action bar) ───────────── */

/* ── Time travel ──────────────────────────────────── */
.board--time-travel { opacity: 0.85; }
.time-travel-bar {
  background: var(--neutral-3);
  border: 1px solid var(--primary-7);
  border-radius: var(--border-radius-1);
  padding: var(--size--2) var(--size-0);
  margin-bottom: clamp(12px, 3vw, 24px);
}
.tt-header {
  display: flex;
  align-items: center;
  gap: var(--size--2);
  margin-bottom: 8px;
}
.tt-label {
  font-weight: var(--font-weight-semi-bold);
  font-size: var(--font-size--1);
  color: var(--primary-7);
}
.tt-info {
  flex: 1;
  font-size: var(--font-size--2);
  color: var(--neutral-8);
}
.tt-exit {
  background: var(--neutral-5);
  color: var(--neutral-11);
  border: 1px solid var(--neutral-6);
  border-radius: var(--border-radius-0);
  padding: 4px 12px;
  font-size: var(--font-size--2);
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
  border-radius: var(--border-radius-0);
  width: 36px;
  height: 28px;
  font-size: var(--font-size--1);
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
  font-size: var(--font-size--2);
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
  padding: var(--size--2) clamp(12px, 4vw, 24px);
  padding-bottom: calc(var(--size--2) + env(safe-area-inset-bottom, 0px));
  display: flex;
  align-items: center;
  gap: var(--size--2);
  z-index: 150;
  /* Slide up */
  animation: sheet-slide-up 200ms var(--anim-ease-emphasized);
}
.selection-bar-count {
  font-size: var(--font-size--1);
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
  border-radius: var(--border-radius-0);
  color: var(--neutral-11);
  padding: 8px 14px;
  font-size: var(--font-size--1);
  cursor: pointer;
  min-height: 44px;
  transition: background var(--anim-duration-fast);
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
  border-radius: var(--border-radius-0);
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 160px;
  box-shadow: var(--shadow-3);
  z-index: 160;
}
.column-picker-btn {
  background: none;
  border: none;
  color: var(--neutral-11);
  padding: 10px 12px;
  font-size: var(--font-size--1);
  cursor: pointer;
  border-radius: var(--border-radius-0);
  text-align: left;
  transition: background var(--anim-duration-fast);
  min-height: 44px;
}
.column-picker-btn:hover { background: var(--neutral-5); }

/* Extra bottom padding on board when selection bar is visible */
#board:has(.selection-bar) .columns { padding-bottom: 80px; }

/* MPA cross-document view transitions */
@view-transition { navigation: auto; }

::view-transition-group(*) {
  animation-duration: 200ms;
  animation-timing-function: var(--anim-ease-emphasized);
}
/* Default: named groups morph, everything else instant (no global crossfade) */
::view-transition-old(*) { animation: none; opacity: 0; }
::view-transition-new(*) { animation: none; }

/* Card expand/collapse — group morphs position+size,
   old/new crossfade so content swaps smoothly during resize */
::view-transition-group(card-expand) {
  animation-duration: 300ms;
  animation-timing-function: var(--anim-ease-emphasized);
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
  padding: var(--size-0);
}
.card-detail-header {
  margin-bottom: var(--size-1);
}
.card-detail-body {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: var(--size-2);
}
@media (max-width: 700px) {
  .card-detail-body {
    grid-template-columns: 1fr;
  }
}
.card-detail-main {
  display: flex;
  flex-direction: column;
  gap: var(--size-1);
}
.card-detail-label-bar {
  height: 4px;
  border-radius: 4px;
}
.card-detail-form {
  display: flex;
  flex-direction: column;
  gap: var(--size--2);
}
.card-detail-title-input {
  font-size: var(--font-size-2);
  font-weight: var(--font-weight-bold);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--border-radius-0);
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
  border-radius: var(--border-radius-0);
  color: var(--neutral-11);
  padding: 10px;
  font-size: var(--font-size-0);
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
  font-size: var(--font-size--2);
  font-weight: var(--font-weight-semi-bold);
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
  border-radius: var(--border-radius-0);
  border: 1px solid var(--neutral-5);
  background: var(--neutral-3);
  color: var(--neutral-11);
  cursor: pointer;
  font-size: var(--font-size--1);
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
  gap: var(--size-1);
}
.card-detail-meta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  font-size: var(--font-size--1);
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
  font-size: var(--font-size--2);
}
.card-detail-history-label {
  color: var(--neutral-11);
}
.card-detail-history-time {
  color: var(--neutral-7);
  font-size: var(--font-size--2);
}
.card-detail-empty {
  color: var(--neutral-7);
  font-size: var(--font-size--1);
}
.card-detail-danger {
  padding-top: var(--size--2);
  border-top: 1px solid var(--neutral-5);
}

/* card-expand-btn: base styles from .icon-btn */
.card-expand-btn { text-decoration: none; }

/* Generic button styles */
.btn {
  padding: 8px 18px;
  border: none;
  border-radius: var(--border-radius-0);
  cursor: pointer;
  font-size: var(--font-size--1);
  font-weight: var(--font-weight-medium);
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

// --- Docs CSS ---

const DOCS_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* Lucide icons via CSS mask-image */
${__LUCIDE_ICON_CSS__}
.icon--lucide { vertical-align: -0.125em; }

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background: var(--neutral-1);
  color: var(--neutral-11);
  min-height: 100dvh;
  -webkit-text-size-adjust: 100%;
}

/* ── Layout ──────────────────────────────────────── */

.docs-layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  min-height: 100dvh;
}

@media (max-width: 768px) {
  .docs-layout { grid-template-columns: 1fr; }
  .docs-sidebar { display: none; }
}

/* ── Sidebar ─────────────────────────────────────── */

.docs-sidebar {
  position: sticky;
  top: 0;
  height: 100dvh;
  overflow-y: auto;
  padding: var(--size-0) var(--size--1);
  border-right: 1px solid var(--neutral-4);
  background: var(--neutral-2);
}

.docs-sidebar-home {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--primary-7);
  text-decoration: none;
  font-size: var(--font-size--1);
  margin-bottom: var(--size-1);
}
.docs-sidebar-home:hover { text-decoration: underline; }

.docs-sidebar-overview { margin-bottom: var(--size--1); }

.docs-sidebar-section { margin-bottom: var(--size-0); }

.docs-sidebar-heading {
  font-size: var(--font-size--2);
  font-weight: var(--font-weight-semi-bold);
  color: var(--neutral-7);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.docs-sidebar-list { list-style: none; }
.docs-sidebar-list li { margin-bottom: 2px; }

.docs-sidebar-link {
  display: block;
  padding: 6px 10px;
  border-radius: var(--border-radius-0);
  color: var(--neutral-9);
  text-decoration: none;
  font-size: var(--font-size--1);
  transition: background var(--anim-duration-fast), color var(--anim-duration-fast);
}
.docs-sidebar-link:hover { background: var(--neutral-4); color: var(--neutral-11); }
.docs-sidebar-link--active {
  background: color-mix(in oklch, var(--primary-7) 15%, transparent);
  color: var(--primary-9);
  font-weight: var(--font-weight-medium);
}

/* ── Content ─────────────────────────────────────── */

.docs-content {
  max-width: 780px;
  padding: var(--size-2) var(--size-1);
  line-height: 1.7;
}

.docs-content h1 {
  font-size: var(--font-size-3);
  font-weight: var(--font-weight-bold);
  margin-bottom: var(--size--2);
  line-height: 1.2;
}

.docs-content h2 {
  font-size: var(--font-size-1);
  font-weight: var(--font-weight-semi-bold);
  margin-top: var(--size-2);
  margin-bottom: var(--size--1);
}

.docs-content h3 {
  font-size: var(--font-size-0);
  font-weight: var(--font-weight-semi-bold);
  margin-top: var(--size-1);
  margin-bottom: var(--size--2);
}

.docs-content p {
  margin-bottom: var(--size--1);
  color: var(--neutral-10);
}

.docs-content code {
  background: var(--neutral-3);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
}

.docs-content pre {
  background: var(--neutral-3);
  border: 1px solid var(--neutral-4);
  border-radius: var(--border-radius-1);
  padding: var(--size--1);
  overflow-x: auto;
  margin-bottom: var(--size--1);
  font-size: var(--font-size--2);
  line-height: 1.6;
}
.docs-content pre code { background: none; padding: 0; }

/* ── Hero (index page) ───────────────────────────── */

.docs-hero {
  margin-bottom: var(--size-2);
  padding-bottom: var(--size-1);
  border-bottom: 1px solid var(--neutral-4);
}
.docs-hero h1 {
  font-size: var(--font-size-4);
  margin-bottom: var(--size--1);
}
.docs-hero-sub {
  font-size: var(--font-size-0);
  color: var(--neutral-9);
  max-width: 600px;
}
.docs-hero-note {
  font-size: var(--font-size--1);
  color: var(--neutral-7);
  margin-top: var(--size--2);
  font-style: italic;
}

/* ── Content sections ────────────────────────────── */

.docs-section {
  margin-bottom: var(--size-2);
}
.docs-section h2 {
  font-size: var(--font-size-1);
  font-weight: var(--font-weight-semi-bold);
  margin-bottom: var(--size--1);
}
.docs-section h3 {
  font-size: var(--font-size-0);
  font-weight: var(--font-weight-semi-bold);
  margin-top: var(--size-1);
  margin-bottom: var(--size--2);
}
.docs-section p {
  margin-bottom: var(--size--1);
  color: var(--neutral-10);
  line-height: 1.7;
}
.docs-section code {
  background: var(--neutral-3);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
}

.docs-flow-list {
  list-style: none;
  counter-reset: flow;
  margin: var(--size-0) 0;
  display: flex;
  flex-direction: column;
  gap: var(--size--1);
}
.docs-flow-list li {
  counter-increment: flow;
  position: relative;
  padding-left: 2.5em;
  line-height: 1.7;
  color: var(--neutral-10);
}
.docs-flow-list li::before {
  content: counter(flow);
  position: absolute;
  left: 0;
  top: 0.15em;
  width: 1.8em;
  height: 1.8em;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in oklch, var(--primary-7) 15%, transparent);
  color: var(--primary-9);
  font-size: var(--font-size--2);
  font-weight: var(--font-weight-bold);
  border-radius: 50%;
}

/* ── Lists ───────────────────────────────────────── */

.docs-list {
  list-style: none;
  margin: var(--size-0) 0;
  display: flex;
  flex-direction: column;
  gap: var(--size--2);
}
.docs-list li {
  padding-left: 1.2em;
  position: relative;
  line-height: 1.7;
  color: var(--neutral-10);
}
.docs-list li::before {
  content: '—';
  position: absolute;
  left: 0;
  color: var(--neutral-6);
}

/* ── Event types grid ────────────────────────────── */

.docs-event-types {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--size--1);
  margin: var(--size-0) 0;
}
.docs-event-group {
  background: var(--neutral-3);
  border: 1px solid var(--neutral-4);
  border-radius: var(--border-radius-1);
  padding: var(--size--1) var(--size-0);
}
.docs-event-group h3 {
  font-size: var(--font-size--2);
  font-weight: var(--font-weight-semi-bold);
  color: var(--neutral-8);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}
.docs-event-group ul {
  list-style: none;
}
.docs-event-group li {
  font-size: var(--font-size--1);
  margin-bottom: 2px;
}

/* ── Table ───────────────────────────────────────── */

.docs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size--1);
  margin: var(--size-0) 0;
}
.docs-table th,
.docs-table td {
  padding: 6px var(--size--1);
  border-bottom: 1px solid var(--neutral-4);
  text-align: left;
}
.docs-table th {
  font-weight: var(--font-weight-semi-bold);
  color: var(--neutral-9);
  font-size: var(--font-size--2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.docs-table td code {
  font-size: var(--font-size--2);
}

/* ── Interactive Visualizations ───────────────────────── */

.docs-viz {
  border: 1px solid var(--neutral-4);
  border-radius: var(--radius-2);
  padding: var(--size-1);
  margin: var(--size-1) 0;
  background: var(--surface-1);
}

.docs-viz-flow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size--1);
  flex-wrap: wrap;
}

.docs-viz-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: var(--size--1);
  border-radius: var(--radius-1);
  background: var(--surface-2);
  border: 1px solid var(--neutral-4);
  min-width: 80px;
}

.docs-viz-node-title {
  font-weight: var(--font-weight-semi-bold);
  font-size: var(--font-size--2);
}

.docs-viz-node-desc {
  font-size: var(--font-size--2);
  color: var(--neutral-8);
}

.docs-viz-arrow {
  color: var(--primary-6);
  font-size: var(--font-size-1);
}

.docs-viz-zoom {
  margin-top: var(--size--1);
  padding-top: var(--size--1);
  border-top: 1px solid var(--neutral-4);
}

.docs-viz-zoom summary {
  font-size: var(--font-size--1);
  color: var(--neutral-8);
  cursor: pointer;
  user-select: none;
}

.docs-viz-zoom[open] summary {
  margin-bottom: var(--size--1);
}

.docs-viz-zoom-content {
  padding: var(--size--1);
  background: var(--surface-3);
  border-radius: var(--radius-1);
  font-size: var(--font-size--1);
}

.docs-viz-step {
  display: flex;
  align-items: flex-start;
  gap: var(--size--1);
  margin-bottom: var(--size--2);
}

.docs-viz-step-num {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--primary-6);
  color: var(--primary-6-on);
  font-size: var(--font-size--2);
  font-weight: var(--font-weight-semi-bold);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.docs-viz-step-content {
  flex: 1;
}

/* ── TOC grid ────────────────────────────────────── */

.docs-toc-section { margin-bottom: var(--size-2); }
.docs-toc-section h2 {
  font-size: var(--font-size-1);
  font-weight: var(--font-weight-semi-bold);
  margin-bottom: 6px;
}
.docs-toc-intro {
  font-size: var(--font-size--1);
  color: var(--neutral-8);
  margin-bottom: var(--size-0);
}

.docs-toc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--size--1);
}

.docs-toc-card {
  display: block;
  padding: var(--size--1) var(--size-0);
  background: var(--neutral-3);
  border: 1px solid var(--neutral-4);
  border-radius: var(--border-radius-1);
  text-decoration: none;
  color: var(--neutral-11);
  transition: border-color var(--anim-duration-fast), background var(--anim-duration-fast);
}
.docs-toc-card:hover { border-color: var(--primary-7); background: var(--neutral-4); }
.docs-toc-card h3 { font-size: var(--font-size--1); font-weight: var(--font-weight-medium); margin: 0; }
.docs-toc-num {
  display: inline-block;
  font-size: var(--font-size--2);
  font-weight: var(--font-weight-bold);
  color: var(--primary-7);
  margin-bottom: 4px;
}

.docs-toc-card--bonus {
  border-style: dashed;
  background: var(--neutral-2);
}
.docs-toc-card--bonus:hover { background: var(--neutral-3); }

/* ── Badge ───────────────────────────────────────── */

.docs-badge {
  display: inline-block;
  font-size: var(--font-size--2);
  padding: 2px 10px;
  border-radius: 999px;
  font-weight: var(--font-weight-medium);
  margin-bottom: var(--size--1);
}
.docs-badge--bonus {
  background: color-mix(in oklch, var(--secondary-7) 15%, transparent);
  color: var(--secondary-9);
}

/* ── Stub ────────────────────────────────────────── */

.docs-stub {
  padding: var(--size-1);
  background: var(--neutral-3);
  border: 1px dashed var(--neutral-5);
  border-radius: var(--border-radius-1);
  color: var(--neutral-8);
  margin: var(--size-0) 0;
}

/* ── Pager ────────────────────────────────────────── */

.docs-pager {
  display: flex;
  justify-content: space-between;
  margin-top: var(--size-2);
  padding-top: var(--size-0);
  border-top: 1px solid var(--neutral-4);
}
.docs-pager-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--primary-7);
  text-decoration: none;
  font-size: var(--font-size--1);
}
.docs-pager-link:hover { text-decoration: underline; }
.docs-pager-next { margin-left: auto; }
`

// --- Events debug page ---

const EVENTS_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* Lucide icons via CSS mask-image */
${__LUCIDE_ICON_CSS__}
.icon--lucide { vertical-align: -0.125em; }

body {
  font-family: 'Inconsolata', ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace;
  background: var(--neutral-1);
  color: var(--neutral-11);
  padding: clamp(12px, 4vw, 24px);
  min-height: 100dvh;
  font-size: var(--font-size--1);
}

a { color: var(--primary-8); }

h1 { font-size: var(--font-size-1); font-weight: var(--font-weight-semi-bold); margin-bottom: var(--size-0); display: flex; align-items: center; gap: var(--size--2); }
h1 span { font-size: var(--font-size--2); color: var(--neutral-7); font-weight: var(--font-weight-normal); }

.event-list { display: flex; flex-direction: column; gap: 2px; }

details {
  background: var(--neutral-3);
  border-radius: var(--border-radius-0);
  border: 1px solid var(--neutral-5);
  transition: border-color var(--anim-duration-fast);
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
  font-size: var(--font-size--2);
  transition: transform var(--anim-duration-fast);
  flex-shrink: 0;
}

details[open] summary::before { transform: rotate(90deg); }

.seq { color: var(--neutral-6); min-width: 3ch; text-align: right; }
.type { color: var(--primary-8); font-weight: var(--font-weight-semi-bold); font-size: 0.8em; }
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

.actions { display: flex; gap: 8px; margin-bottom: var(--size-0); }

.actions button {
  background: var(--neutral-5);
  border: 1px solid var(--neutral-6);
  border-radius: var(--border-radius-0);
  color: var(--neutral-11);
  padding: 6px 12px;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.85em;
  transition: background var(--anim-duration-fast);
}

.actions button:hover { background: var(--neutral-6); }
.actions button:disabled { opacity: 0.5; cursor: wait; }

.board-filter {
  background: var(--neutral-5);
  border: 1px solid var(--neutral-6);
  border-radius: var(--border-radius-0);
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

// --- Docs pages ---

function DocsShell({ title, children }) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        <meta id="theme-color-meta" name="theme-color" content="#121017" />
        <link rel="manifest" href={`${base()}manifest.json`} />
        <link rel="icon" href={`${base()}icon.svg`} type="image/svg+xml" />
        <script>{raw(`(function(){var t=localStorage.getItem('theme')||'system';var dark=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.dataset.theme=dark?'dark':'light';var m=document.getElementById('theme-color-meta');if(m)m.content=dark?'#121017':'#f4eefa'})()`)}</script>
        <link rel="preload" href="https://fonts.bunny.net/inter/files/inter-latin-100-normal.woff2" as="font" type="font/woff2" crossorigin />
        <link rel="preload" href="https://fonts.bunny.net/inter/files/inter-latin-900-normal.woff2" as="font" type="font/woff2" crossorigin />
        <link rel="stylesheet" href={`${base()}${__STELLAR_CSS__}`} />
        <title>{title ? `${title} — Docs` : 'Docs'}</title>
        <style>{raw(CSS)}{raw(DOCS_CSS)}</style>
        <script
          type="module"
          src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.8/bundles/datastar.js"
        ></script>
      </head>
      <body>
        {children}
        <script>{raw(`
navigator.serviceWorker?.addEventListener('controllerchange',function(){location.reload()});
document.addEventListener('keydown',function(e){
  if((e.metaKey||e.ctrlKey)&&e.key==='k'){
    e.preventDefault();
    fetch('${base()}command-menu/open',{method:'POST',headers:{'X-Context':location.pathname}});
  }
  if(e.key==='Escape'&&document.getElementById('command-menu')){
    e.preventDefault();
    fetch('${base()}command-menu/close',{method:'POST'});
  }
});
var _lastCmd=false;
new MutationObserver(function(){
  var cm=document.getElementById('command-menu');
  if(cm&&!_lastCmd){var inp=document.getElementById('command-menu-input');if(inp)inp.focus()}
  _lastCmd=!!cm;
}).observe(document.body,{childList:true,subtree:true});
`)}</script>
      </body>
    </html>
  )
}

function DocsSidebar({ currentSlug }) {
  const core = DOCS_TOPICS.filter(t => t.section === 'core')
  const bonus = DOCS_TOPICS.filter(t => t.section === 'bonus')
  return (
    <nav class="docs-sidebar" id="docs-sidebar">
      <a href={base()} class="docs-sidebar-home"><Icon name="lucide:arrow-left" /> Back to app</a>
      <a href={`${base()}docs`} class={`docs-sidebar-link docs-sidebar-overview${!currentSlug ? ' docs-sidebar-link--active' : ''}`}>Overview</a>
      <div class="docs-sidebar-section">
        <h3 class="docs-sidebar-heading">Core Concepts</h3>
        <ul class="docs-sidebar-list">
          {core.map(t => (
            <li><a href={`${base()}docs/${t.slug}`} class={`docs-sidebar-link${currentSlug === t.slug ? ' docs-sidebar-link--active' : ''}`}>{t.title}</a></li>
          ))}
        </ul>
      </div>
      <div class="docs-sidebar-section">
        <h3 class="docs-sidebar-heading">Bonus</h3>
        <ul class="docs-sidebar-list">
          {bonus.map(t => (
            <li><a href={`${base()}docs/${t.slug}`} class={`docs-sidebar-link${currentSlug === t.slug ? ' docs-sidebar-link--active' : ''}`}>{t.title}</a></li>
          ))}
        </ul>
      </div>
    </nav>
  )
}

// DocsPage: full HTML page wrapper (initial load only — NOT for SSE pushes)
// #docs-app is just the morph target; the grid lives on DocsInner.
function DocsPage({ title, sseUrl, children }) {
  return (
    <DocsShell title={title}>
      <div id="docs-app" data-init={`@get('${base()}${sseUrl}', { retry: 'always', retryMaxCount: 1000 })`}>
        {children}
      </div>
    </DocsShell>
  )
}

// DocsInner: SSE-pushable content wrapper (sidebar + article + command menu).
// This is the grid container. One SSE connection per page handles both
// global UI events (command menu/theme) and page-specific events (interactive
// examples) — same pattern as board pages.
function DocsInner({ topic, commandMenu, children }) {
  return (
    <div id="docs-page" class="docs-layout">
      <DocsSidebar currentSlug={topic?.slug} />
      <article class="docs-content" id="docs-content">
        {children}
      </article>
      {commandMenu && (
        <CommandMenu query={commandMenu.query} results={commandMenu.results || []} />
      )}
    </div>
  )
}

// DocsIndexContent: index page article content (SSE-pushable)
function DocsIndexContent({ commandMenu }) {
  const core = DOCS_TOPICS.filter(t => t.section === 'core')
  const bonus = DOCS_TOPICS.filter(t => t.section === 'bonus')
  return (
    <DocsInner commandMenu={commandMenu}>
      <div class="docs-hero">
        <h1>How This App Works</h1>
        <p class="docs-hero-sub">An interactive guide to building a server-driven kanban board with <strong>Datastar</strong> and event sourcing.</p>
        <p class="docs-hero-note">This is a real app — the docs you're reading are served by the same server that runs the kanban board. Interactive examples are hooked up to the live event store.</p>
      </div>

      <section class="docs-section" id="big-picture">
        <h2>The Big Picture</h2>
        <p>Most web apps split work between a client-side framework and a server. This app keeps things simple: the <strong>server owns all state and all rendering</strong>. It runs Hono for routing, renders JSX into HTML, persists data to a database, and pushes UI updates over SSE. The browser tab is just a thin shell that receives HTML and morphs it into the DOM.</p>

        <p>Every user action follows the same loop:</p>

        <ol class="docs-flow-list" id="flow-steps">
          <li><strong>Client sends an action</strong> — a button click, form submit, or drag-drop fires a <code>POST</code>/<code>PUT</code>/<code>DELETE</code> to a Hono route on the server.</li>
          <li><strong>Server writes event(s)</strong> — the route handler appends one or more immutable events to the event log. Events are facts: <code>card.created</code>, <code>column.moved</code>, <code>card.labelChanged</code>.</li>
          <li><strong>Server rebuilds projection</strong> — the event is applied to an in-memory projection (the current state of boards, columns, cards). This is the "read model" in CQRS terms.</li>
          <li><strong>Bus notifies SSE streams</strong> — the route emits a topic on the in-memory event bus (<code>board:&lt;id&gt;</code>). Every open SSE connection subscribed to that topic wakes up.</li>
          <li><strong>SSE pushes a full HTML morph</strong> — each SSE handler reads the latest projection, renders the entire board as JSX, and sends it as a Datastar <code>datastar-patch-elements</code> event.</li>
          <li><strong>Datastar morphs the DOM</strong> — the client-side Datastar library receives the HTML and uses Idiomorph to efficiently diff and patch the live DOM. No virtual DOM, no hydration — just HTML in, DOM out.</li>
        </ol>

        <p>That's the whole architecture. No REST API returning JSON. No virtual DOM diffing or client-side component rendering. No <code>useState</code> or <code>createSignal</code>. The server owns the state, renders the HTML, and pushes it to every connected tab.</p>

        <h3>Why this works</h3>
        <p>This pattern — sometimes called "HTML-over-the-wire" — trades client-side complexity for server-side simplicity. The server already knows the full state, so it can render exactly the right HTML. The client doesn't need to reconcile, cache, or invalidate anything. It just displays what it receives.</p>
        <p>Datastar leverages SSE as its primary transport — anything you can do with request/response, you can do over SSE with Datastar. It uses Idiomorph to efficiently morph the DOM (preserving focus, scroll position, and CSS transitions), and provides a lightweight signal system for the small amount of client-to-server communication that forms need.</p>

        <h3>A note on this demo</h3>
        <p>In this app, the "server" happens to be a service worker running in your browser — which means you can use it offline and everything stays on your device. But the Datastar patterns are identical to what you'd use with Go, Python, Node, or any other backend. The service worker is an implementation detail; the architecture is the lesson.</p>
      </section>

      <section class="docs-section" id="further-reading">
        <h2>Further Reading</h2>
        <ul class="docs-list">
          <li><a href="https://zweiundeins.gmbh/en/methodology/spa-vs-hypermedia-real-world-performance-under-load" style="color: var(--primary-7)">SPA vs. Hypermedia: Real-World Performance Under Load</a> — zwei und eins built the same AI chat app as both an SPA (Next.js) and a Datastar hypermedia app, then benchmarked under Slow 4G + CPU throttling. The hypermedia version scored 100/100 Lighthouse performance (vs. 54), was 7.5× faster to interactive, had 0ms total blocking time, and transferred 26× less data. Their SSE compression numbers (58.5× Brotli ratio on persistent streams) validate the fat morph approach used in this app.</li>
        </ul>
      </section>

      <section class="docs-toc-section" id="topics">
        <h2>Core Concepts</h2>
        <p class="docs-toc-intro">These are the Datastar patterns that make this app tick.</p>
        <div class="docs-toc-grid">
          {core.map((t, i) => (
            <a href={`${base()}docs/${t.slug}`} class="docs-toc-card">
              <span class="docs-toc-num">{i + 1}</span>
              <h3>{t.title}</h3>
            </a>
          ))}
        </div>
      </section>

      <section class="docs-toc-section">
        <h2>Bonus</h2>
        <p class="docs-toc-intro">Implementation choices that aren't Datastar-specific — included because they're interesting or educational.</p>
        <div class="docs-toc-grid">
          {bonus.map(t => (
            <a href={`${base()}docs/${t.slug}`} class="docs-toc-card docs-toc-card--bonus">
              <h3>{t.title}</h3>
            </a>
          ))}
        </div>
      </section>
    </DocsInner>
  )
}

// DocsPager: prev/next navigation for topic pages
function DocsPager({ topic }) {
  const idx = DOCS_TOPICS.findIndex(t => t.slug === topic.slug)
  const prev = idx > 0 ? DOCS_TOPICS[idx - 1] : null
  const next = idx < DOCS_TOPICS.length - 1 ? DOCS_TOPICS[idx + 1] : null
  return (
    <nav class="docs-pager">
      {prev ? <a href={`${base()}docs/${prev.slug}`} class="docs-pager-link docs-pager-prev"><Icon name="lucide:arrow-left" /> {prev.title}</a> : <span />}
      {next ? <a href={`${base()}docs/${next.slug}`} class="docs-pager-link docs-pager-next">{next.title} <Icon name="lucide:arrow-right" /></a> : <span />}
    </nav>
  )
}

// DocsTopicStubContent: placeholder for topics not yet written
function DocsTopicStubContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>
      {topic.section === 'bonus' && <span class="docs-badge docs-badge--bonus">Bonus</span>}
      <div class="docs-stub">
        <p>This section is coming soon.</p>
      </div>
      <DocsPager topic={topic} />
    </DocsInner>
  )
}

// --- Topic content components ---

function DocsEventSourcingContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>

      <section class="docs-section">
        <p>Every mutation in this app is recorded as an immutable <strong>event</strong> — a fact about something that happened. Events are never updated or deleted. The current state of the board is derived by replaying these events in order.</p>
        <p>This is <strong>event sourcing</strong>: the event log is the source of truth, and the visible UI is a projection built from it.</p>
      </section>

      <section class="docs-section">
        <h2>What an event looks like</h2>
        <p>Every event has the same shape:</p>
        <pre><code>{`{
  id:            "a1b2c3...",       // unique ID (UUID)
  type:          "card.created",    // what happened
  v:             1,                 // schema version
  data: {                           // type-specific payload
    id:          "d4e5f6...",
    columnId:    "g7h8i9...",
    title:       "Buy groceries",
    position:    "a0"
  },
  ts:            1709654321000,     // when (epoch ms)
  actorId:       "j0k1l2...",       // which device
  correlationId: "m3n4o5...",       // links related events
  causationId:   null               // what caused this event
}`}</code></pre>
        <p>The <code>type</code> says what happened. The <code>data</code> carries the minimum payload needed to apply the change. The metadata fields (<code>actorId</code>, <code>correlationId</code>, <code>causationId</code>) exist for debugging and future sync — they're not used by the projection logic.</p>
      </section>

      <section class="docs-section">
        <h2>The event types</h2>
        <p>The app uses 12 event types across three entities:</p>
        <div class="docs-event-types">
          <div class="docs-event-group">
            <h3>Board</h3>
            <ul>
              <li><code>board.created</code></li>
              <li><code>board.titleUpdated</code></li>
              <li><code>board.deleted</code></li>
            </ul>
          </div>
          <div class="docs-event-group">
            <h3>Column</h3>
            <ul>
              <li><code>column.created</code></li>
              <li><code>column.moved</code></li>
              <li><code>column.deleted</code></li>
            </ul>
          </div>
          <div class="docs-event-group">
            <h3>Card</h3>
            <ul>
              <li><code>card.created</code></li>
              <li><code>card.moved</code></li>
              <li><code>card.titleUpdated</code></li>
              <li><code>card.descriptionUpdated</code></li>
              <li><code>card.labelUpdated</code></li>
              <li><code>card.deleted</code></li>
            </ul>
          </div>
        </div>
        <p>Each type is a past-tense fact. Not "create card" (a command) but <code>card.created</code> (something that already happened). This distinction matters: commands can be rejected, but events are already true.</p>
      </section>

      <section class="docs-section">
        <h2>Commands write events</h2>
        <p>User actions hit command routes — <code>POST</code>, <code>PUT</code>, or <code>DELETE</code> endpoints on the server. Each route does three things:</p>
        <ol class="docs-flow-list">
          <li><strong>Creates event(s)</strong> — one or more events describing what happened.</li>
          <li><strong>Appends to the log</strong> — events are persisted to the event store in a single transaction.</li>
          <li><strong>Returns 204</strong> — no body. The client doesn't need a response because the SSE stream will push the updated UI.</li>
        </ol>
        <p>For example, creating a new board appends four events in one batch: one <code>board.created</code> and three <code>column.created</code> events (for the default columns). They share a <code>correlationId</code> so they can be traced as a unit.</p>
        <pre><code>{`// POST /boards — simplified
const boardEvt = createEvent('board.created', { id, title, createdAt })
const colEvents = ['To Do', 'In Progress', 'Done'].map((title, i) =>
  createEvent('column.created', { id: uuid(), title, boardId: id, position: ... },
    { correlationId: boardEvt.correlationId, causationId: boardEvt.id })
)
await appendEvents([boardEvt, ...colEvents])
return c.body(null, 204)`}</code></pre>
      </section>

      <section class="docs-section">
        <h2>CQRS: reads and writes are separate</h2>
        <p>This is the CQRS pattern — <strong>Command Query Responsibility Segregation</strong>. The write side (command routes) and the read side (SSE handlers) use different models:</p>
        <ul class="docs-list">
          <li><strong>Write side:</strong> command routes append events to the log. They don't read the projection to build a response — they just return 204.</li>
          <li><strong>Read side:</strong> SSE handlers read from the projection (the derived state) and render full HTML. They never write events.</li>
        </ul>
        <p>The projection is the "read model" — three database tables (<code>boards</code>, <code>columns</code>, <code>cards</code>) that hold the current state. When an event is appended, <code>applyEvent</code> updates these tables as a side effect of the write. The SSE handlers just read whatever's there.</p>

        <details class="docs-viz">
          <summary>View the data flow</summary>
          <div class="docs-viz-flow">
            <div class="docs-viz-node"><span class="docs-viz-node-title">Client</span><span class="docs-viz-node-desc">POST /cards</span></div>
            <span class="docs-viz-arrow">→</span>
            <div class="docs-viz-node"><span class="docs-viz-node-title">Server</span><span class="docs-viz-node-desc">write event</span></div>
            <span class="docs-viz-arrow">→</span>
            <div class="docs-viz-node"><span class="docs-viz-node-title">IDB</span><span class="docs-viz-node-desc">events + projection</span></div>
            <span class="docs-viz-arrow">→</span>
            <div class="docs-viz-node"><span class="docs-viz-node-title">SSE</span><span class="docs-viz-node-desc">push morph</span></div>
            <span class="docs-viz-arrow">→</span>
            <div class="docs-viz-node"><span class="docs-viz-node-title">Browser</span><span class="docs-viz-node-desc">update UI</span></div>
          </div>
        </details>
      </section>

      <section class="docs-section">
        <h2>Projections: deriving state from events</h2>
        <p>The <code>applyEvent</code> function is a big switch on the event type. Each case makes the smallest possible mutation to the projection:</p>
        <pre><code>{`function applyEvent(event, tx) {
  const { type, data } = upcast(event)
  switch (type) {
    case 'card.created':
      tx.objectStore('cards').put(data)
      break
    case 'card.moved':
      // read card, update columnId + position, write back
      break
    case 'board.deleted':
      // delete board, cascade-delete all columns and cards
      break
    // ... 9 more cases
  }
}`}</code></pre>
        <p>The projection can always be rebuilt from scratch by clearing the tables and replaying every event. The <code>rebuildProjection</code> function does exactly this — it's used for migrations and available as a debug tool.</p>
      </section>

      <section class="docs-section">
        <h2>Snapshots</h2>
        <p>Replaying thousands of events on every page load would be slow. After a full rebuild, the app saves a <strong>snapshot</strong> — a copy of all three projection tables plus the sequence number of the last event.</p>
        <p>On the next startup, it restores the snapshot and only replays events that arrived after it. This makes initialization fast regardless of how large the event log grows.</p>
      </section>

      <section class="docs-section">
        <h2>Upcasting: evolving the schema</h2>
        <p>Events are immutable, but schemas evolve. When the app added multi-board support, existing <code>column.created</code> events didn't have a <code>boardId</code> field. Rather than migrating old events, an <strong>upcaster</strong> transforms them on the fly:</p>
        <pre><code>{`const upcasters = {
  'column.created': {
    1: (e) => ({
      ...e,
      v: 2,
      data: { ...e.data, boardId: e.data.boardId || 'default' }
    }),
  },
}`}</code></pre>
        <p>When <code>applyEvent</code> encounters a v1 <code>column.created</code>, the upcaster promotes it to v2 by adding the missing field. The upcasted version is persisted back so it only transforms once. Upcasters chain — if v3 is defined later, a v1 event would go v1 → v2 → v3.</p>
      </section>

      <section class="docs-section">
        <h2>What you get for free</h2>
        <p>Because the event log is the source of truth, several features come almost for free:</p>
        <ul class="docs-list">
          <li><strong>Undo/redo</strong> — record inverse events, append them to undo. The projection updates, SSE pushes the result.</li>
          <li><strong>Time travel</strong> — replay events up to a specific point to see the board at any moment in history.</li>
          <li><strong>Export/import</strong> — the event log is the entire dataset. Export it as JSON, import it on another device.</li>
          <li><strong>Audit trail</strong> — every change is recorded with a timestamp, actor, and causal chain.</li>
          <li><strong>Multi-tab sync</strong> — multiple tabs share the same event log. The bus notifies all SSE streams, so every tab stays in sync.</li>
        </ul>
      </section>

      <DocsPager topic={topic} />
    </DocsInner>
  )
}

function DocsFatMorphingContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>

      <section class="docs-section">
        <p>When the server handles a mutation, it renders the <strong>entire updated UI</strong> as HTML and <strong>pushes it to every connected client over SSE</strong>. Datastar receives the HTML and uses Idiomorph to efficiently patch the live DOM. This is called <strong>fat morphing</strong> — every push contains the full UI, not a diff.</p>
        <p>This is the core Datastar pattern: the server decides what the UI looks like, and the client just displays it.</p>
      </section>

      <section class="docs-section">
        <h2>Establishing the connection</h2>
        <p>Every page has a morph target — a container element with a <code>data-init</code> attribute that opens an SSE stream:</p>
        <pre><code>{`<main id="app"
  data-init="@get('/boards/abc123', { retry: 'always', retryMaxCount: 1000 })">
  <!-- pre-rendered content here -->
</main>`}</code></pre>
        <p>When Datastar initializes, it sees <code>@get()</code> and opens a persistent SSE connection to that URL. The <code>retry: 'always'</code> option tells Datastar to reconnect if the stream drops. The server keeps this connection open indefinitely, pushing updates whenever state changes.</p>
      </section>

      <section class="docs-section">
        <h2>What the server sends</h2>
        <p>Each SSE push is a <code>datastar-patch-elements</code> event containing a CSS selector, a mode, and a block of HTML:</p>
        <pre><code>{`event: datastar-patch-elements
data: mode outer
data: selector #board
data: useViewTransition true
data: elements <div id="board" class="board">...</div>`}</code></pre>
        <p>The <code>selector</code> identifies which DOM element to update. The <code>mode</code> controls how — <code>outer</code> replaces the element itself (including its tag), <code>inner</code> replaces only its children. The <code>elements</code> field contains the full HTML to morph in.</p>
        <p>The selector can target anything: <code>body</code> is the happy path for full-page morphs, or specific containers like <code>#app</code>, <code>#header</code>, <code>#board</code>. You can also morph individual elements like a status indicator or pager. The goal is simple and predictable fat morphs.</p>
        <p>Beyond HTML morphs, you can also <strong>morph signals</strong> for fine-grained updates — changing a single value without touching the DOM. This is useful for status icons, badges, or driving client-side heavy things like 3D scenes.</p>
        <p>This approach — sending full HTML over SSE with Brotli compression — is what makes fat morphs production-viable. A 15KB morph compresses to ~3KB, making it competitive with delta/diff approaches. A <a href="https://zweiundeins.gmbh/en/methodology/spa-vs-hypermedia-real-world-performance-under-load" style="color: var(--primary-7)">2026 benchmark</a> showed Brotli achieving 58.5× compression on a persistent SSE stream over a 10-turn conversation — the repetitive structure of HTML morphs is ideal for streaming compression. See <a href={base() + 'docs/bonus/brotli'}>Brotli Compression</a> for details.</p>
        <p>On the server, a helper function handles the formatting:</p>
        <pre><code>{`function dsePatch(selector, jsx, mode = 'outer', opts) {
  return {
    event: 'datastar-patch-elements',
    data: \`mode \${mode}\\nselector \${selector}\\nelements \${jsx.toString()}\`
  }
}

// Usage in an SSE handler:
await stream.writeSSE(dsePatch('#board', <Board ... />, 'outer'))`}</code></pre>
      </section>

      <section class="docs-section">
        <h2>Fat morphs: re-render everything</h2>
        <p>Every SSE push sends the <strong>complete UI for the morph target</strong> — the entire board with all its columns and cards, not just the piece that changed. This sounds wasteful, but it's the key simplification:</p>
        <ul class="docs-list">
          <li><strong>No partial updates</strong> — the server doesn't need to track what changed or compute diffs. It just reads the current state and renders.</li>
          <li><strong>No client-side state sync</strong> — the client doesn't maintain a model of the data. Every push is the full truth.</li>
          <li><strong>Correctness by default</strong> — any state the server knows about is reflected in the push. Nothing can drift out of sync.</li>
        </ul>
        <p>This works because Idiomorph is fast. Morphing a full board (~100 DOM nodes) against a nearly-identical new version takes under 1ms. The network cost is also minimal — a full board is 5-15KB of HTML, sent over an already-open connection with no HTTP overhead.</p>
      </section>

      <section class="docs-section">
        <h2>Idiomorph: smart DOM patching</h2>
        <p>Datastar uses <a href="https://github.com/bigskysoftware/idiomorph" style="color: var(--primary-7)">Idiomorph</a> to morph the DOM. Unlike innerHTML replacement, Idiomorph diffs the old and new HTML trees and makes the minimum DOM mutations needed. This preserves:</p>
        <ul class="docs-list">
          <li><strong>Focus</strong> — if an input is focused, it stays focused after the morph.</li>
          <li><strong>Scroll position</strong> — scrollable containers keep their position.</li>
          <li><strong>CSS transitions</strong> — elements that moved get animated via view transitions.</li>
          <li><strong>Form state</strong> — unsaved input values survive the morph.</li>
        </ul>
        <p>Idiomorph matches elements by <code>id</code> first, then by tag and position. This is why <strong>stable <code>id</code> attributes matter</strong>: without them, Idiomorph uses heuristic matching that can fail when siblings are added or removed.</p>
        <pre><code>{`// Every card gets a stable id for Idiomorph matching
<div id={\`card-\${card.id}\`} class="card" data-card-id={card.id}>
  ...
</div>`}</code></pre>
      </section>

      <section class="docs-section">
        <h2>Initial load vs. SSE pushes</h2>
        <p>Every route serves two purposes: the initial HTML page load and the SSE stream. The server distinguishes them with a header:</p>
        <pre><code>{`app.get('/boards/:boardId', async (c) => {
  // Datastar @get() sets this header on SSE requests
  if (c.req.header('Datastar-Request') === 'true') {
    return streamSSE(c, async (stream) => {
      // Push initial state, then listen for changes
      await push('#app', 'inner')
      bus.addEventListener('board:\${boardId}:changed', handler)
      while (!stream.closed) { await stream.sleep(30000) }
    })
  }
  // Normal browser navigation — return full HTML document
  return c.html('<!DOCTYPE html>' + (<Shell><Board ... /></Shell>).toString())
})`}</code></pre>
        <p>On initial load, the browser gets a complete HTML document with pre-rendered content. Datastar then opens the SSE connection, and the first SSE push morphs <code>#app inner</code> with fresh content. Subsequent pushes target the inner component (<code>#board outer</code>) as state changes.</p>
      </section>

      <section class="docs-section">
        <h2>Alternative: app shell + lazy UI</h2>
        <p>This app pre-renders full HTML on every request. But there's another pattern that's common with Datastar:</p>
        <ul class="docs-list">
          <li><strong>Initial load</strong> returns a lightweight app shell — just the layout, nav, and empty states.</li>
          <li><strong>First SSE push</strong> brings in the actual UI — the board, cards, data.</li>
        </ul>
        <p>This works well when the initial render is expensive or when you want faster time-to-first-byte. The app shell is cached (HTTP or Service Worker), and the dynamic content loads over SSE. The tradeoff is a brief "loading" state before the SSE connects and pushes the first morph.</p>
        <p>Both patterns work. Pre-render everything (like this app) gives you instant visual completeness. App shell + SSE gives you faster initial response and cleaner separation between shell and content.</p>
      </section>

      <section class="docs-section">
        <h2>The push trigger: event bus</h2>
        <p>After a command route appends events and updates the projection, it needs to notify all open SSE streams. This happens through a plain <code>EventTarget</code> used as an in-memory bus:</p>
        <pre><code>{`// After events are committed to the database:
bus.dispatchEvent(new CustomEvent('board:\${boardId}:changed'))

// In the SSE handler, this listener fires:
bus.addEventListener('board:\${boardId}:changed', async () => {
  const data = await getBoard(boardId)       // read fresh state
  await stream.writeSSE(dsePatch('#board',   // render + push
    <Board board={data.board} columns={data.columns} cards={data.cards} />,
    'outer', { useViewTransition: true }
  ))
})`}</code></pre>
        <p>The bus is scoped by topic — <code>board:&lt;id&gt;:changed</code> for data mutations on a specific board, <code>boards:changed</code> for the board list, <code>global:ui</code> for app-wide UI state like the command menu.</p>
      </section>

      <section class="docs-section">
        <h2>Multi-tab sync</h2>
        <p>Each browser tab opens its own SSE connection. All connections share the same server-side bus. When a mutation fires a bus event, <strong>every</strong> SSE stream subscribed to that topic independently reads the latest state, renders HTML, and pushes its own morph. Two tabs viewing the same board both get updated simultaneously.</p>
        <p>Tab counting uses the Service Worker's <code>Clients API</code> — <code>self.clients.matchAll()</code> returns all open windows. This is more reliable than tracking SSE connections, which can briefly fluctuate during Datastar's reconnect cycle.</p>
      </section>

      <section class="docs-section">
        <h2>View transitions</h2>
        <p>When the server includes <code>useViewTransition true</code> in the SSE event, Datastar wraps the morph in <code>document.startViewTransition()</code>. Combined with CSS <code>view-transition-name</code> on elements, this animates layout changes — columns sliding into new positions, cards fading in or out.</p>
        <p>View transitions are enabled for data mutations (adding, moving, deleting) but not for UI-only changes (opening a menu, toggling selection mode). This keeps the UI responsive without animating every state change.</p>
      </section>

      <DocsPager topic={topic} />
    </DocsInner>
  )
}

function DocsSignalsContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>

      <section class="docs-section">
        <p>Most web frameworks put UI state on the client. An "edit mode" flag lives in <code>useState</code>, a selection set lives in a Zustand store, a modal's open/closed state is a reactive signal. The server returns data; the client decides how to display it.</p>
        <p>This app flips that. <strong>The server tracks all UI state</strong> — which card is being edited, which action sheet is open, which cards are selected — and pushes fully-rendered HTML with the right UI baked in. The client has almost no state of its own.</p>
      </section>

      <section class="docs-section">
        <h2>Server-owned UI state</h2>
        <p>Every board has an in-memory state object on the server that tracks ephemeral UI mode:</p>
        <pre><code>{`const boardUIState = new Map()  // Map<boardId, UIState>

function getUIState(boardId) {
  if (!boardUIState.has(boardId)) {
    boardUIState.set(boardId, {
      activeCardSheet: null,      // which card's action sheet is open
      activeColSheet: null,       // which column's action sheet is open
      selectionMode: false,       // multi-select active?
      selectedCards: new Set(),   // which cards are selected
      editingCard: null,          // which card has inline edit form
      editingBoardTitle: false,   // is the board title being renamed?
      showHelp: false,            // keyboard shortcut overlay visible?
      highlightCard: null,        // card to scroll-into-view + pulse
    })
  }
  return boardUIState.get(boardId)
}`}</code></pre>
        <p>This state is never persisted — it lives only in memory and resets when the server restarts. It's purely about <em>what the UI looks like right now</em>, not about data. Two separate bus topics reflect this split:</p>
        <ul class="docs-list">
          <li><code>board:&lt;id&gt;:changed</code> — data was mutated (events written to the database). Pushes morph <strong>with</strong> view transitions.</li>
          <li><code>board:&lt;id&gt;:ui</code> — only UI state changed (nothing persisted). Pushes morph <strong>without</strong> view transitions.</li>
        </ul>
        <p>Both fire the same full morph push. The rendering code doesn't distinguish between them — it reads the current projection <em>plus</em> the current UI state and renders the whole board.</p>
      </section>

      <section class="docs-section">
        <h2>Worked example: editing a card</h2>
        <p>Here's what happens when a user clicks the edit pencil on a card — no client-side state involved:</p>
        <ol class="docs-flow-list">
          <li><strong>Client sends intent</strong> — the edit button fires <code>@post('/cards/&lt;id&gt;/edit')</code>. No payload, no signal. Just "I want to edit this card."</li>
          <li><strong>Server updates UI state</strong> — the route handler toggles <code>editingCard</code> in the board's UI state and fires <code>emitUI(boardId)</code>:
            <pre><code>{`app.post('/cards/:cardId/edit', async (c) => {
  const ui = getUIState(boardId)
  ui.editingCard = ui.editingCard === cardId ? null : cardId
  ui.activeCardSheet = null     // close any open action sheet
  emitUI(boardId)               // notify SSE streams
  return c.body(null, 204)      // no response body needed
})`}</code></pre>
          </li>
          <li><strong>SSE push fires</strong> — the stream handler reads fresh state from IndexedDB and the current <code>uiState</code>, then renders the full board.</li>
          <li><strong>Component checks UI state</strong> — the Card component reads <code>uiState.editingCard</code> to decide what to render:
            <pre><code>{`function Card({ card, uiState, ... }) {
  const isEditing = uiState?.editingCard === card.id

  return (
    <div id={\`card-\${card.id}\`} class="card">
      {isEditing ? (
        <form data-on:submit__prevent={\`@put('/cards/\${card.id}', {contentType: 'form'})\`}>
          <input name="title" value={card.title} />
          <textarea name="description">{card.description}</textarea>
          <button type="submit">Save</button>
          <button type="button" data-on:click={\`@post('/cards/\${card.id}/edit-cancel')\`}>Cancel</button>
        </form>
      ) : (
        <span class="card-title">{card.title}</span>
      )}
    </div>
  )
}`}</code></pre>
          </li>
          <li><strong>Datastar morphs the DOM</strong> — Idiomorph patches the card element, replacing the title span with the edit form. Focus moves to the input.</li>
        </ol>
        <p>The edit form <em>appears</em> because the server rendered it into the morph, not because the client toggled a flag. When the user saves or cancels, another POST clears <code>editingCard</code>, and the next morph removes the form.</p>
      </section>

      <section class="docs-section">
        <h2>Where signals are actually used</h2>
        <p>Datastar's signal system is powerful, but this app uses it sparingly. In the entire codebase there are exactly <strong>two</strong> <code>data-signals</code> declarations:</p>
        <ol class="docs-flow-list">
          <li><strong>Command menu navigation</strong> — tracks the highlighted result index for arrow-key navigation:
            <pre><code>{`<div data-signals="{cmdIdx: 0, cmdCount: \${results.length}}">
  <!-- Arrow up/down adjust $cmdIdx -->
  <!-- Enter activates the item at $cmdIdx -->
</div>`}</code></pre>
          </li>
          <li><strong>Selection bar dropdown</strong> — a boolean to show/hide the column picker when batch-moving cards:
            <pre><code>{`<div data-signals="{showColumnPicker: false}">
  <button data-on:click="$showColumnPicker = !$showColumnPicker">Move to...</button>
  <div data-show="$showColumnPicker">
    <!-- column list -->
  </div>
</div>`}</code></pre>
          </li>
        </ol>
        <p>Both are trivial UI toggles — an index counter and a boolean. Every meaningful UI state change (editing, selecting, opening sheets, time-traveling) goes through the server.</p>
      </section>

      <section class="docs-section">
        <h2>Forms: sending data to the server</h2>
        <p>When the client needs to send structured data to the server — a card title, a description, a search query — Datastar binds inputs to signals and submits them as JSON:</p>
        <pre><code>{`<!-- Bind inputs to signals -->
<input data-bind="title" placeholder="Title" />
<textarea data-bind="description" placeholder="Description" />

<!-- On submit, all signals are sent as JSON -->
<form data-on:submit__prevent="@post('/cards', {contentType: 'json'})">
  <button type="submit">Create</button>
</form>`}</code></pre>
        <p>Instead of parsing <code>FormData</code> on the server, you receive structured JSON directly: <code>{`{ title: "...", description: "..." }`}</code>. This makes nested data, arrays, and complex shapes easier to work with than flat form fields.</p>
        <p>There are only <strong>seven</strong> form submissions in the entire app: create card, edit card (inline), edit card (detail page), create column, create board, rename board, and command menu search.</p>
      </section>

      <section class="docs-section">
        <h2>If you really love HTML forms</h2>
        <p>Alternatively, you can use standard HTML forms with <code>{`{contentType: 'form'}`}</code>:</p>
        <pre><code>{`<!-- Standard HTML form -->
<form data-on:submit__prevent__viewtransition=
  {\`@post('/columns/\${col.id}/cards', {contentType: 'form'}); evt.target.reset()\`}>
  <input name="title" placeholder="Add a card" />
</form>`}</code></pre>
        <p>This sends a URL-encoded form body — <code>title=My+Card</code> — which the server parses with <code>c.req.parseBody()</code>. Works fine for simple flat data, but gets awkward with nested structures.</p>
      </section>

      <section class="docs-section">
        <h2>Selection mode: a server-side set</h2>
        <p>Multi-card selection is the most complex UI state in the app, and it's entirely server-owned. The selection set (<code>selectedCards</code>) is a <code>Set</code> in <code>boardUIState</code>, not a client-side signal:</p>
        <pre><code>{`// Enter selection mode
app.post('/boards/:boardId/select-mode', async (c) => {
  const ui = getUIState(boardId)
  ui.selectionMode = true
  ui.selectedCards.clear()
  emitUI(boardId)
  return c.body(null, 204)
})

// Toggle a card's selection
app.post('/cards/:cardId/toggle-select', async (c) => {
  const ui = getUIState(boardId)
  if (ui.selectedCards.has(cardId)) {
    ui.selectedCards.delete(cardId)
  } else {
    ui.selectedCards.add(cardId)
  }
  emitUI(boardId)
  return c.body(null, 204)
})`}</code></pre>
        <p>Each toggle sends a POST, the server updates the set, and a morph pushes the full board with checkboxes and selection highlights baked in. The client never knows which cards are selected — it just renders what the server sends.</p>
      </section>

      <section class="docs-section">
        <h2>Action sheets: touch interaction, server state</h2>
        <p>On touch devices, tapping a card opens an action sheet with move, label, edit, and delete options. The client side dispatches a custom event, which triggers a fetch:</p>
        <pre><code>{`// In the page's inline script:
document.getElementById('app').addEventListener('kanban-card-tap', (e) => {
  fetch('/cards/' + e.detail.cardId + '/sheet', { method: 'POST' })
})

// On the server:
app.post('/cards/:cardId/sheet', async (c) => {
  const ui = getUIState(boardId)
  ui.activeCardSheet = ui.activeCardSheet === cardId ? null : cardId
  emitUI(boardId)
  return c.body(null, 204)
})`}</code></pre>
        <p>The action sheet component is rendered by the server only when <code>activeCardSheet</code> matches a card ID. Every button in the sheet — move to column, change label, edit, delete — is another <code>@post()</code> or <code>@delete()</code> to a server route. The sheet dismisses because the server sets <code>activeCardSheet = null</code> and pushes a morph without it.</p>
      </section>

      <section class="docs-section">
        <h2>Why this works</h2>
        <p>The "fewer signals is better" principle sounds limiting, but it eliminates entire categories of bugs:</p>
        <ul class="docs-list">
          <li><strong>No stale UI</strong> — there's no client state that can drift from the server. Every morph is ground truth.</li>
          <li><strong>No state synchronization</strong> — two tabs don't need to coordinate. Each gets independent morphs from the same server state.</li>
          <li><strong>No hydration mismatch</strong> — there's nothing to hydrate. The server renders, the client displays.</li>
          <li><strong>Simpler debugging</strong> — the UI is a pure function of server state. To reproduce a bug, check the server's state object — the UI follows deterministically.</li>
        </ul>
        <p>The tradeoff is latency: every UI state change requires a round-trip. With a fast backend, this is usually imperceptible. For slower connections, you can mask latency with CSS transitions and view transitions — the morph arrives before the eye notices the delay. Datastar also provides <code>data-indicator</code> for showing activity feedback while waiting for the server.</p>
      </section>

      <section class="docs-section">
        <h2>The pattern, summarized</h2>
        <table class="docs-table">
          <thead>
            <tr><th>Mechanism</th><th>Count</th><th>Purpose</th></tr>
          </thead>
          <tbody>
            <tr><td><code>data-signals</code></td><td>2</td><td>Arrow-key index, dropdown toggle</td></tr>
            <tr><td><code>@post</code> / <code>@delete</code> (no body)</td><td>~35</td><td>UI state changes: edit, select, sheets, help</td></tr>
            <tr><td>Form submissions</td><td>7</td><td>Card/column/board creation, editing, search</td></tr>
            <tr><td><code>boardUIState</code> keys</td><td>10+</td><td>All ephemeral UI mode state</td></tr>
          </tbody>
        </table>
        <p>Signals exist for the rare cases where client-only behavior makes sense (keyboard navigation, dropdown toggles). Everything else is a POST to the server. The server decides what the UI looks like and pushes it.</p>
      </section>

      <DocsPager topic={topic} />
    </DocsInner>
  )
}

function DocsHypermediaContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>

      <section class="docs-section">
        <p>The web was built on hypermedia. That's the "H" in HTML — <strong>HyperText</strong> Markup Language. Links connect pages, forms submit data, and the server drives the flow by sending the client what to do next. This was the original pattern before we "discovered" SPAs.</p>
        <p>Datastar brings hypermedia back. Not as a throwback, but as a genuinely simpler way to build interactive apps.</p>
      </section>

      <section class="docs-section">
        <h2>What is hypermedia?</h2>
        <p>Hypermedia means the response includes everything the client needs to continue:</p>
        <ul class="docs-list">
          <li><strong>Links</strong> — <code>&lt;a href="..."&gt;</code> tells the client where to go next.</li>
          <li><strong>Forms</strong> — <code>&lt;form action="..."&gt;</code> tells the client where to send data.</li>
          <li><strong>Actions</strong> — buttons and inputs describe what the user can do.</li>
        </ul>
        <p>The client doesn't need to know ahead of time what operations are available. The server tells it — in every response.</p>
        <p>You can do hypermedia with JSON too — the key is including <em>what the client can do</em> in the response. But typical REST APIs with JSON don't do this; they return data and assume the client already knows the available operations.</p>
      </section>

      <section class="docs-section">
        <h2>The "follow your nose" principle</h2>
        <p>With a JSON API, the client needs out-of-band knowledge:</p>
        <pre><code>{`// Client must know:
// - the endpoint URL (/api/boards)
// - the HTTP method (GET)
// - the response shape
fetch('/api/boards')  // what if this changes?
  .then(r => r.json())
  .then(boards => ...)`}</code></pre>
        <p>With hypermedia, the server tells the client what to do:</p>
        <pre><code>{`// Server sends:
// <a href="/boards/new">Create Board</a>
// <a href="/boards/123">View Board</a>
// The client just follows links. No URL knowledge needed.`}</code></pre>
        <p>This is called "driving the application state through hypermedia" (HATEOAS). The server is the pilot; the client is the display.</p>
      </section>

      <section class="docs-section">
        <h2>How Datastar embraces hypermedia</h2>
        <p>Every HTML response from the server includes all available actions:</p>
        <pre><code>{`// Form — where to send data
<form action="/boards" method="POST">
  <input name="title" placeholder="Board title">
  <button type="submit">Create</button>
</form>

// Button — what action to trigger
<button data-on:click="@post('/boards/123/select-mode')">
  Select cards
</button>

// Link — where to go next
<a href="/boards/123">Open board</a>`}</code></pre>
        <p>The client never needs to construct URLs or know which API endpoints exist. The server says "here's what you can do," and Datastar wires it up.</p>
      </section>

      <section class="docs-section">
        <h2>Contrast: JSON API vs Hypermedia</h2>
        <table class="docs-table">
          <thead>
            <tr><th>JSON API</th><th>Hypermedia (Datastar)</th></tr>
          </thead>
          <tbody>
            <tr><td>Client knows all endpoints upfront</td><td>Server tells client what actions exist</td></tr>
            <tr><td>Client decides what to render</td><td>Server decides what the UI looks like</td></tr>
            <tr><td>Client maintains state</td><td>Server owns state, pushes UI</td></tr>
            <tr><td>Change URL scheme = break clients</td><td>Change is transparent to clients</td></tr>
            <tr><td>Need documentation</td><td>Self-documenting (it's just HTML)</td></tr>
          </tbody>
        </table>
      </section>

      <section class="docs-section">
        <h2>Why it fell out of favor</h2>
        <p>Hypermedia was the original web pattern, but it "fell out of favor" for a few reasons:</p>
        <ul class="docs-list">
          <li><strong>Page reloads felt slow</strong> — full HTML round-trip on every click.</li>
          <li><strong>No real-time</strong> — no way to push updates to the client.</li>
          <li><strong>Static feeling</strong> — pages felt like documents, not apps.</li>
        </ul>
        <p>Datastar fixes all three: SSE pushes updates without reloads, morphing feels instant, and the UI is fully interactive — all while keeping hypermedia's simplicity.</p>
      </section>

      <section class="docs-section">
        <h2>The self-documenting nature</h2>
        <p>One underappreciated benefit: hypermedia apps are self-documenting. View Source on any page shows every available action. There's no API docs to keep in sync, no GraphQL schema to generate, no SDK to update.</p>
        <p>If the server adds a new button, it's immediately available — no client code changes needed. The server said "here's a new action," the client received it, Datastar wired it up.</p>
      </section>

      <section class="docs-section">
        <h2>The pattern in this app</h2>
        <p>Every button, form, and link in this app is hypermedia-driven:</p>
        <ul class="docs-list">
          <li>Creating a board: <code>&lt;form action="/boards" method="POST"&gt;</code></li>
          <li>Opening a board: <code>&lt;a href="/boards/123"&gt;</code></li>
          <li>Editing a card: <code>data-on:click="@post('/cards/123/edit')"</code></li>
          <li>Deleting a column: <code>data-on:click="@delete('/columns/456')"</code></li>
        </ul>
        <p>The client code (<code>eg-kanban.js</code>) handles only drag-and-drop and touch interactions. Every meaningful action goes through the server, and the server tells the client what to display.</p>
      </section>

      <DocsPager topic={topic} />
    </DocsInner>
  )
}

function DocsMpaContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>

      <section class="docs-section">
        <p>Single-page apps brought client-side routing: the URL changes without a page reload, JavaScript swaps the content, and navigation feels instant. But it came with a cost — complex routing code, hydration mismatches, and a second-class citizen on the web platform.</p>
        <p>This app takes a different approach: <strong>standard HTML navigation with View Transitions</strong>. No client-side router. Just <code>&lt;a&gt;</code> tags and the browser's native navigation, enhanced with smooth animations.</p>
      </section>

      <section class="docs-section">
        <h2>No client-side routing</h2>
        <p>Every link is a plain <code>&lt;a href="..."&gt;</code>:</p>
        <pre><code>{`// Plain anchor tag — no router needed
<a href={base()}>Home</a>
<a href={\`\${base()}boards/\${board.id}\`}>{board.title}</a>
<a href={base() + 'docs/core/event-sourcing'}>Docs</a>`}</code></pre>
        <p>Clicking a link triggers a normal browser navigation. The server returns a new HTML document. View Transitions smooth the transition between pages.</p>
        <p>This means:</p>
        <ul class="docs-list">
          <li><strong>No router code</strong> — no <code>react-router</code>, <code>wouter</code>, or custom routing logic.</li>
          <li><strong>URL works correctly</strong> — browser back/forward, deep links, sharing all work natively.</li>
          <li><strong>Progressive enhancement</strong> — works without JavaScript (mostly).</li>
        </ul>
      </section>

      <section class="docs-section">
        <h2>View Transitions API</h2>
        <p>When you navigate between pages, the browser normally does a hard cut — old page gone, new page appears. View Transitions let you animate that change:</p>
        <pre><code>{`// CSS: name elements for transition
.card { view-transition-name: card-123; }
.board-title { view-transition-name: board-title; }

// On navigation, browser captures old state,
// renders new state, and animates between them
// No JavaScript needed beyond the CSS`}</code></pre>
        <p>The key is <code>view-transition-name</code> — give elements the same name across pages, and the browser morphs them. In this app, board cards animate into the board view, columns slide into place.</p>
      </section>

      <section class="docs-section">
        <h2>Speculation Rules: prefetching</h2>
        <p>The downside of MPA is latency — every click is a full page round-trip. Speculation Rules fix this by prefetching pages before you click:</p>
        <pre><code>{`<script type="speculationrules">{JSON.stringify({
  prefetch: [{
    source: 'document',
    where: { href_matches: '/boards/*' },
    eagerness: 'moderate',
  }]
})}</script>`}</code></pre>
        <p>When the browser sees a link to a board page, it prefetches the HTML in the background. When you click, the page loads instantly from cache.</p>
        <p>This app enables speculation rules on non-board pages (the board list, docs). Board pages are excluded because they're heavier and the SSE connection already keeps them fresh.</p>
        <p>Note: Speculation Rules are supported in Chromium browsers. Safari and Firefox fall back to normal navigation — the app still works, just without instant prefetch.</p>
      </section>

      <section class="docs-section">
        <h2>Contrast with SPA client-side routing</h2>
        <table class="docs-table">
          <thead>
            <tr><th>SPA Routing</th><th>MPA + View Transitions</th></tr>
          </thead>
          <tbody>
            <tr><td>URL routing in JavaScript</td><td>Native browser navigation</td></tr>
            <tr><td>Hydration required</td><td>No hydration</td></tr>
            <tr><td>Back/forward needs handling</td><td>Works automatically</td></tr>
            <tr><td>Deep links require server config</td><td>Deep links just work</td></tr>
            <tr><td>Bundle includes router</td><td>No router in bundle</td></tr>
          </tbody>
        </table>
      </section>

      <DocsPager topic={topic} />
    </DocsInner>
  )
}

function DocsIndexedDbContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>

      <section class="docs-section">
        <p>This app uses raw IndexedDB with thin helpers — no ORM, no abstraction layer, no migration framework. It's intentionally minimal to show the pattern clearly. This bonus section explains why and how.</p>
      </section>

      <section class="docs-section">
        <h2>The stores</h2>
        <p>There are only <strong>five</strong> object stores:</p>
        <ul class="docs-list">
          <li><code>events</code> — the immutable event log (source of truth)</li>
          <li><code>boards</code> — board projections</li>
          <li><code>columns</code> — column projections</li>
          <li><code>cards</code> — card projections</li>
          <li><code>meta</code> — snapshots and metadata</li>
        </ul>
        <p>Each projection store has indexes for common queries: <code>cards.byColumn</code>, <code>columns.byBoard</code>, <code>events.byId</code>.</p>
      </section>

      <section class="docs-section">
        <h2>Why raw IndexedDB?</h2>
        <ul class="docs-list">
          <li><strong>No extra dependencies</strong> — just <code>idb</code> for promise-based wrappers around the callback API.</li>
          <li><strong>Structured cloning</strong> — JavaScript objects serialize automatically. No <code>JSON.stringify</code> needed.</li>
          <li><strong>Transactions</strong> — atomicity comes free. Read-modify-write in a transaction; it all succeeds or fails together.</li>
          <li><strong>No migrations needed</strong> — events are the schema. If you can append events, the format doesn't matter.</li>
        </ul>
      </section>

      <section class="docs-section">
        <h2>Contrast with heavier options</h2>
        <table class="docs-table">
          <thead>
            <tr><th>Option</th><th>Tradeoff</th></tr>
          </thead>
          <tbody>
            <tr><td>Dexie.js</td><td>Nice API, but adds bundle size and another abstraction</td></tr>
            <tr><td>PGlite (SQLite in WASM)</td><td>Powerful queries, but heavy (~3MB) and overengineered for this</td></tr>
            <tr><td>OPFS</td><td>File-based, not ideal for structured data</td></tr>
            <tr><td>Raw IndexedDB + idb</td><td>~3KB, direct access, no abstraction leak</td></tr>
          </tbody>
        </table>
      </section>

      <section class="docs-section">
        <h2>Reading and writing</h2>
        <p>Writing appends an event and updates projections in a single transaction:</p>
        <pre><code>{`const tx = db.transaction(['events', 'boards', 'columns', 'cards'], 'readwrite')
await tx.objectStore('events').add(event)
await tx.objectStore('boards').put(projection)
await tx.done`}</code></pre>
        <p>Reading is straightforward:</p>
        <pre><code>{`const db = await dbPromise
const cards = await db.getAllFromIndex('cards', 'byColumn', columnId)`}</code></pre>
      </section>

      <section class="docs-section">
        <h2>Snapshots for fast startup</h2>
        <p>On service worker startup, replaying thousands of events is slow. This app periodically saves a snapshot to <code>meta</code> — a serialized projection. On load, it reads the snapshot and replays only events after the snapshot sequence.</p>
        <p>This keeps startup fast even with thousands of events.</p>
      </section>

      <DocsPager topic={topic} />
    </DocsInner>
  )
}

function DocsFractionalIndexingContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>

      <section class="docs-section">
        <p>Not Datastar-specific — this is a general technique for ordered lists. When you drag a card to a new position, you need to store its order somehow. The naive approach uses integers: position 0, 1, 2, 3... But every insert or move requires renumbering everything after it.</p>
        <p>Fractional indexing solves this: positions are strings that sort alphabetically but leave room between neighbors. You can insert between any two items without renumbering.</p>
      </section>

      <section class="docs-section">
        <h2>How it works</h2>
        <p>Each position is a string key. The keys sort in lexicographic order (like alphabetical, but for strings):</p>
        <pre><code>{`// Initial cards at positions:
card1: "a"
card2: "b"
card3: "c"

// Insert between card1 and card2:
generateKeyBetween("a", "b")  // → "aV"

// Insert at the start:
generateKeyBetween(null, "a")  // → "]"

// Insert at the end:
generateKeyBetween("c", null)  // → "c0"`}</code></pre>
        <p>The library generates keys that always fit between any two existing keys. You never need to update other items.</p>
      </section>

      <section class="docs-section">
        <h2>The siblings array</h2>
        <p>When moving an item, you pass the <em>sorted siblings</em> (excluding the item being moved) and the drop index:</p>
        <pre><code>{`function positionForIndex(dropIndex, sortedSiblings) {
  const before = dropIndex > 0 ? sortedSiblings[dropIndex - 1].position : null
  const after = dropIndex < sortedSiblings.length ? sortedSiblings[dropIndex].position : null
  return generateKeyBetween(before, after)
}`}</code></pre>
        <p>The siblings array excludes the moved item because you're computing where it <em>goes</em>, not where it <em>was</em>.</p>
      </section>

      <section class="docs-section">
        <h2>Why not integers?</h2>
        <p>With integers, moving item at position 2 to position 0 means:</p>
        <pre><code>{`// Old: [0, 1, 2, 3]
// Move item 2 to position 0:
// Need to renumber: [0, 2, 3, 4] or [0, 1, 2, 3] → [0, -1, 1, 2] → ...`}</code></pre>
        <p>With fractional indexing:</p>
        <pre><code>{`// Old: ["a", "b", "c", "d"]
// Move item "c" to position 0:
// generateKeyBetween(null, "a") → "]"
// No other items changed.`}</code></pre>
      </section>

      <section class="docs-section">
        <h2>In this app</h2>
        <p>Cards and columns both use fractional indexing for position. When you drag a card, <code>eg-kanban.js</code> calculates the visual drop index and sends it to the server. The server converts it to a fractional key:</p>
        <pre><code>{`// Server receives dropIndex=2, siblings=[{position:"a"},{position:"b"},{position:"c"}]
// Computes: generateKeyBetween("b", "c") → "bV"`}</code></pre>
        <p>The event stores <code>position: "bV"</code>. Future inserts between any two items work without touching other positions.</p>
      </section>

      <DocsPager topic={topic} />
    </DocsInner>
  )
}

function DocsLocalFirstContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>

      <section class="docs-section">
        <p><strong>Datastar is not built for local-first.</strong> This demo pushes it into territory it wasn't designed for. Local-first in the browser is still experimental. This bonus section is honest about the tradeoffs.</p>
      </section>

      <section class="docs-section">
        <h2>What "local-first" means here</h2>
        <ul class="docs-list">
          <li><strong>Data lives on-device</strong> — IndexedDB stores everything. No server, no API calls.</li>
          <li><strong>Works offline</strong> — the service worker serves the app, IndexedDB holds the data.</li>
          <li><strong>No costs</strong> — no hosting, no auth, no API keys.</li>
        </ul>
      </section>

      <section class="docs-section">
        <h2>Tradeoffs</h2>
        <ul class="docs-list">
          <li><strong>No cross-device sync</strong> — data lives in one browser. (WebRTC could fix this — future work.)</li>
          <li><strong>SW lifecycle</strong> — browser kills idle service workers after ~30s. In-memory state resets.</li>
          <li><strong>Storage eviction</strong> — browsers can evict IndexedDB under storage pressure.</li>
          <li><strong>No real backend</strong> — can't share boards with others without exporting/importing.</li>
        </ul>
      </section>

      <section class="docs-section">
        <h2>Event log is sync-ready</h2>
        <p>The event log is the key to future sync capability. If you add a transport layer (WebRTC or HTTP), the events are already structured for sharing:</p>
        <ul class="docs-list">
          <li>Immutable events — can be replayed in order</li>
          <li>Includes causation IDs — know what caused what</li>
          <li>Projections rebuild from events — no data loss</li>
        </ul>
        <p>The architecture is sync-ready; the transport layer is the missing piece.</p>
      </section>

      <section class="docs-section">
        <h2>Is this a good pattern?</h2>
        <p>Honestly? Not really. Datastar works best with a real backend. Running a SW as a server is a fun experiment but has fundamental limitations:</p>
        <ul class="docs-list">
          <li>No WebSockets in service workers — SSE only</li>
          <li>No background sync when SW is killed</li>
          <li>Limited storage APIs compared to a real database</li>
        </ul>
        <p>This demo exists to show Datastar patterns, not to recommend local-first as a production architecture.</p>
      </section>

      <section class="docs-section">
        <h2>The conventional wisdom</h2>
        <p>A <a href="https://zweiundeins.gmbh/en/methodology/spa-vs-hypermedia-real-world-performance-under-load" style="color: var(--primary-7)">2026 SPA-vs-Hypermedia benchmark by zwei und eins</a> lists "offline-first is a hard requirement" as a reason to choose an SPA architecture. That's the standard advice — and it's mostly right. SPAs can use standard tools like service worker caches, IndexedDB, and background sync APIs to work offline.</p>
        <p>This project is an experiment in the opposite direction: a <strong>hypermedia app that works offline</strong> by moving the server itself into the browser. It works, but with real limitations (see above). The interesting question isn't whether this is production-ready (it isn't), but whether the <em>architecture</em> — event sourcing, SSE morphing, server-owned state — could support offline with a proper sync layer added later.</p>
      </section>

      <DocsPager topic={topic} />
    </DocsInner>
  )
}

function DocsBrotliContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>

      <section class="docs-section">
        <p>Long-lived SSE connections pushing frequent HTML morphs can benefit from compression. This bonus section covers the tradeoffs.</p>
      </section>

      <section class="docs-section">
        <h2>The optimization</h2>
        <p>A full board morph is 5-15KB of HTML. Over a long-lived SSE connection with frequent updates, that adds up. Brotli compression can shrink this by 70-80%.</p>
        <p>The server checks <code>Accept-Encoding: br</code> and streams compressed data:</p>
        <pre><code>{`// Server side:
if (request.headers.get('Accept-Encoding')?.includes('br')) {
  stream = compress(stream)  // brotli streaming compressor
  response.headers.set('Content-Encoding', 'br')
}`}</code></pre>
      </section>

      <section class="docs-section">
        <h2>Service worker limitation</h2>
        <p>You can't easily do this in a service worker. The browser's <code>Compression Streams API</code> supports gzip and deflate natively, but <strong>not brotli</strong>. You could use gzip as a fallback — it still saves 50-70% — but it's not as efficient as brotli.</p>
        <p>With a real backend (Node, Go, Python), brotli is a simple addition and a significant optimization for high-frequency morphs.</p>
      </section>

      <section class="docs-section">
        <h2>Real-world numbers</h2>
        <p>A <a href="https://zweiundeins.gmbh/en/methodology/spa-vs-hypermedia-real-world-performance-under-load" style="color: var(--primary-7)">2026 benchmark by zwei und eins</a> built the same AI chat app as both an SPA (Next.js) and a hypermedia app (PHP/Swoole/Datastar), then measured SSE compression on identical conversations:</p>
        <ul class="docs-list">
          <li><strong>Single turn</strong> — Brotli achieved an <strong>18.7× compression ratio</strong>, turning 112 KB of uncompressed HTML into 6 KB transferred (vs. 14.4 KB uncompressed for the SPA with no compression).</li>
          <li><strong>10-turn conversation</strong> — on a persistent SSE stream, Brotli hit <strong>58.5× compression</strong>. Cross-turn repetition in the HTML gives the compressor more to work with as the conversation grows.</li>
          <li><strong>Net result</strong> — despite sending 29× more raw data (naively re-streaming the full HTML fragment per token), the hypermedia version transferred <strong>2× less data</strong> than the SPA over 10 turns.</li>
        </ul>
        <p>The key insight: a persistent SSE connection lets Brotli build a shared dictionary across all pushes. The more similar the morphs are to each other (which they are — it's the same template with incremental content changes), the better the compression gets over time.</p>
      </section>

      <section class="docs-section">
        <h2>Tradeoffs</h2>
        <ul class="docs-list">
          <li><strong>CPU cost</strong> — compression takes CPU cycles on both ends.</li>
          <li><strong>Latency</strong> — streaming compression helps, but there's still overhead.</li>
          <li><strong>Not needed for low-frequency updates</strong> — if updates are rare, the savings don't matter.</li>
        </ul>
      </section>

      <DocsPager topic={topic} />
    </DocsInner>
  )
}

function DocsServiceWorkerContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>

      <section class="docs-section">
        <p><strong>This is not a recommended Datastar pattern.</strong> The service worker as server is an interesting experiment that makes this demo self-contained — no backend infrastructure required. Datastar works best with a real server in any language.</p>
        <p>That said, running a server inside a service worker teaches you a lot about how the browser, service workers, and SSE interact. This bonus section covers the implementation details.</p>
      </section>

      <section class="docs-section">
        <h2>Why a service worker?</h2>
        <p>This app runs entirely in the browser. No backend server, no database hosting, no deployment pipeline. The service worker intercepts requests, runs a Hono server, talks to IndexedDB, and pushes HTML via SSE. It's a full-stack app in a single JavaScript file.</p>
        <p>The tradeoffs are significant, covered below. But for an educational demo, it means you can clone the repo, run <code>pnpm dev</code>, and have a working app with zero setup.</p>
      </section>

      <section class="docs-section">
        <h2>Fetch interception</h2>
        <p>The service worker registers a <code>fetch</code> event listener that decides what to serve:</p>
        <pre><code>{`self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  
  // Static assets: let the browser handle them.
  // This regex passes JS, CSS, images, fonts through to the network.
  if (/\\.(js|css|png|svg|ico|woff2?|json|webmanifest)/.test(url.pathname)) {
    return
  }
  
  // Strip the SW scope prefix so Hono routes match.
  // /datastar-sw-experiment/boards/123 → /boards/123
  const scope = new URL(self.registration.scope).pathname
  if (scope !== '/' && url.pathname.startsWith(scope)) {
    url.pathname = '/' + url.pathname.slice(scope.length)
  }
  
  // Forward to Hono
  event.respondWith(app.fetch(new Request(url, init)))
})`}</code></pre>
        <p>Static assets bypass the service worker entirely — they're served by Vite in development or cached by the browser in production. This is critical for a Safari quirk: the browser's fetch handler doesn't reliably intercept <code>&lt;script src&gt;</code> subresource requests on service-worker-served pages.</p>
      </section>

      <section class="docs-section">
        <h2>The base() function</h2>
        <p>GitHub Pages serves this app under a subpath: <code>/datastar-sw-experiment/</code>. Every URL in the rendered HTML must include this prefix. The <code>base()</code> helper returns it:</p>
        <pre><code>{`function base() {
  if (!_base) _base = new URL(self.registration.scope).pathname
  return _base
}

// Usage in JSX:
<a href={\`\${base()}boards/\${board.id}\`}>Board</a>
<link rel="stylesheet" href={\`\${base()}\${__STELLAR_CSS__}\`} />`}</code></pre>
        <p>This is used everywhere: routes, form actions, SSE URLs, stylesheet links, script src, even the manifest href. Without it, links break on GitHub Pages.</p>
      </section>

      <section class="docs-section">
        <h2>Lifecycle: install, activate, idle kill</h2>
        <p>Service workers have a strict lifecycle:</p>
        <ul class="docs-list">
          <li><strong>install</strong> — calls <code>skipWaiting()</code> to take control immediately.</li>
          <li><strong>activate</strong> — calls <code>clients.claim()</code> to take control of existing pages without reload.</li>
          <li><strong>idle kill</strong> — browsers terminate idle service workers after ~30 seconds. When you come back, the SW restarts fresh.</li>
        </ul>
        <p>This means in-memory state is <strong>ephemeral</strong>. The event bus, <code>boardUIState</code>, caches — all gone on restart. The app handles this through event sourcing: on startup, it loads a snapshot from IndexedDB and replays events after the snapshot sequence number.</p>
      </section>

      <section class="docs-section">
        <h2>Ephemeral state: what survives restart</h2>
        <table class="docs-table">
          <thead>
            <tr><th>State</th><th>Survives SW restart?</th></tr>
          </thead>
          <tbody>
            <tr><td>IndexedDB (events, projections)</td><td>Yes — persisted to disk</td></tr>
            <tr><td>boardUIState (editing, selection)</td><td>No — in-memory Map</td></tr>
            <tr><td>Event bus listeners</td><td>No — recreated on each request</td></tr>
            <tr><td>Theme preference (localStorage)</td><td>Yes — browser storage</td></tr>
          </tbody>
        </table>
        <p>When the SW restarts, boards open fresh: no open action sheets, no editing, no selection. This is actually correct behavior — the user hasn't done anything yet in this SW instance.</p>
      </section>

      <section class="docs-section">
        <h2>SSE in a service worker</h2>
        <p>Server-Sent Events work inside a service worker, but with caveats:</p>
        <ul class="docs-list">
          <li>The SSE connection persists as long as the SW is alive. When the SW is killed, SSE drops silently.</li>
          <li>Datastar's <code>retry: 'always'</code> option handles reconnection — when the SW restarts, the client reconnects and gets a fresh morph.</li>
          <li>No WebSockets in service workers — SSE is the only real-time option.</li>
        </ul>
        <p>Each SSE stream needs a keep-alive loop to prevent premature closure:</p>
        <pre><code>{`// Without this, the stream closes when the bus has no events.
while (!stream.closed) {
  await stream.sleep(30000)  // check every 30s
}`}</code></pre>
      </section>

      <section class="docs-section">
        <h2>Debugging in a separate context</h2>
        <p>Service worker console logs appear in a different DevTools context than the page. This is confusing — <code>console.log</code> in the SW doesn't show up in the page's console.</p>
        <p>This app works around it with a broadcast channel:</p>
        <pre><code>{`// In the SW:
self.clients.matchAll().forEach(client => {
  client.postMessage({ type: 'log', args: [...] })
})

// In the page:
navigator.serviceWorker.addEventListener('message', (e) => {
  if (e.data.type === 'log') console.log(...e.data.args)
})`}</code></pre>
        <p>Still, breakpoints and debugging require opening DevTools → Application → Service Workers → click the link to open the SW's console.</p>
      </section>

      <section class="docs-section">
        <h2>Development friction: picking up changes</h2>
        <p>Browsers aggressively cache service workers. After editing <code>sw.jsx</code>, the old version may be served for up to 24 hours.</p>
        <p>The fix in this app:</p>
        <pre><code>{`// In index.html — on every page load in dev mode:
if (import.meta.hot) {
  reg.update()  // check for new SW
  import.meta.hot.on('sw-updated', () => reg.update())
}`}</code></pre>
        <p>When Vite rebuilds the SW, it sends an <code>sw-updated</code> HMR event. The page responds by calling <code>reg.update()</code>, which checks the server for a new version. Combined with <code>skipWaiting()</code> in the SW, this triggers an automatic update.</p>
      </section>

      <section class="docs-section">
        <h2>Pros and cons</h2>
        <table class="docs-table">
          <thead>
            <tr><th>Pros</th><th>Cons</th></tr>
          </thead>
          <tbody>
            <tr><td>Zero infrastructure</td><td>Browser kills idle SW (~30s)</td></tr>
            <tr><td>Fully offline capable</td><td>No WebSocket support</td></tr>
            <tr><td>Single-file server</td><td>Debugging in separate console</td></tr>
            <tr><td>No deployment needed</td><td>Safari can't intercept script src</td></tr>
            <tr><td>Instant latency (localhost)</td><td>Ephemeral in-memory state</td></tr>
          </tbody>
        </table>
      </section>

      <DocsPager topic={topic} />
    </DocsInner>
  )
}

// Topic content lookup — returns topic-specific component or falls back to stub
function DocsTopicContent({ topic, commandMenu }) {
  switch (topic.slug) {
    case 'core/hypermedia':
      return <DocsHypermediaContent topic={topic} commandMenu={commandMenu} />
    case 'core/event-sourcing':
      return <DocsEventSourcingContent topic={topic} commandMenu={commandMenu} />
    case 'core/sse-fat-morph':
      return <DocsFatMorphingContent topic={topic} commandMenu={commandMenu} />
    case 'core/signals':
      return <DocsSignalsContent topic={topic} commandMenu={commandMenu} />
    case 'core/mpa':
      return <DocsMpaContent topic={topic} commandMenu={commandMenu} />
    case 'bonus/sw':
      return <DocsServiceWorkerContent topic={topic} commandMenu={commandMenu} />
    case 'bonus/indexeddb':
      return <DocsIndexedDbContent topic={topic} commandMenu={commandMenu} />
    case 'bonus/fractional':
      return <DocsFractionalIndexingContent topic={topic} commandMenu={commandMenu} />
    case 'bonus/local-first':
      return <DocsLocalFirstContent topic={topic} commandMenu={commandMenu} />
    case 'bonus/brotli':
      return <DocsBrotliContent topic={topic} commandMenu={commandMenu} />
    default:
      return <DocsTopicStubContent topic={topic} commandMenu={commandMenu} />
  }
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
        <h1>Event Log <span><a href={base()}><Icon name="lucide:arrow-left" /> boards</a></span></h1>
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
        performance?.mark('pushBoard-start')
        const ui = getUIState(boardId)
        let data
        performance?.mark('db-read-start')
        if (ui.timeTravelPos >= 0 && ui.timeTravelAllEvents && ui.timeTravelEvents) {
          // Time travel mode: replay to the current position
          const targetIdx = ui.timeTravelEvents[ui.timeTravelPos].idx
          data = await replayToPosition(ui.timeTravelAllEvents, targetIdx, boardId)
        } else {
          data = await getBoard(boardId)
        }
        performance?.mark('db-read-end')
        performance?.measure('db-read', 'db-read-start', 'db-read-end')
        if (!data) return
        const tabCount = await getTabCount(boardId)
        const connStatus = await getConnectionStatus()
        await stream.writeSSE(dsePatch(selector, <Board board={data.board} columns={data.columns} cards={data.cards} uiState={ui} tabCount={tabCount} connStatus={connStatus} commandMenu={globalUIState.commandMenu} />, mode, opts))
        performance?.mark('pushBoard-end')
        performance?.measure('pushBoard', 'pushBoard-start', 'pushBoard-end')
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
  // Clear editing state after save (label changes are accepted)
  if (boardId) {
    const ui = getUIState(boardId)
    ui.editingCard = null
    ui.editingCardOriginalLabel = null
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
  const wasEditing = ui.editingCard === cardId
  ui.editingCard = wasEditing ? null : cardId
  // Store original label so cancel can revert label changes
  if (!wasEditing) {
    const db = await dbPromise
    const card = await db.get('cards', cardId)
    ui.editingCardOriginalLabel = card?.label || null
  } else {
    ui.editingCardOriginalLabel = null
  }
  ui.activeCardSheet = null
  emitUI(boardId)
  return c.body(null, 204)
})

// Edit card: cancel — revert label if it changed during editing
app.post('/cards/:cardId/edit-cancel', async (c) => {
  const cardId = c.req.param('cardId')
  const boardId = await boardIdFromCard(cardId)
  if (!boardId) return c.body(null, 404)
  const ui = getUIState(boardId)

  // Revert label to what it was when editing started
  if (ui.editingCardOriginalLabel !== undefined) {
    const db = await dbPromise
    const card = await db.get('cards', cardId)
    const currentLabel = card?.label || null
    const originalLabel = ui.editingCardOriginalLabel
    if (currentLabel !== originalLabel) {
      const evt = createEvent('card.labelUpdated', { id: cardId, label: originalLabel })
      await appendEventsWithUndo([evt], boardId)
    }
  }

  ui.editingCard = null
  ui.editingCardOriginalLabel = null
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



// ── Docs ──────────────────────────────────────────────────────────────────────

app.get('/docs', (c) => {
  if (c.req.header('Datastar-Request') === 'true') {
    return streamSSE(c, async (stream) => {
      // No initial push — page already has correct content from initial HTML.
      // SSE stream stays open for state changes (command menu, future interactive examples).
      const push = async () => {
        await stream.writeSSE(dsePatch('#docs-page', <DocsIndexContent commandMenu={globalUIState.commandMenu} />, 'outer'))
      }
      bus.addEventListener('global:ui', push)
      stream.onAbort(() => bus.removeEventListener('global:ui', push))
      while (!stream.closed) { await stream.sleep(30000) }
    })
  }
  return c.html('<!DOCTYPE html>' + (<DocsPage sseUrl="docs"><DocsIndexContent commandMenu={globalUIState.commandMenu} /></DocsPage>).toString())
})

app.get('/docs/:slug{.*}', (c) => {
  const slug = c.req.param('slug')
  const topic = DOCS_TOPICS.find(t => t.slug === slug)
  if (!topic) return c.notFound()
  if (c.req.header('Datastar-Request') === 'true') {
    return streamSSE(c, async (stream) => {
      const push = async () => {
        await stream.writeSSE(dsePatch('#docs-page', <DocsTopicContent topic={topic} commandMenu={globalUIState.commandMenu} />, 'outer'))
      }
      bus.addEventListener('global:ui', push)
      stream.onAbort(() => bus.removeEventListener('global:ui', push))
      while (!stream.closed) { await stream.sleep(30000) }
    })
  }
  return c.html('<!DOCTYPE html>' + (<DocsPage title={topic.title} sseUrl={`docs/${topic.slug}`}><DocsTopicContent topic={topic} commandMenu={globalUIState.commandMenu} /></DocsPage>).toString())
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
