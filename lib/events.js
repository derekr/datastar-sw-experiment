import { EVENT_VERSIONS } from './constants.js'
import { beginTx, ALL_STORES, bus, actorId } from './db.js'

export const upcasters = {
  'column.created': {
    1: (e) => ({ ...e, v: 2, data: { ...e.data, boardId: e.data.boardId || 'default' } }),
  },
}

export function upcast(event) {
  let e = { ...event }
  const fns = upcasters[e.type]
  if (fns) while (fns[e.v]) e = fns[e.v](e)
  return e
}

export function createEvent(type, data, { correlationId, causationId } = {}) {
  return {
    id: crypto.randomUUID(),
    type,
    v: EVENT_VERSIONS[type],
    data,
    ts: Date.now(),
    synced: false,
    correlationId: correlationId || crypto.randomUUID(),
    causationId: causationId || null,
    actorId: actorId.value,
  }
}

// Apply a single (upcasted) event to the projection stores within a transaction.
// Must handle missing entities gracefully (events may reference deleted items).
// If upcasting changed the event, persist the upcasted version to avoid re-upcasting on future replays.
export async function applyEvent(event, tx) {
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

// Resolve boardId from event data + projection stores (within an open tx).
export async function boardIdForEvent(event, tx) {
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
export async function annotateEventsWithBoardId(events) {
  const tx = await beginTx(ALL_STORES, 'readonly')
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
export async function appendEvents(events) {
  const tx = await beginTx(ALL_STORES, 'readwrite')
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

export async function appendEvent(event) {
  return appendEvents([event])
}
