import { dbPromise } from './db.js'
import { cmpPosition } from './position.js'

export async function getConnectionStatus() {
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

export async function getBoards() {
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

export async function getBoard(boardId) {
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

export async function boardIdFromColumn(columnId) {
  const db = await dbPromise
  const col = await db.get('columns', columnId)
  return col?.boardId || null
}
export async function boardIdFromCard(cardId) {
  const db = await dbPromise
  const card = await db.get('cards', cardId)
  if (!card) return null
  return boardIdFromColumn(card.columnId)
}
