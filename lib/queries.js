import { getRecord, getAllRecords, getAllFromIndex, countRecords } from './db.js'
import { cmpPosition } from './position.js'
import { getRuntimeConfig } from './runtime.js'

export async function getConnectionStatus() {
  const isOnline = getRuntimeConfig().isOnline()
  const config = await getRecord('meta', 's2Config')
  const hasSyncConfig = !!config?.value
  // All events are unsynced until sync is implemented (synced field is boolean,
  // not a valid IDB key type, so bySynced index doesn't work — just count all)
  const unsyncedCount = await countRecords('events')
  return { isOnline, hasSyncConfig, unsyncedCount }
}

// --- Queries ---

export async function getBoards() {
  const boards = await getAllRecords('boards')
  // Attach column/card counts
  const columns = await getAllRecords('columns')
  const cards = await getAllRecords('cards')
  return boards.map(b => ({
    ...b,
    columnCount: columns.filter(c => c.boardId === b.id).length,
    cardCount: cards.filter(c => columns.some(col => col.boardId === b.id && col.id === c.columnId)).length,
  })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

export async function getBoard(boardId) {
  const board = await getRecord('boards', boardId)
  if (!board) return null
  const columns = (await getAllFromIndex('columns', 'byBoard', boardId))
    .sort(cmpPosition)
  // Use byColumn index to fetch only cards belonging to this board's columns
  const colIds = new Set(columns.map(c => c.id))
  const cards = []
  for (const colId of colIds) {
    const colCards = await getAllFromIndex('cards', 'byColumn', colId)
    cards.push(...colCards)
  }
  return { board, columns, cards }
}

export async function boardIdFromColumn(columnId) {
  const col = await getRecord('columns', columnId)
  return col?.boardId || null
}
export async function boardIdFromCard(cardId) {
  const card = await getRecord('cards', cardId)
  if (!card) return null
  return boardIdFromColumn(card.columnId)
}
