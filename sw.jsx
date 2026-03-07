/** @jsxImportSource hono/jsx */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'

import { base } from './lib/base.js'
import { dbPromise, bus, ALL_STORES } from './lib/db.js'
import { MAX_IMPORT_EVENTS, ALLOWED_EVENT_TYPES, LABEL_COLORS, DOCS_TOPICS } from './lib/constants.js'
import { compressToBase64url, decompressFromBase64url } from './lib/compression.js'
import { createEvent, applyEvent, appendEvents, appendEvent, boardIdForEvent, annotateEventsWithBoardId } from './lib/events.js'
import { appendEventsWithUndo, undoStacks, redoStacks, getStack } from './lib/undo.js'
import { boardUIState, globalUIState, getUIState, emitGlobalUI, emitUI } from './lib/ui-state.js'
import { replayToPosition, loadTimeTravelEvents, loadCardEvents } from './lib/time-travel.js'
import { cmpPosition, positionForIndex } from './lib/position.js'
import { dsePatch } from './lib/sse.js'
import { getTabCount, notifyTabChange, notifyConnectionChange } from './lib/tabs.js'
import { BOARD_TEMPLATES, getTemplateHash } from './lib/templates.js'
import { getBoards, getBoard, getConnectionStatus, boardIdFromColumn, boardIdFromCard } from './lib/queries.js'
import { initialize, rebuildProjection } from './lib/init.js'
import { buildCommandMenuResults } from './lib/command-menu.js'

// Components
import { Board, SelectionBar, eventLabel, StatusChip, LabelPicker } from './components/kanban.jsx'
import { BoardCard, BoardsList } from './components/boards-list.jsx'
import { CardDetail } from './components/card-detail.jsx'
import { CommandMenu } from './components/command-menu.jsx'
import { Shell } from './components/shell.jsx'
import { EventsPage, EventList } from './components/events-page.jsx'
import { DocsPage, DocsTopicContent, DocsInner, DocsIndexContent } from './components/docs.jsx'

// --- Hono app ---

const app = new Hono()

// Ensure DB is initialized before every route (SW may restart between requests)
app.use(async (c, next) => {
  await initialize()
  await next()
})

// ── Boards list (index) ──────────────────────────────────────────────────────

app.get('/', async (c) => {
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
      const globalUIHandler = () => push('#app', 'inner')
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
    jsAction: `applyTheme('${t.id}')`,
  }))
  globalUIState.commandMenu = { query: '', results, context: globalUIState.commandMenu?.context || '/' }
  emitGlobalUI()
  return c.body(null, 204)
})

// Time travel: enter
app.post('/boards/:boardId/time-travel', async (c) => {
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
