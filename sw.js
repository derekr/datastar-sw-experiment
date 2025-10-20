import { createRouter, route, html } from '@remix-run/fetch-router';

let counter = 0;
const eventTarget = new EventTarget();

console.log('[SW] Service Worker initializing, counter:', counter);

const routes = route({
  home: '/',
  increment: { method: 'POST', pattern: '/increment' },
});

const router = createRouter();

router.get(routes.home, ({ request }) => {
  const isDatastarRequest = request.headers.get('Datastar-Request') === 'true';
  console.log('[SW] / route hit, isDatastarRequest:', isDatastarRequest, 'counter:', counter);
  
  if (isDatastarRequest) {
    console.log('[SW] Opening SSE connection for counter:', counter);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const handler = () => {
          try {
            console.log('[SW] Increment event fired, counter:', counter);
            const html = `<div id="counter"><span>${counter}</span></div>`;
            const data = `event: datastar-patch-elements\ndata: elements ${html}\n\n`;
            controller.enqueue(encoder.encode(data));
          } catch (e) {
            console.log('[SW] Error in increment handler:', e);
            eventTarget.removeEventListener('increment', handler);
          }
        };
        
        eventTarget.addEventListener('increment', handler);
        console.log('[SW] Event listener added');
        
        const initialHtml = `<div id="counter"><span>${counter}</span></div>`;
        const initialData = `event: datastar-patch-elements\ndata: elements ${initialHtml}\n\n`;
        controller.enqueue(encoder.encode(initialData));
        console.log('[SW] Initial counter sent:', counter);
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
  
  return html(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Datastar SW Demo</title>
        <script type="module" src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.5/bundles/datastar.js"></script>
      </head>
      <body>
        <h1>Datastar Service Worker Demo</h1>
        <div id="counter" data-on-load="@get('${routes.home.href()}')"><span>${counter}</span></div>
        <button data-on-click="@post('${routes.increment.href()}')">Increment</button>
      </body>
    </html>
  `);
});

router.post(routes.increment, () => {
  console.log('[SW] /increment hit, current counter:', counter);
  counter++;
  console.log('[SW] Counter incremented to:', counter);
  eventTarget.dispatchEvent(new Event('increment'));
  console.log('[SW] Increment event dispatched');
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
