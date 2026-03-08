import { base } from './base.js'
import { bus } from './db.js'
import { boardUIState } from './ui-state.js'
import { getRuntimeConfig } from './runtime.js'

// ── Per-board tab presence (via clients API) ─────────────────────────────────
export async function getTabCount(boardId) {
  const connCounter = getRuntimeConfig().countBoardConnections
  if (connCounter) {
    return Math.max(1, connCounter(boardId))
  }
  const clients = await getRuntimeConfig().matchClients()
  if (!clients || clients.length === 0) return 1
  const boardPath = `${base()}boards/${boardId}`
  return clients.filter(c => new URL(c.url).pathname === boardPath).length
}

// Debounced UI push after connection changes settle
const boardConnDebounce = new Map()
export function notifyTabChange(boardId) {
  clearTimeout(boardConnDebounce.get(boardId))
  boardConnDebounce.set(boardId, setTimeout(() => {
    boardConnDebounce.delete(boardId)
    bus.dispatchEvent(new CustomEvent(`board:${boardId}:ui`))
  }, 300))
}

// Push UI update to all active boards when connection status changes
export function notifyConnectionChange() {
  for (const boardId of boardUIState.keys()) {
    bus.dispatchEvent(new CustomEvent(`board:${boardId}:ui`))
  }
}

let unsubscribeConnectionChanges = null

export function registerConnectionListeners() {
  if (unsubscribeConnectionChanges) return
  const subscribe = getRuntimeConfig().subscribeConnectionChange
  if (!subscribe) return
  unsubscribeConnectionChanges = subscribe(notifyConnectionChange)
}

export function unregisterConnectionListeners() {
  if (!unsubscribeConnectionChanges) return
  unsubscribeConnectionChanges()
  unsubscribeConnectionChanges = null
}
