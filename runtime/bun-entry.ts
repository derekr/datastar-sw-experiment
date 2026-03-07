import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { createApp } from '../sw.jsx'

declare const Bun: any

const basePath = process.env.BASE_PATH || '/'
const port = Number(process.env.PORT || 3000)

const app = createApp({
  basePath,
  matchClients: async () => [],
  isOnline: () => true,
})

// Thin Bun adapter: serve static assets + delegate app routes to the shared Hono app
const server = new Hono()
server.use('/assets/*', serveStatic({ root: './dist' }))
server.use('/css/*', serveStatic({ root: './' }))
server.use('/icon.svg', serveStatic({ path: './public/icon.svg' }))
server.use('/manifest.json', serveStatic({ path: './public/manifest.json' }))
server.route('/', app)

Bun.serve({
  port,
  fetch: server.fetch,
})

console.log(`[bun] serving on http://localhost:${port}${basePath}`)
