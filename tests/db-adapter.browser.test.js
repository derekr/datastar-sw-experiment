import { beforeEach, describe, expect, it } from 'vitest'
import { createIdbAdapter } from '../lib/db/idb-adapter.js'

function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = () => resolve()
    req.onblocked = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

beforeEach(async () => {
  await deleteDatabase('kanban')
})

describe('idb adapter contract', () => {
  it('creates expected stores and indexes', async () => {
    const adapter = createIdbAdapter()
    const db = await adapter.getDb()

    expect(adapter.allStores).toEqual(['events', 'boards', 'columns', 'cards'])

    const stores = Array.from(db.objectStoreNames)
    expect(stores).toEqual(expect.arrayContaining(['events', 'boards', 'columns', 'cards', 'meta']))

    const tx = db.transaction(['events', 'columns', 'cards'], 'readonly')
    expect(Array.from(tx.objectStore('events').indexNames)).toEqual(expect.arrayContaining(['byId', 'bySynced']))
    expect(Array.from(tx.objectStore('columns').indexNames)).toEqual(expect.arrayContaining(['byBoard']))
    expect(Array.from(tx.objectStore('cards').indexNames)).toEqual(expect.arrayContaining(['byColumn']))
    await tx.done
    db.close()
  })

  it('supports projection reads/writes through idb handle', async () => {
    const adapter = createIdbAdapter()
    const db = await adapter.getDb()

    const board = { id: 'b1', title: 'Test', createdAt: Date.now() }
    await db.put('boards', board)
    const readBoard = await db.get('boards', 'b1')

    expect(readBoard).toEqual(board)
    db.close()
  })
})
