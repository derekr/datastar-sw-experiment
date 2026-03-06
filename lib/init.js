import { dbPromise, ALL_STORES, bus, actorId } from './db.js'
import { applyEvent, createEvent, appendEvent } from './events.js'
import { cmpPosition } from './position.js'

// Nuclear rebuild: clear projection, replay all events in order.
// Use when projection is suspected to be out of sync with the event log.
// Saves a snapshot afterward so future incremental rebuilds can skip replayed events.
export async function rebuildProjection() {
  const db = await dbPromise
  const tx = db.transaction(ALL_STORES, 'readwrite')
  await tx.objectStore('boards').clear()
  await tx.objectStore('columns').clear()
  await tx.objectStore('cards').clear()
  const allEvents = await tx.objectStore('events').getAll()
  for (const event of allEvents) {
    await applyEvent(event, tx)
  }
  // Save snapshot: projection state at the last replayed event seq
  const lastSeq = allEvents.length > 0 ? allEvents[allEvents.length - 1].seq : 0
  await tx.objectStore('meta').put({
    key: 'snapshot',
    seq: lastSeq,
    boards: await tx.objectStore('boards').getAll(),
    columns: await tx.objectStore('columns').getAll(),
    cards: await tx.objectStore('cards').getAll(),
  })
  const boardIds = (await tx.objectStore('boards').getAllKeys())
  await tx.done
  // Notify all scoped listeners after full rebuild
  bus.dispatchEvent(new CustomEvent('boards:changed', { detail: null }))
  for (const id of boardIds) {
    bus.dispatchEvent(new CustomEvent(`board:${id}:changed`, { detail: null }))
  }
  bus.dispatchEvent(new CustomEvent('events:changed', { detail: null }))
}

// Incremental rebuild: restore from snapshot, replay only newer events.
// Falls back to full rebuildProjection() if no snapshot exists.
export async function rebuildFromSnapshot() {
  const db = await dbPromise
  const snapshot = await db.get('meta', 'snapshot')
  if (!snapshot) return rebuildProjection()

  const tx = db.transaction(ALL_STORES, 'readwrite')
  // Restore projection from snapshot
  await tx.objectStore('boards').clear()
  await tx.objectStore('columns').clear()
  await tx.objectStore('cards').clear()
  for (const b of snapshot.boards) await tx.objectStore('boards').put(b)
  for (const c of snapshot.columns) await tx.objectStore('columns').put(c)
  for (const c of snapshot.cards) await tx.objectStore('cards').put(c)
  // Replay only events after the snapshot seq
  const range = IDBKeyRange.lowerBound(snapshot.seq, true) // exclusive
  const newEvents = await tx.objectStore('events').getAll(range)
  for (const event of newEvents) {
    await applyEvent(event, tx)
  }
  const boardIds = (await tx.objectStore('boards').getAllKeys())
  await tx.done
  bus.dispatchEvent(new CustomEvent('boards:changed', { detail: null }))
  for (const id of boardIds) {
    bus.dispatchEvent(new CustomEvent(`board:${id}:changed`, { detail: null }))
  }
  bus.dispatchEvent(new CustomEvent('events:changed', { detail: null }))
}

// --- Initialization ---

// Backfill events from pre-event-sourcing data (v1 → v2 migration).
// Existing projection data is preserved; events are created retroactively
// so the log can rebuild the same state.
export async function migrateFromV1() {
  const db = await dbPromise
  if ((await db.count('events')) > 0) return
  const columns = await db.getAll('columns')
  if (columns.length === 0) return
  const cards = await db.getAll('cards')
  const tx = db.transaction('events', 'readwrite')
  for (const col of columns.sort(cmpPosition)) {
    await tx.store.put(createEvent('column.created', col))
  }
  for (const card of cards.sort(cmpPosition)) {
    await tx.store.put(createEvent('card.created', card))
  }
  await tx.done
}

// Migrate pre-boards data: ensure all columns have a boardId and a board exists.
// Appends a board.created event then rebuilds the projection. The column.created
// upcaster (v1→v2) adds boardId:'default' to existing column events during replay,
// so no direct projection writes are needed.
export async function migrateToBoards() {
  const db = await dbPromise
  const boards = await db.getAll('boards')
  if (boards.length > 0) return // already migrated
  const columns = await db.getAll('columns')
  if (columns.length === 0) return // nothing to migrate
  // Append board event and let rebuildProjection handle column tagging via upcaster
  await appendEvent(createEvent('board.created', {
    id: 'default',
    title: 'My Board',
    createdAt: Date.now(),
  }))
  await rebuildProjection()
}

// Seed: no-op if any boards exist. Fresh install creates nothing — user creates their first board.
export async function seed() {
  // Legacy seed for pre-boards installs (no events, no columns = fresh)
  const db = await dbPromise
  if ((await db.count('events')) > 0) return
  if ((await db.count('columns')) > 0) return
  // Fresh install — no default data, user creates first board from /
}

let initialized = false
export async function initialize() {
  if (initialized) return
  initialized = true
  // Resolve stable device identity
  const db = await dbPromise
  const stored = await db.get('meta', 'actorId')
  if (stored) {
    actorId.value = stored.value
  } else {
    actorId.value = crypto.randomUUID()
    await db.put('meta', { key: 'actorId', value: actorId.value })
  }
  await migrateFromV1()
  await seed()
  await migrateToBoards()
}

// --- Sync (S2 stub — activate when credentials are configured) ---

export async function pushEvents() {
  const db = await dbPromise
  const config = await db.get('meta', 's2Config')
  if (!config?.value) return
  // const unsynced = await db.getAllFromIndex('events', 'bySynced', false)
  // TODO: append to S2 stream via @s2-dev/streamstore, mark synced
}

export async function pullEvents() {
  const db = await dbPromise
  const config = await db.get('meta', 's2Config')
  if (!config?.value) return
  // const lastSeq = (await db.get('meta', 'lastS2Seq'))?.value || 0n
  // TODO: read from S2 stream, appendEvent() each (idempotent by ID)
}
