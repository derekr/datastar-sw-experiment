import { MAX_UNDO } from './constants.js'
import { getDb } from './db.js'
import { appendEvents, createEvent } from './events.js'

// --- Undo / Redo ---
// Per-board undo/redo stacks. Each entry is an array of events to reverse/replay.
// Mutations push { undo: [reverseEvents], redo: [originalEvents] } onto undoStack.
// Undo pops undoStack, appends undo events, pushes to redoStack.
// Redo pops redoStack, appends redo events, pushes to undoStack.

export const undoStacks = new Map() // boardId → [{ undo: [...], redo: [...] }]
export const redoStacks = new Map() // boardId → [{ undo: [...], redo: [...] }]

export function getStack(map, boardId) {
  if (!map.has(boardId)) map.set(boardId, [])
  return map.get(boardId)
}

// Build reverse events for a set of forward events.
// Must be called BEFORE the forward events are applied (needs old state).
export async function buildUndoEntry(events) {
  const db = await getDb()
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
          // Snapshot columns and their cards so undo restores everything
          const cols = await db.getAllFromIndex('columns', 'byBoard', data.id)
          undoEvents.push({ type: 'board.created', data: { ...board } })
          for (const col of cols) {
            undoEvents.push({ type: 'column.created', data: { ...col } })
            const colCards = await db.getAllFromIndex('cards', 'byColumn', col.id)
            for (const card of colCards) {
              undoEvents.push({ type: 'card.created', data: { ...card } })
            }
          }
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
export async function appendEventsWithUndo(events, boardId, { isUndoRedo = false } = {}) {
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
