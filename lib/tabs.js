import { base } from './base.js'
import { bus } from './db.js'
import { boardUIState } from './ui-state.js'

// ── Per-board tab presence (via clients API) ─────────────────────────────────
export async function getTabCount(boardId) {
  const clients = await self.clients.matchAll({ type: 'window' })
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
self.addEventListener('online', notifyConnectionChange)
self.addEventListener('offline', notifyConnectionChange)
