import { setRuntimeConfig } from '../lib/runtime.js'
import { registerConnectionListeners } from '../lib/tabs.js'

export function registerServiceWorkerRuntime(app) {
  if (typeof self === 'undefined' || !self.addEventListener || !self.registration?.scope || !self.clients?.claim) return

  const scopePath = new URL(self.registration.scope).pathname
  setRuntimeConfig({
    basePath: scopePath,
    matchClients: () => self.clients.matchAll({ type: 'window' }),
    isOnline: () => navigator.onLine,
    subscribeConnectionChange: (handler) => {
      self.addEventListener('online', handler)
      self.addEventListener('offline', handler)
      return () => {
        self.removeEventListener('online', handler)
        self.removeEventListener('offline', handler)
      }
    },
  })
  registerConnectionListeners()

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
    // e.g. /datastar-sw-experiment/boards/123 -> /boards/123
    if (scopePath !== '/' && url.pathname.startsWith(scopePath)) {
      url.pathname = '/' + url.pathname.slice(scopePath.length)
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
}
