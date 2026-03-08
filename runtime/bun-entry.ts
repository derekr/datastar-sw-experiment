import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { useDbAdapter } from '../lib/db.js'
import { createSqliteAdapter } from '../lib/db/sqlite-adapter.js'

declare const Bun: any

const basePath = process.env.BASE_PATH || '/'
const port = Number(process.env.PORT || 3000)
const boardConnections = new Map<string, number>()

// Provide non-Vite runtime define fallbacks for source execution in Bun.
// Asset decoupling is tracked separately in datastar_sw-xwdh.
;(globalThis as any).__STELLAR_CSS__ = 'css/stellar.css'
;(globalThis as any).__KANBAN_JS__ = 'eg-kanban.js'
;(globalThis as any).__LUCIDE_ICON_CSS__ = ''

// Configure SQLite adapter before loading the shared app module.
// @ts-ignore - bun:sqlite is available at runtime in Bun
const { Database } = await import('bun:sqlite')
const sqliteFile = process.env.SQLITE_FILE || 'kanban.sqlite'
useDbAdapter(createSqliteAdapter(Database, sqliteFile))

const { createApp } = await import('../sw.jsx')

const app = createApp({
  basePath,
  matchClients: async () => [],
  isOnline: () => true,
  onBoardStreamOpen: (boardId: string) => {
    boardConnections.set(boardId, (boardConnections.get(boardId) || 0) + 1)
  },
  onBoardStreamClose: (boardId: string) => {
    const next = (boardConnections.get(boardId) || 1) - 1
    if (next <= 0) boardConnections.delete(boardId)
    else boardConnections.set(boardId, next)
  },
  countBoardConnections: (boardId: string) => boardConnections.get(boardId) || 0,
})

// Thin Bun adapter: serve static assets + delegate app routes to the shared Hono app
const server = new Hono()
server.use('/assets/*', serveStatic({ root: './dist' }))
server.use('/css/*', serveStatic({ root: './' }))
server.use('/eg-kanban.js', serveStatic({ path: './eg-kanban.js' }))
server.use('/icon.svg', serveStatic({ path: './public/icon.svg' }))
server.use('/manifest.json', serveStatic({ path: './public/manifest.json' }))
server.route('/', app)

Bun.serve({
  port,
  idleTimeout: 255,
  fetch: server.fetch,
})

console.log(`[bun] serving on http://localhost:${port}${basePath}`)
