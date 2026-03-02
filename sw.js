import { createRouter } from '@remix-run/fetch-router';
import { route } from '@remix-run/fetch-router/routes';
import { openDB } from 'idb';

// --- Database ---

const dbPromise = openDB('kanban', 1, {
  upgrade(db) {
    db.createObjectStore('columns', { keyPath: 'id' });
    const cards = db.createObjectStore('cards', { keyPath: 'id' });
    cards.createIndex('byColumn', 'columnId');
  },
});

async function seed() {
  const db = await dbPromise;
  if ((await db.count('columns')) > 0) return;
  const tx = db.transaction('columns', 'readwrite');
  tx.store.put({ id: 'todo', title: 'Todo', position: 0 });
  tx.store.put({ id: 'doing', title: 'Doing', position: 1 });
  tx.store.put({ id: 'done', title: 'Done', position: 2 });
  await tx.done;
}

// --- Event bus ---

const events = new EventTarget();

// --- Routes ---

const routes = route({
  home: '/',
  createCard: { method: 'POST', pattern: '/columns/:columnId/cards' },
  moveCard: { method: 'PUT', pattern: '/cards/:cardId/move' },
  deleteCard: { method: 'DELETE', pattern: '/cards/:cardId' },
});

const router = createRouter();

// --- Helpers ---

async function getBoard() {
  const db = await dbPromise;
  const columns = (await db.getAll('columns')).sort((a, b) => a.position - b.position);
  const cards = await db.getAll('cards');
  return { columns, cards };
}

function esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dropExpr(columnId) {
  return [
    `evt.preventDefault()`,
    `evt.currentTarget.classList.remove('drag-over')`,
    `const cardId = evt.dataTransfer.getData('cardId')`,
    `$dropColumnId = '${columnId}'`,
    `$dropPosition = 0`,
    `@put('/cards/' + cardId + '/move')`,
  ].join('; ');
}

function renderBoard(columns, cards) {
  const columnsHtml = columns.map(col => {
    const colCards = cards
      .filter(c => c.columnId === col.id)
      .sort((a, b) => a.position - b.position);

    const cardsHtml = colCards.length === 0
      ? `<p class="empty">No cards yet</p>`
      : colCards.map(card => `
          <div class="card"
               draggable="true"
               data-card-id="${card.id}"
               style="view-transition-name: card-${card.id}"
               data-on:dragstart="evt.dataTransfer.effectAllowed = 'move'; evt.dataTransfer.setData('cardId', '${card.id}'); evt.target.classList.add('dragging')"
               data-on:dragend="evt.target.classList.remove('dragging')">
            <span>${esc(card.title)}</span>
            <button class="delete-btn" data-on:click__viewtransition="@delete('/cards/${card.id}')">×</button>
          </div>
        `).join('');

    return `
      <div class="column" id="column-${col.id}" style="view-transition-name: col-${col.id}">
        <div class="column-header">
          <h2>${col.title}</h2>
          <span class="count">${colCards.length}</span>
        </div>
        <div class="cards-container"
             data-column-id="${col.id}"
             data-on:dragover="evt.preventDefault(); evt.currentTarget.classList.add('drag-over')"
             data-on:dragleave="evt.currentTarget.classList.remove('drag-over')"
             data-on:drop="${dropExpr(col.id)}">
          ${cardsHtml}
        </div>
        <form class="add-form" data-on:submit__prevent__viewtransition="@post('/columns/${col.id}/cards', {contentType: 'form'})">
          <input name="title" type="text" placeholder="Add a card..." autocomplete="off" />
          <button type="submit">+</button>
        </form>
      </div>
    `;
  }).join('');

  return `
    <div id="board">
      <h1>Kanban Board</h1>
      <div class="columns">${columnsHtml}</div>
    </div>
  `;
}

function sseEvent(selector, html, mode = 'outer') {
  const flat = html.replace(/\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return `event: datastar-patch-elements\ndata: mode ${mode}\ndata: selector ${selector}\ndata: elements ${flat}\n\n`;
}

async function parseBody(request) {
  const ct = request.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) return request.json();
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    const fd = await request.formData();
    return Object.fromEntries(fd.entries());
  }
  try { return await request.json(); } catch { return {}; }
}

// --- Route handlers ---

router.get(routes.home, async ({ request }) => {
  await seed();
  const isDatastarRequest = request.headers.get('Datastar-Request') === 'true';

  if (isDatastarRequest) {
    const encoder = new TextEncoder();
    let handler;
    const stream = new ReadableStream({
      async start(controller) {
        handler = async () => {
          try {
            const { columns, cards } = await getBoard();
            controller.enqueue(encoder.encode(sseEvent('#board', renderBoard(columns, cards))));
          } catch (e) {
            console.error('[SW] Board update error:', e);
            events.removeEventListener('boardChanged', handler);
          }
        };

        events.addEventListener('boardChanged', handler);

        // Initial render — patch app shell inner content
        const { columns, cards } = await getBoard();
        controller.enqueue(encoder.encode(sseEvent('#app', renderBoard(columns, cards), 'inner')));
      },
      cancel() {
        events.removeEventListener('boardChanged', handler);
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

  return new Response(SHELL, { headers: { 'Content-Type': 'text/html' } });
});

router.post(routes.createCard, async ({ request, params }) => {
  const { columnId } = params;
  const ct = request.headers.get('Content-Type') || '';
  const bodyText = await request.clone().text();
  console.log('[SW] createCard columnId:', columnId, 'Content-Type:', ct, 'body:', bodyText);

  let title = '';
  if (ct.includes('application/x-www-form-urlencoded')) {
    const fd = new URLSearchParams(bodyText);
    title = (fd.get('title') || '').trim();
  } else if (ct.includes('application/json')) {
    try {
      const body = JSON.parse(bodyText);
      title = (body.title || '').trim();
    } catch {}
  }

  console.log('[SW] Parsed title:', JSON.stringify(title));
  if (!title) return new Response(null, { status: 204 });

  const db = await dbPromise;
  const colCards = await db.getAllFromIndex('cards', 'byColumn', columnId);

  await db.put('cards', {
    id: crypto.randomUUID(),
    columnId,
    title,
    position: colCards.length,
  });

  events.dispatchEvent(new Event('boardChanged'));
  return new Response(null, { status: 204 });
});

router.put(routes.moveCard, async ({ request, params }) => {
  const body = await parseBody(request);
  const { cardId } = params;
  const targetColumnId = body.dropColumnId;
  const targetPosition = parseInt(body.dropPosition, 10) || 0;

  if (!targetColumnId) return new Response(null, { status: 400 });

  const db = await dbPromise;
  const card = await db.get('cards', cardId);
  if (!card) return new Response(null, { status: 404 });

  const sourceColumnId = card.columnId;
  const allCards = await db.getAll('cards');

  // Remove card from source, collect target column
  const sourceCards = allCards
    .filter(c => c.columnId === sourceColumnId && c.id !== cardId)
    .sort((a, b) => a.position - b.position);

  const targetCards = sourceColumnId === targetColumnId
    ? [...sourceCards]
    : allCards
        .filter(c => c.columnId === targetColumnId && c.id !== cardId)
        .sort((a, b) => a.position - b.position);

  // Insert at drop position
  targetCards.splice(targetPosition, 0, { ...card, columnId: targetColumnId });

  // Write all updates in a single transaction
  const tx = db.transaction('cards', 'readwrite');
  if (sourceColumnId !== targetColumnId) {
    for (let i = 0; i < sourceCards.length; i++) {
      tx.store.put({ ...sourceCards[i], position: i });
    }
  }
  for (let i = 0; i < targetCards.length; i++) {
    tx.store.put({ ...targetCards[i], columnId: targetColumnId, position: i });
  }
  await tx.done;

  events.dispatchEvent(new Event('boardChanged'));
  return new Response(null, { status: 204 });
});

router.delete(routes.deleteCard, async ({ params }) => {
  const db = await dbPromise;
  await db.delete('cards', params.cardId);
  events.dispatchEvent(new Event('boardChanged'));
  return new Response(null, { status: 204 });
});

// --- Shell HTML ---

const SHELL = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kanban Board</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      padding: 24px;
      min-height: 100vh;
    }

    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 24px; }

    .columns {
      display: flex;
      gap: 16px;
      overflow-x: auto;
      padding-bottom: 16px;
      align-items: flex-start;
    }

    .column {
      background: #1e293b;
      border-radius: 12px;
      padding: 16px;
      min-width: 300px;
      max-width: 300px;
      flex-shrink: 0;
    }

    .column-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .column-header h2 {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94a3b8;
      font-weight: 600;
    }

    .count {
      font-size: 0.75rem;
      background: #334155;
      color: #94a3b8;
      padding: 2px 8px;
      border-radius: 10px;
    }

    .cards-container {
      min-height: 48px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      border-radius: 8px;
      padding: 4px;
      transition: background 0.15s, box-shadow 0.15s;
    }

    .cards-container.drag-over {
      background: rgba(99, 102, 241, 0.08);
      box-shadow: inset 0 0 0 2px rgba(99, 102, 241, 0.3);
    }

    .empty {
      color: #475569;
      font-size: 0.85rem;
      text-align: center;
      padding: 16px;
    }

    .card {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: grab;
      transition: opacity 0.15s, transform 0.15s, box-shadow 0.15s;
    }

    .card:hover { border-color: #475569; }
    .card:active { cursor: grabbing; }
    .card.dragging { opacity: 0.4; transform: scale(0.97); }

    .card span { font-size: 0.9rem; word-break: break-word; }

    .delete-btn {
      background: none;
      border: none;
      color: #475569;
      cursor: pointer;
      font-size: 1.1rem;
      padding: 0 4px;
      flex-shrink: 0;
      line-height: 1;
      transition: color 0.15s;
    }

    .delete-btn:hover { color: #ef4444; }

    .add-form {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }

    .add-form input {
      flex: 1;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 8px 10px;
      color: #e2e8f0;
      font-size: 0.85rem;
    }

    .add-form input::placeholder { color: #475569; }
    .add-form input:focus { outline: none; border-color: #6366f1; }

    .add-form button {
      background: #6366f1;
      border: none;
      border-radius: 6px;
      color: #fff;
      padding: 8px 14px;
      cursor: pointer;
      font-size: 1rem;
      font-weight: 600;
      transition: background 0.15s;
    }

    .add-form button:hover { background: #4f46e5; }

    /* View transition animations */
    ::view-transition-old(*) {
      animation: fade-out 0.15s ease-out;
    }
    ::view-transition-new(*) {
      animation: fade-in 0.2s ease-in;
    }

    @keyframes fade-out { to { opacity: 0; transform: scale(0.95); } }
    @keyframes fade-in { from { opacity: 0; transform: scale(0.95); } }
  </style>
  <script type="module" src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.8/bundles/datastar.js"></script>
</head>
<body>
  <main id="app"
        data-init="@get('/', { retry: 'always', retryMaxCount: 1000 })"
        data-signals:dropColumnId="''"
        data-signals:dropPosition="0">
    <p>Loading...</p>
  </main>
</body>
</html>`;

// --- Service Worker lifecycle ---

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  console.log('[SW] Fetch:', event.request.method, url.pathname, 'Content-Type:', event.request.headers.get('Content-Type'));
  event.respondWith(router.fetch(event.request));
});
