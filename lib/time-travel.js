import { dbPromise } from './db.js'
import { applyEvent, upcast, boardIdForEvent } from './events.js'

// ── Time travel: in-memory replay ────────────────────────────────────────────

// Fake IDB transaction backed by Maps — allows reusing applyEvent for replay.
export function createMemoryTx() {
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
export async function replayToPosition(events, idx, boardId) {
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
export async function loadTimeTravelEvents(boardId) {
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
export async function loadCardEvents(cardId) {
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
