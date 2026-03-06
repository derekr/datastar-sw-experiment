import { initialize } from './init.js'
import { dbPromise } from './db.js'
import { getUIState } from './ui-state.js'
import { cmpPosition } from './position.js'
import { LABEL_COLORS } from './constants.js'
import { base } from './base.js'

export async function buildCommandMenuResults(query, context) {
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
