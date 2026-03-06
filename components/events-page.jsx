/** @jsxImportSource hono/jsx */
import { Icon } from './icon.jsx'
import { base } from '../lib/base.js'
import { raw } from 'hono/html'
import { EVENTS_CSS } from '../css/events.css.js'

export function typeClass(type) {
  if (type.includes('deleted') || type.includes('Deleted')) return 'type type--delete'
  if (type.includes('moved') || type.includes('Moved')) return 'type type--move'
  if (type.includes('created') || type.includes('Created')) return 'type type--create'
  if (type.includes('Updated') || type.includes('updated')) return 'type type--update'
  return 'type'
}

export function summarizeEvent(evt) {
  const { type, data } = evt
  switch (type) {
    case 'board.created': return `Created board "${data.title}"`
    case 'board.titleUpdated': return `Renamed board to "${data.title}"`
    case 'board.deleted': return `Deleted board`
    case 'column.created': return `Created column "${data.title}"`
    case 'column.deleted': return `Deleted column`
    case 'column.moved': return `Moved column`
    case 'card.created': return `Created card "${data.title}"`
    case 'card.moved': return `Moved card`
    case 'card.titleUpdated': return `Renamed card to "${data.title}"`
    case 'card.descriptionUpdated': return data.description ? `Updated card description` : `Cleared card description`
    case 'card.labelUpdated': return data.label ? `Set card label to ${data.label}` : `Removed card label`
    case 'card.deleted': return `Deleted card`
    default: return type
  }
}

export function EventList({ events, boardFilter, boards }) {
  const filtered = boardFilter ? events.filter(e => {
    // board events: data.id is the boardId
    if (e.type.startsWith('board.')) return e.data.id === boardFilter
    // column/card events: data.boardId if present
    if (e.data.boardId) return e.data.boardId === boardFilter
    // card events without boardId — need column lookup (resolved at render time via _boardId annotation)
    if (e._boardId) return e._boardId === boardFilter
    return false
  }) : events
  const synced = filtered.filter(e => e.synced).length
  const local = filtered.length - synced
  return (
    <div id="event-list" class="event-list">
      <p class="event-count">{filtered.length} events — {local} local{synced > 0 ? `, ${synced} synced` : ''}{boardFilter && boards ? ` — filtered to "${boards.find(b => b.id === boardFilter)?.title || boardFilter}"` : ''}</p>
      {filtered.length === 0
        ? <p style="color: var(--neutral-6); padding: 16px;">No events yet.</p>
        : [...filtered].reverse().map(evt => (
            <details id={`evt-${evt.seq}`}>
              <summary>
                <span class="seq">{evt.seq}</span>
                <span class={typeClass(evt.type)}>{evt.type}</span>
                <span class="evt-summary">{summarizeEvent(evt)}</span>
                <span class={evt.synced ? 'synced synced--yes' : 'synced synced--no'}>
                  {evt.synced ? 'synced' : 'local'}
                </span>
                <span class="ts">{new Date(evt.ts).toLocaleTimeString()}</span>
              </summary>
              <pre>{raw(JSON.stringify(evt, (k, v) => k === '_boardId' ? undefined : v, 2).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '&#10;'))}</pre>
            </details>
          ))}
    </div>
  )
}

export function EventsPage({ boards, boardFilter }) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        <meta id="theme-color-meta" name="theme-color" content="#121017" />
        <link rel="manifest" href={`${base()}manifest.json`} />
        <link rel="icon" href={`${base()}icon.svg`} type="image/svg+xml" />
        <script>{raw(`(function(){var t=localStorage.getItem('theme')||'system';var dark=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.dataset.theme=dark?'dark':'light';var m=document.getElementById('theme-color-meta');if(m)m.content=dark?'#121017':'#f4eefa'})()`)}</script>
        <link rel="stylesheet" href={`${base()}${__STELLAR_CSS__}`} />
        <title>Event Log{boardFilter && boards ? ` — ${boards.find(b => b.id === boardFilter)?.title || ''}` : ''}</title>
        <style>{raw(EVENTS_CSS)}</style>
        <script
          type="module"
          src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.8/bundles/datastar.js"
        ></script>
      </head>
      <body>
        <h1>Event Log <span><a href={base()}><Icon name="lucide:arrow-left" /> boards</a></span></h1>
        <div class="actions">
          <select class="board-filter" onchange={`window.location.href='${base()}events' + (this.value ? '?board=' + this.value : '')`}>
            <option value="">All boards</option>
            {boards.map(b => (
              <option value={b.id} selected={b.id === boardFilter}>{b.title}</option>
            ))}
          </select>
          <button
            data-indicator="_rebuilding"
            data-on:click={`@post('${base()}rebuild')`}
            data-attr:disabled="$_rebuilding"
          >
            <span data-show="!$_rebuilding">Rebuild Projection</span>
            <span data-show="$_rebuilding">Rebuilding...</span>
          </button>
        </div>
        <div class="events-scroll"
          id="events-app"
          data-init={`@get('${base()}events${boardFilter ? `?board=${boardFilter}` : ''}', { retry: 'always', retryMaxCount: 1000 })`}
        >
          <p style="color: var(--neutral-6);">Connecting...</p>
        </div>
        <script>{raw(`
          if (navigator.serviceWorker) {
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              window.location.reload();
            });
          }
          // Auto-scroll to top when new events arrive (list is reverse-chronological)
          const target = document.getElementById('events-app');
          if (target) {
            new MutationObserver(() => {
              target.scrollTop = 0;
            }).observe(target, { childList: true, subtree: true });
          }
        `)}</script>
      </body>
    </html>
  )
}
