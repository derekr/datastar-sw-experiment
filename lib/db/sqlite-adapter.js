function parseRow(row) {
  return row ? JSON.parse(row.json) : null
}

function toSyncedInt(value) {
  return value ? 1 : 0
}

function ensureSchema(db) {
  db.run('PRAGMA journal_mode = WAL;')
  db.run('CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, json TEXT NOT NULL)')
  db.run('CREATE TABLE IF NOT EXISTS columns (id TEXT PRIMARY KEY, boardId TEXT, position TEXT, json TEXT NOT NULL)')
  db.run('CREATE INDEX IF NOT EXISTS idx_columns_board ON columns(boardId)')
  db.run('CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, columnId TEXT, position TEXT, json TEXT NOT NULL)')
  db.run('CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(columnId)')
  db.run('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, json TEXT NOT NULL)')
  db.run('CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, synced INTEGER, ts INTEGER, type TEXT, json TEXT NOT NULL)')
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_events_id ON events(id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_events_synced ON events(synced)')
}

function createStore(db, name) {
  if (name === 'boards') {
    return {
      async get(id) { return parseRow(db.query('SELECT json FROM boards WHERE id = ?').get(id)) },
      async put(value) {
        db.query('INSERT INTO boards (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(value.id, JSON.stringify(value))
      },
      async delete(id) { db.query('DELETE FROM boards WHERE id = ?').run(id) },
      async clear() { db.run('DELETE FROM boards') },
      async getAll() { return db.query('SELECT json FROM boards').all().map(parseRow) },
      async getAllKeys() { return db.query('SELECT id FROM boards').all().map(r => r.id) },
      index() { throw new Error('boards has no indexes') },
    }
  }
  if (name === 'columns') {
    return {
      async get(id) { return parseRow(db.query('SELECT json FROM columns WHERE id = ?').get(id)) },
      async put(value) {
        db.query('INSERT INTO columns (id, boardId, position, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET boardId=excluded.boardId, position=excluded.position, json=excluded.json')
          .run(value.id, value.boardId || null, value.position || null, JSON.stringify(value))
      },
      async delete(id) { db.query('DELETE FROM columns WHERE id = ?').run(id) },
      async clear() { db.run('DELETE FROM columns') },
      async getAll() { return db.query('SELECT json FROM columns').all().map(parseRow) },
      async getAllKeys() { return db.query('SELECT id FROM columns').all().map(r => r.id) },
      index(indexName) {
        if (indexName !== 'byBoard') throw new Error(`Unknown index columns.${indexName}`)
        return {
          async getAll(boardId) {
            return db.query('SELECT json FROM columns WHERE boardId = ?').all(boardId).map(parseRow)
          },
          async get(boardId) {
            return parseRow(db.query('SELECT json FROM columns WHERE boardId = ? LIMIT 1').get(boardId))
          },
        }
      },
    }
  }
  if (name === 'cards') {
    return {
      async get(id) { return parseRow(db.query('SELECT json FROM cards WHERE id = ?').get(id)) },
      async put(value) {
        db.query('INSERT INTO cards (id, columnId, position, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET columnId=excluded.columnId, position=excluded.position, json=excluded.json')
          .run(value.id, value.columnId || null, value.position || null, JSON.stringify(value))
      },
      async delete(id) { db.query('DELETE FROM cards WHERE id = ?').run(id) },
      async clear() { db.run('DELETE FROM cards') },
      async getAll() { return db.query('SELECT json FROM cards').all().map(parseRow) },
      async getAllKeys() { return db.query('SELECT id FROM cards').all().map(r => r.id) },
      index(indexName) {
        if (indexName !== 'byColumn') throw new Error(`Unknown index cards.${indexName}`)
        return {
          async getAll(columnId) {
            return db.query('SELECT json FROM cards WHERE columnId = ?').all(columnId).map(parseRow)
          },
          async get(columnId) {
            return parseRow(db.query('SELECT json FROM cards WHERE columnId = ? LIMIT 1').get(columnId))
          },
        }
      },
    }
  }
  if (name === 'meta') {
    return {
      async get(key) { return parseRow(db.query('SELECT json FROM meta WHERE key = ?').get(key)) },
      async put(value) {
        db.query('INSERT INTO meta (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(value.key, JSON.stringify(value))
      },
      async delete(key) { db.query('DELETE FROM meta WHERE key = ?').run(key) },
      async clear() { db.run('DELETE FROM meta') },
      async getAll() { return db.query('SELECT json FROM meta').all().map(parseRow) },
      async getAllKeys() { return db.query('SELECT key FROM meta').all().map(r => r.key) },
      index() { throw new Error('meta has no indexes') },
    }
  }
  if (name === 'events') {
    return {
      async get(seq) { return parseRow(db.query('SELECT json FROM events WHERE seq = ?').get(seq)) },
      async put(value) {
        const synced = toSyncedInt(value.synced)
        if (value.seq != null) {
          db.query('INSERT INTO events (seq, id, synced, ts, type, json) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(seq) DO UPDATE SET id=excluded.id, synced=excluded.synced, ts=excluded.ts, type=excluded.type, json=excluded.json')
            .run(value.seq, value.id, synced, value.ts || null, value.type || null, JSON.stringify(value))
        } else {
          db.query('INSERT INTO events (id, synced, ts, type, json) VALUES (?, ?, ?, ?, ?)').run(value.id, synced, value.ts || null, value.type || null, JSON.stringify(value))
        }
      },
      async delete(seq) { db.query('DELETE FROM events WHERE seq = ?').run(seq) },
      async clear() { db.run('DELETE FROM events') },
      async getAll(range) {
        if (range && typeof range.lower === 'number') {
          return db.query('SELECT json FROM events WHERE seq > ? ORDER BY seq ASC').all(range.lower).map(parseRow)
        }
        return db.query('SELECT json FROM events ORDER BY seq ASC').all().map(parseRow)
      },
      async getAllKeys() { return db.query('SELECT seq FROM events ORDER BY seq ASC').all().map(r => r.seq) },
      index(indexName) {
        if (indexName === 'byId') {
          return {
            async get(id) {
              return parseRow(db.query('SELECT json FROM events WHERE id = ? LIMIT 1').get(id))
            },
            async getAll(id) {
              return db.query('SELECT json FROM events WHERE id = ?').all(id).map(parseRow)
            },
          }
        }
        if (indexName === 'bySynced') {
          return {
            async getAll(synced) {
              return db.query('SELECT json FROM events WHERE synced = ? ORDER BY seq ASC').all(toSyncedInt(synced)).map(parseRow)
            },
            async get(synced) {
              return parseRow(db.query('SELECT json FROM events WHERE synced = ? ORDER BY seq ASC LIMIT 1').get(toSyncedInt(synced)))
            },
          }
        }
        throw new Error(`Unknown index events.${indexName}`)
      },
    }
  }
  throw new Error(`Unknown store: ${name}`)
}

function createDbFacade(sqliteDb) {
  return {
    async get(store, key) {
      return createStore(sqliteDb, store).get(key)
    },
    async put(store, value) {
      return createStore(sqliteDb, store).put(value)
    },
    async delete(store, key) {
      return createStore(sqliteDb, store).delete(key)
    },
    async count(store) {
      const table = store
      return sqliteDb.query(`SELECT COUNT(*) AS n FROM ${table}`).get().n
    },
    async getAll(store) {
      return createStore(sqliteDb, store).getAll()
    },
    async getAllFromIndex(store, index, key) {
      return createStore(sqliteDb, store).index(index).getAll(key)
    },
    transaction(stores, mode = 'readonly') {
      const storeNames = Array.isArray(stores) ? stores : [stores]
      sqliteDb.run(mode === 'readwrite' ? 'BEGIN IMMEDIATE' : 'BEGIN')
      let committed = false
      const tx = {
        objectStore(name) {
          if (!storeNames.includes(name)) {
            throw new Error(`Store ${name} not in transaction: ${storeNames.join(', ')}`)
          }
          return createStore(sqliteDb, name)
        },
      }
      if (storeNames.length === 1) {
        tx.store = tx.objectStore(storeNames[0])
      }
      tx.done = Promise.resolve().then(() => {
        if (!committed) {
          sqliteDb.run('COMMIT')
          committed = true
        }
      }).catch((err) => {
        sqliteDb.run('ROLLBACK')
        throw err
      })
      return tx
    },
    close() {
      sqliteDb.close()
    },
  }
}

export function createSqliteAdapter(Database, filename = 'kanban.sqlite') {
  const sqliteDb = new Database(filename)
  ensureSchema(sqliteDb)
  const facade = createDbFacade(sqliteDb)
  return {
    getDb() {
      return Promise.resolve(facade)
    },
    allStores: ['events', 'boards', 'columns', 'cards'],
  }
}
