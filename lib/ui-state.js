import { bus } from './db.js'

// --- Server-tracked UI state ---
// In-memory, per-board. Mutations push a full board morph with the
// relevant UI baked in (action sheet, selection mode, editing card).
// No client signals needed — the server is the source of truth for UI mode.

export const boardUIState = new Map()

export function getUIState(boardId) {
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

export const globalUIState = {
  commandMenu: null,  // { query, results, context } or null when closed
}

export function emitGlobalUI() {
  bus.dispatchEvent(new CustomEvent('global:ui'))
}

export function clearUIState(boardId) {
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

// Helper: emit UI change event to trigger SSE re-push
export function emitUI(boardId) {
  bus.dispatchEvent(new CustomEvent(`board:${boardId}:ui`, { detail: null }))
}
