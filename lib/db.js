import { openDB } from 'idb'

// --- Database ---

export const dbPromise = openDB('kanban', 3, {
  upgrade(db, oldVersion, _newVersion, tx) {
    if (oldVersion < 1) {
      db.createObjectStore('columns', { keyPath: 'id' })
      const cards = db.createObjectStore('cards', { keyPath: 'id' })
      cards.createIndex('byColumn', 'columnId')
    }
    if (oldVersion < 2) {
      const events = db.createObjectStore('events', { autoIncrement: true, keyPath: 'seq' })
      events.createIndex('byId', 'id', { unique: true })
      events.createIndex('bySynced', 'synced')
      db.createObjectStore('meta', { keyPath: 'key' })
    }
    if (oldVersion < 3) {
      db.createObjectStore('boards', { keyPath: 'id' })
      // Add byBoard index to columns (need to recreate if store already exists)
      const colStore = tx.objectStore('columns')
      if (!colStore.indexNames.contains('byBoard')) {
        colStore.createIndex('byBoard', 'boardId')
      }
    }
  },
})

// --- Event bus (CQRS: commands append events, queries listen) ---

export const bus = new EventTarget()

// --- Event log operations ---

// Append event to log + apply to projection in a single transaction.
// Idempotent: skips events already in the log (by event ID).
export const ALL_STORES = ['events', 'boards', 'columns', 'cards']

// Stable device identifier, resolved during initialize().
export const actorId = { value: null }
