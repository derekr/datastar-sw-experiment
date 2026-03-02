import { createRouter } from '@remix-run/fetch-router';
import { route } from '@remix-run/fetch-router/routes';
import { openDB } from 'idb';

// DB opens lazily on first await — survives SW cold restarts
const dbPromise = openDB('datastar-sw', 1, {
  upgrade(db) {
    db.createObjectStore('state');
  },
});

const eventTarget = new EventTarget();

console.log('[SW] Service Worker initializing');

const routes = route({
  home: '/',
  increment: { method: 'POST', pattern: '/increment' },
});

const router = createRouter();

router.get(routes.home, async ({ request }) => {
  const isDatastarRequest = request.headers.get('Datastar-Request') === 'true';
  const db = await dbPromise;
  const counter = (await db.get('state', 'counter')) ?? 0;
  console.log('[SW] / route hit, isDatastarRequest:', isDatastarRequest, 'counter:', counter);

  if (isDatastarRequest) {
    console.log('[SW] Opening SSE connection for counter:', counter);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const handler = async () => {
          try {
            const db = await dbPromise;
            const current = (await db.get('state', 'counter')) ?? 0;
            console.log('[SW] Increment event fired, counter:', current);
            const html = `<div id="counter"><span>${current}</span></div>`;
            const data = `event: datastar-patch-elements\ndata: elements ${html}\n\n`;
            controller.enqueue(encoder.encode(data));
          } catch (e) {
            console.log('[SW] Error in increment handler:', e);
            eventTarget.removeEventListener('increment', handler);
          }
        };

        eventTarget.addEventListener('increment', handler);
        console.log('[SW] Event listener added');

        // Initial event patches the app shell content via inner mode
        const appHtml = `<div id="counter"><span>${counter}</span></div><button data-on:click="@post('${routes.increment.href()}')">Increment</button>`;
        const initialData = `event: datastar-patch-elements\ndata: mode inner\ndata: selector #app\ndata: elements ${appHtml}\n\n`;
        controller.enqueue(encoder.encode(initialData));
        console.log('[SW] Initial app content sent, counter:', counter);
      },
      cancel() {
        console.log('[SW] SSE connection cancelled');
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });
  }

  return new Response(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Datastar SW Demo</title>
        <script type="module" src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.8/bundles/datastar.js"></script>
      </head>
      <body>
        <h1>Datastar Service Worker Demo</h1>
        <main id="app" data-init="@get('${routes.home.href()}')">
          <p>Loading...</p>
        </main>
      </body>
    </html>
  `, { headers: { 'Content-Type': 'text/html' } });
});

router.post(routes.increment, async () => {
  const db = await dbPromise;
  const counter = (await db.get('state', 'counter')) ?? 0;
  const next = counter + 1;
  await db.put('state', next, 'counter');
  console.log('[SW] /increment:', counter, '->', next);
  eventTarget.dispatchEvent(new Event('increment'));
  return new Response(null, { status: 204 });
});

self.addEventListener('install', (event) => {
  console.log('[SW] Service Worker installing');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Service Worker activating');
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  console.log('[SW] Fetch event:', event.request.method, url.pathname);

  event.respondWith(router.fetch(event.request));
});
