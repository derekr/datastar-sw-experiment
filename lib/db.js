import { createIdbAdapter } from './db/idb-adapter.js'

// --- Database ---

export const dbAdapter = createIdbAdapter()
export const dbPromise = dbAdapter.getDb()

export async function getDb() {
  return dbAdapter.getDb()
}

export async function beginTx(stores, mode = 'readonly') {
  const db = await getDb()
  return db.transaction(stores, mode)
}

export async function getRecord(store, key) {
  const db = await getDb()
  return db.get(store, key)
}

export async function getAllRecords(store) {
  const db = await getDb()
  return db.getAll(store)
}

export async function getAllFromIndex(store, index, key) {
  const db = await getDb()
  return db.getAllFromIndex(store, index, key)
}

export async function countRecords(store) {
  const db = await getDb()
  return db.count(store)
}

// --- Event bus (CQRS: commands append events, queries listen) ---

export const bus = new EventTarget()

// --- Event log operations ---

// Append event to log + apply to projection in a single transaction.
// Idempotent: skips events already in the log (by event ID).
export const ALL_STORES = dbAdapter.allStores

// Stable device identifier, resolved during initialize().
export const actorId = { value: null }
