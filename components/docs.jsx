/** @jsxImportSource hono/jsx */
import { raw } from 'hono/html'
import { Icon } from './icon.jsx'
import { CommandMenu } from './command-menu.jsx'
import { DOCS_TOPICS } from '../lib/constants.js'
import { DOCS_CSS } from '../css/docs.css.js'
import { CSS } from '../css/app.css.js'
import { base } from '../lib/base.js'

export function DocsShell({ title, children }) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        <meta id="theme-color-meta" name="theme-color" content="#121017" />
        <link rel="manifest" href={`${base()}manifest.json`} />
        <link rel="icon" href={`${base()}icon.svg`} type="image/svg+xml" />
        <script>{raw(`(function(){var t=localStorage.getItem('theme')||'system';var dark=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.dataset.theme=dark?'dark':'light';var m=document.getElementById('theme-color-meta');if(m)m.content=dark?'#121017':'#f4eefa'})()`)}</script>
        <link rel="preload" href="https://fonts.bunny.net/inter/files/inter-latin-100-normal.woff2" as="font" type="font/woff2" crossorigin />
        <link rel="preload" href="https://fonts.bunny.net/inter/files/inter-latin-900-normal.woff2" as="font" type="font/woff2" crossorigin />
        <link rel="stylesheet" href={`${base()}${__STELLAR_CSS__}`} />
        <title>{title ? `${title} — Docs` : 'Docs'}</title>
        <style>{raw(CSS)}{raw(DOCS_CSS)}</style>
        <script
          type="module"
          src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.8/bundles/datastar.js"
        ></script>
      </head>
      <body>
        {children}
        <script>{raw(`
navigator.serviceWorker?.addEventListener('controllerchange',function(){location.reload()});
document.addEventListener('keydown',function(e){
  if((e.metaKey||e.ctrlKey)&&e.key==='k'){
    e.preventDefault();
    fetch('${base()}command-menu/open',{method:'POST',headers:{'X-Context':location.pathname}});
  }
  if(e.key==='Escape'&&document.getElementById('command-menu')){
    e.preventDefault();
    fetch('${base()}command-menu/close',{method:'POST'});
  }
});
var _lastCmd=false;
new MutationObserver(function(){
  var cm=document.getElementById('command-menu');
  if(cm&&!_lastCmd){var inp=document.getElementById('command-menu-input');if(inp)inp.focus()}
  _lastCmd=!!cm;
}).observe(document.body,{childList:true,subtree:true});
`)}</script>
      </body>
    </html>
  )
}

export function DocsSidebar({ currentSlug }) {
  const core = DOCS_TOPICS.filter(t => t.section === 'core')
  const bonus = DOCS_TOPICS.filter(t => t.section === 'bonus')
  return (
    <nav class="docs-sidebar" id="docs-sidebar">
      <a href={base()} class="docs-sidebar-home"><Icon name="lucide:arrow-left" /> Back to app</a>
      <a href={`${base()}docs`} class={`docs-sidebar-link docs-sidebar-overview${!currentSlug ? ' docs-sidebar-link--active' : ''}`}>Overview</a>
      <div class="docs-sidebar-section">
        <h3 class="docs-sidebar-heading">Core Concepts</h3>
        <ul class="docs-sidebar-list">
          {core.map(t => (
            <li><a href={`${base()}docs/${t.slug}`} class={`docs-sidebar-link${currentSlug === t.slug ? ' docs-sidebar-link--active' : ''}`}>{t.title}</a></li>
          ))}
        </ul>
      </div>
      <div class="docs-sidebar-section">
        <h3 class="docs-sidebar-heading">Bonus</h3>
        <ul class="docs-sidebar-list">
          {bonus.map(t => (
            <li><a href={`${base()}docs/${t.slug}`} class={`docs-sidebar-link${currentSlug === t.slug ? ' docs-sidebar-link--active' : ''}`}>{t.title}</a></li>
          ))}
        </ul>
      </div>
    </nav>
  )
}

// DocsPage: full HTML page wrapper (initial load only — NOT for SSE pushes)
// #docs-app is just the morph target; the grid lives on DocsInner.
export function DocsPage({ title, sseUrl, children }) {
  return (
    <DocsShell title={title}>
      <div id="docs-app" data-init={`@get('${base()}${sseUrl}', { retry: 'always', retryMaxCount: 1000 })`}>
        {children}
      </div>
    </DocsShell>
  )
}

// DocsInner: SSE-pushable content wrapper (sidebar + article + command menu).
// This is the grid container. One SSE connection per page handles both
// global UI events (command menu/theme) and page-specific events (interactive
// examples) — same pattern as board pages.
export function DocsInner({ topic, commandMenu, children }) {
  return (
    <div id="docs-page" class="docs-layout">
      <DocsSidebar currentSlug={topic?.slug} />
      <article class="docs-content" id="docs-content">
        {children}
      </article>
      {commandMenu && (
        <CommandMenu query={commandMenu.query} results={commandMenu.results || []} />
      )}
    </div>
  )
}

// DocsIndexContent: index page article content (SSE-pushable)
export function DocsIndexContent({ commandMenu }) {
  const core = DOCS_TOPICS.filter(t => t.section === 'core')
  const bonus = DOCS_TOPICS.filter(t => t.section === 'bonus')
  return (
    <DocsInner commandMenu={commandMenu}>
      <div class="docs-hero">
        <h1>How This App Works</h1>
        <p class="docs-hero-sub">An interactive guide to building a server-driven kanban board with <strong>Datastar</strong> and event sourcing.</p>
        <p class="docs-hero-note">This is a real app — the docs you're reading are served by the same server that runs the kanban board. Interactive examples are hooked up to the live event store.</p>
      </div>

      <section class="docs-section" id="big-picture">
        <h2>The Big Picture</h2>
        <p>Most web apps split work between a client-side framework and a server. This app keeps things simple: the <strong>server owns all state and all rendering</strong>. It runs Hono for routing, renders JSX into HTML, persists data to a database, and pushes UI updates over SSE. The browser tab is just a thin shell that receives HTML and morphs it into the DOM.</p>

        <p>Every user action follows the same loop:</p>

        <ol class="docs-flow-list" id="flow-steps">
          <li><strong>Client sends an action</strong> — a button click, form submit, or drag-drop fires a <code>POST</code>/<code>PUT</code>/<code>DELETE</code> to a Hono route on the server.</li>
          <li><strong>Server writes event(s)</strong> — the route handler appends one or more immutable events to the event log. Events are facts: <code>card.created</code>, <code>column.moved</code>, <code>card.labelChanged</code>.</li>
          <li><strong>Server rebuilds projection</strong> — the event is applied to an in-memory projection (the current state of boards, columns, cards). This is the "read model" in CQRS terms.</li>
          <li><strong>Bus notifies SSE streams</strong> — the route emits a topic on the in-memory event bus (<code>board:&lt;id&gt;</code>). Every open SSE connection subscribed to that topic wakes up.</li>
          <li><strong>SSE pushes a full HTML morph</strong> — each SSE handler reads the latest projection, renders the entire board as JSX, and sends it as a Datastar <code>datastar-patch-elements</code> event.</li>
          <li><strong>Datastar morphs the DOM</strong> — the client-side Datastar library receives the HTML and uses Idiomorph to efficiently diff and patch the live DOM. No virtual DOM, no hydration — just HTML in, DOM out.</li>
        </ol>

        <p>That's the whole architecture. No REST API returning JSON. No virtual DOM diffing or client-side component rendering. No <code>useState</code> or <code>createSignal</code>. The server owns the state, renders the HTML, and pushes it to every connected tab.</p>

        <h3>Why this works</h3>
        <p>This pattern — sometimes called "HTML-over-the-wire" — trades client-side complexity for server-side simplicity. The server already knows the full state, so it can render exactly the right HTML. The client doesn't need to reconcile, cache, or invalidate anything. It just displays what it receives.</p>
        <p>Datastar leverages SSE as its primary transport — anything you can do with request/response, you can do over SSE with Datastar. It uses Idiomorph to efficiently morph the DOM (preserving focus, scroll position, and CSS transitions), and provides a lightweight signal system for the small amount of client-to-server communication that forms need.</p>

        <h3>A note on this demo</h3>
        <p>In this app, the "server" happens to be a service worker running in your browser — which means you can use it offline and everything stays on your device. But the Datastar patterns are identical to what you'd use with Go, Python, Node, or any other backend. The service worker is an implementation detail; the architecture is the lesson.</p>
      </section>

      <section class="docs-section" id="further-reading">
        <h2>Further Reading</h2>
        <ul class="docs-list">
          <li><a href="https://zweiundeins.gmbh/en/methodology/spa-vs-hypermedia-real-world-performance-under-load" style="color: var(--primary-7)">SPA vs. Hypermedia: Real-World Performance Under Load</a> — zwei und eins built the same AI chat app as both an SPA (Next.js) and a Datastar hypermedia app, then benchmarked under Slow 4G + CPU throttling. The hypermedia version scored 100/100 Lighthouse performance (vs. 54), was 7.5× faster to interactive, had 0ms total blocking time, and transferred 26× less data. Their SSE compression numbers (58.5× Brotli ratio on persistent streams) validate the fat morph approach used in this app.</li>
        </ul>
      </section>

      <section class="docs-toc-section" id="topics">
        <h2>Core Concepts</h2>
        <p class="docs-toc-intro">These are the Datastar patterns that make this app tick.</p>
        <div class="docs-toc-grid">
          {core.map((t, i) => (
            <a href={`${base()}docs/${t.slug}`} class="docs-toc-card">
              <span class="docs-toc-num">{i + 1}</span>
              <h3>{t.title}</h3>
            </a>
          ))}
        </div>
      </section>

      <section class="docs-toc-section">
        <h2>Bonus</h2>
        <p class="docs-toc-intro">Implementation choices that aren't Datastar-specific — included because they're interesting or educational.</p>
        <div class="docs-toc-grid">
          {bonus.map(t => (
            <a href={`${base()}docs/${t.slug}`} class="docs-toc-card docs-toc-card--bonus">
              <h3>{t.title}</h3>
            </a>
          ))}
        </div>
      </section>
    </DocsInner>
  )
}

// DocsPager: prev/next navigation for topic pages
export function DocsPager({ topic }) {
  const idx = DOCS_TOPICS.findIndex(t => t.slug === topic.slug)
  const prev = idx > 0 ? DOCS_TOPICS[idx - 1] : null
  const next = idx < DOCS_TOPICS.length - 1 ? DOCS_TOPICS[idx + 1] : null
  return (
    <nav class="docs-pager">
      {prev ? <a href={`${base()}docs/${prev.slug}`} class="docs-pager-link docs-pager-prev"><Icon name="lucide:arrow-left" /> {prev.title}</a> : <span />}
      {next ? <a href={`${base()}docs/${next.slug}`} class="docs-pager-link docs-pager-next">{next.title} <Icon name="lucide:arrow-right" /></a> : <span />}
    </nav>
  )
}

// DocsTopicStubContent: placeholder for topics not yet written
export function DocsTopicStubContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>
      {topic.section === 'bonus' && <span class="docs-badge docs-badge--bonus">Bonus</span>}
      <div class="docs-stub">
        <p>This section is coming soon.</p>
      </div>
      <DocsPager topic={topic} />
    </DocsInner>
  )
}

// --- Topic content components ---

export function DocsEventSourcingContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>

      <section class="docs-section">
        <p>Every mutation in this app is recorded as an immutable <strong>event</strong> — a fact about something that happened. Events are never updated or deleted. The current state of the board is derived by replaying these events in order.</p>
        <p>This is <strong>event sourcing</strong>: the event log is the source of truth, and the visible UI is a projection built from it.</p>
      </section>

      <section class="docs-section">
        <h2>What an event looks like</h2>
        <p>Every event has the same shape:</p>
        <pre><code>{`{
  id:            "a1b2c3...",       // unique ID (UUID)
  type:          "card.created",    // what happened
  v:             1,                 // schema version
  data: {                           // type-specific payload
    id:          "d4e5f6...",
    columnId:    "g7h8i9...",
    title:       "Buy groceries",
    position:    "a0"
  },
  ts:            1709654321000,     // when (epoch ms)
  actorId:       "j0k1l2...",       // which device
  correlationId: "m3n4o5...",       // links related events
  causationId:   null               // what caused this event
}`}</code></pre>
        <p>The <code>type</code> says what happened. The <code>data</code> carries the minimum payload needed to apply the change. The metadata fields (<code>actorId</code>, <code>correlationId</code>, <code>causationId</code>) exist for debugging and future sync — they're not used by the projection logic.</p>
      </section>

      <section class="docs-section">
        <h2>The event types</h2>
        <p>The app uses 12 event types across three entities:</p>
        <div class="docs-event-types">
          <div class="docs-event-group">
            <h3>Board</h3>
            <ul>
              <li><code>board.created</code></li>
              <li><code>board.titleUpdated</code></li>
              <li><code>board.deleted</code></li>
            </ul>
          </div>
          <div class="docs-event-group">
            <h3>Column</h3>
            <ul>
              <li><code>column.created</code></li>
              <li><code>column.moved</code></li>
              <li><code>column.deleted</code></li>
            </ul>
          </div>
          <div class="docs-event-group">
            <h3>Card</h3>
            <ul>
              <li><code>card.created</code></li>
              <li><code>card.moved</code></li>
              <li><code>card.titleUpdated</code></li>
              <li><code>card.descriptionUpdated</code></li>
              <li><code>card.labelUpdated</code></li>
              <li><code>card.deleted</code></li>
            </ul>
          </div>
        </div>
        <p>Each type is a past-tense fact. Not "create card" (a command) but <code>card.created</code> (something that already happened). This distinction matters: commands can be rejected, but events are already true.</p>
      </section>

      <section class="docs-section">
        <h2>Commands write events</h2>
        <p>User actions hit command routes — <code>POST</code>, <code>PUT</code>, or <code>DELETE</code> endpoints on the server. Each route does three things:</p>
        <ol class="docs-flow-list">
          <li><strong>Creates event(s)</strong> — one or more events describing what happened.</li>
          <li><strong>Appends to the log</strong> — events are persisted to the event store in a single transaction.</li>
          <li><strong>Returns 204</strong> — no body. The client doesn't need a response because the SSE stream will push the updated UI.</li>
        </ol>
        <p>For example, creating a new board appends four events in one batch: one <code>board.created</code> and three <code>column.created</code> events (for the default columns). They share a <code>correlationId</code> so they can be traced as a unit.</p>
        <pre><code>{`// POST /boards — simplified
const boardEvt = createEvent('board.created', { id, title, createdAt })
const colEvents = ['To Do', 'In Progress', 'Done'].map((title, i) =>
  createEvent('column.created', { id: uuid(), title, boardId: id, position: ... },
    { correlationId: boardEvt.correlationId, causationId: boardEvt.id })
)
await appendEvents([boardEvt, ...colEvents])
return c.body(null, 204)`}</code></pre>
      </section>

      <section class="docs-section">
        <h2>CQRS: reads and writes are separate</h2>
        <p>This is the CQRS pattern — <strong>Command Query Responsibility Segregation</strong>. The write side (command routes) and the read side (SSE handlers) use different models:</p>
        <ul class="docs-list">
          <li><strong>Write side:</strong> command routes append events to the log. They don't read the projection to build a response — they just return 204.</li>
          <li><strong>Read side:</strong> SSE handlers read from the projection (the derived state) and render full HTML. They never write events.</li>
        </ul>
        <p>The projection is the "read model" — three database tables (<code>boards</code>, <code>columns</code>, <code>cards</code>) that hold the current state. When an event is appended, <code>applyEvent</code> updates these tables as a side effect of the write. The SSE handlers just read whatever's there.</p>

        <details class="docs-viz">
          <summary>View the data flow</summary>
          <div class="docs-viz-flow">
            <div class="docs-viz-node"><span class="docs-viz-node-title">Client</span><span class="docs-viz-node-desc">POST /cards</span></div>
            <span class="docs-viz-arrow">→</span>
            <div class="docs-viz-node"><span class="docs-viz-node-title">Server</span><span class="docs-viz-node-desc">write event</span></div>
            <span class="docs-viz-arrow">→</span>
            <div class="docs-viz-node"><span class="docs-viz-node-title">IDB</span><span class="docs-viz-node-desc">events + projection</span></div>
            <span class="docs-viz-arrow">→</span>
            <div class="docs-viz-node"><span class="docs-viz-node-title">SSE</span><span class="docs-viz-node-desc">push morph</span></div>
            <span class="docs-viz-arrow">→</span>
            <div class="docs-viz-node"><span class="docs-viz-node-title">Browser</span><span class="docs-viz-node-desc">update UI</span></div>
          </div>
        </details>
      </section>

      <section class="docs-section">
        <h2>Projections: deriving state from events</h2>
        <p>The <code>applyEvent</code> function is a big switch on the event type. Each case makes the smallest possible mutation to the projection:</p>
        <pre><code>{`function applyEvent(event, tx) {
  const { type, data } = upcast(event)
  switch (type) {
    case 'card.created':
      tx.objectStore('cards').put(data)
      break
    case 'card.moved':
      // read card, update columnId + position, write back
      break
    case 'board.deleted':
      // delete board, cascade-delete all columns and cards
      break
    // ... 9 more cases
  }
}`}</code></pre>
        <p>The projection can always be rebuilt from scratch by clearing the tables and replaying every event. The <code>rebuildProjection</code> function does exactly this — it's used for migrations and available as a debug tool.</p>
      </section>

      <section class="docs-section">
        <h2>Snapshots</h2>
        <p>Replaying thousands of events on every page load would be slow. After a full rebuild, the app saves a <strong>snapshot</strong> — a copy of all three projection tables plus the sequence number of the last event.</p>
        <p>On the next startup, it restores the snapshot and only replays events that arrived after it. This makes initialization fast regardless of how large the event log grows.</p>
      </section>

      <section class="docs-section">
        <h2>Upcasting: evolving the schema</h2>
        <p>Events are immutable, but schemas evolve. When the app added multi-board support, existing <code>column.created</code> events didn't have a <code>boardId</code> field. Rather than migrating old events, an <strong>upcaster</strong> transforms them on the fly:</p>
        <pre><code>{`const upcasters = {
  'column.created': {
    1: (e) => ({
      ...e,
      v: 2,
      data: { ...e.data, boardId: e.data.boardId || 'default' }
    }),
  },
}`}</code></pre>
        <p>When <code>applyEvent</code> encounters a v1 <code>column.created</code>, the upcaster promotes it to v2 by adding the missing field. The upcasted version is persisted back so it only transforms once. Upcasters chain — if v3 is defined later, a v1 event would go v1 → v2 → v3.</p>
      </section>

      <section class="docs-section">
        <h2>What you get for free</h2>
        <p>Because the event log is the source of truth, several features come almost for free:</p>
        <ul class="docs-list">
          <li><strong>Undo/redo</strong> — record inverse events, append them to undo. The projection updates, SSE pushes the result.</li>
          <li><strong>Time travel</strong> — replay events up to a specific point to see the board at any moment in history.</li>
          <li><strong>Export/import</strong> — the event log is the entire dataset. Export it as JSON, import it on another device.</li>
          <li><strong>Audit trail</strong> — every change is recorded with a timestamp, actor, and causal chain.</li>
          <li><strong>Multi-tab sync</strong> — multiple tabs share the same event log. The bus notifies all SSE streams, so every tab stays in sync.</li>
        </ul>
      </section>

      <DocsPager topic={topic} />
    </DocsInner>
  )
}

export function DocsFatMorphingContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>

      <section class="docs-section">
        <p>When the server handles a mutation, it renders the <strong>entire updated UI</strong> as HTML and <strong>pushes it to every connected client over SSE</strong>. Datastar receives the HTML and uses Idiomorph to efficiently patch the live DOM. This is called <strong>fat morphing</strong> — every push contains the full UI, not a diff.</p>
        <p>This is the core Datastar pattern: the server decides what the UI looks like, and the client just displays it.</p>
      </section>

      <section class="docs-section">
        <h2>Establishing the connection</h2>
        <p>Every page has a morph target — a container element with a <code>data-init</code> attribute that opens an SSE stream:</p>
        <pre><code>{`<main id="app"
  data-init="@get('/boards/abc123', { retry: 'always', retryMaxCount: 1000 })">
  <!-- pre-rendered content here -->
</main>`}</code></pre>
        <p>When Datastar initializes, it sees <code>@get()</code> and opens a persistent SSE connection to that URL. The <code>retry: 'always'</code> option tells Datastar to reconnect if the stream drops. The server keeps this connection open indefinitely, pushing updates whenever state changes.</p>
      </section>

      <section class="docs-section">
        <h2>What the server sends</h2>
        <p>Each SSE push is a <code>datastar-patch-elements</code> event containing a CSS selector, a mode, and a block of HTML:</p>
        <pre><code>{`event: datastar-patch-elements
data: mode outer
data: selector #board
data: useViewTransition true
data: elements <div id="board" class="board">...</div>`}</code></pre>
        <p>The <code>selector</code> identifies which DOM element to update. The <code>mode</code> controls how — <code>outer</code> replaces the element itself (including its tag), <code>inner</code> replaces only its children. The <code>elements</code> field contains the full HTML to morph in.</p>
        <p>The selector can target anything: <code>body</code> is the happy path for full-page morphs, or specific containers like <code>#app</code>, <code>#header</code>, <code>#board</code>. You can also morph individual elements like a status indicator or pager. The goal is simple and predictable fat morphs.</p>
        <p>Beyond HTML morphs, you can also <strong>morph signals</strong> for fine-grained updates — changing a single value without touching the DOM. This is useful for status icons, badges, or driving client-side heavy things like 3D scenes.</p>
        <p>This approach — sending full HTML over SSE with Brotli compression — is what makes fat morphs production-viable. A 15KB morph compresses to ~3KB, making it competitive with delta/diff approaches. A <a href="https://zweiundeins.gmbh/en/methodology/spa-vs-hypermedia-real-world-performance-under-load" style="color: var(--primary-7)">2026 benchmark</a> showed Brotli achieving 58.5× compression on a persistent SSE stream over a 10-turn conversation — the repetitive structure of HTML morphs is ideal for streaming compression. See <a href={base() + 'docs/bonus/brotli'}>Brotli Compression</a> for details.</p>
        <p>On the server, a helper function handles the formatting:</p>
        <pre><code>{`function dsePatch(selector, jsx, mode = 'outer', opts) {
  return {
    event: 'datastar-patch-elements',
    data: \`mode \${mode}\\nselector \${selector}\\nelements \${jsx.toString()}\`
  }
}

// Usage in an SSE handler:
await stream.writeSSE(dsePatch('#board', <Board ... />, 'outer'))`}</code></pre>
      </section>

      <section class="docs-section">
        <h2>Fat morphs: re-render everything</h2>
        <p>Every SSE push sends the <strong>complete UI for the morph target</strong> — the entire board with all its columns and cards, not just the piece that changed. This sounds wasteful, but it's the key simplification:</p>
        <ul class="docs-list">
          <li><strong>No partial updates</strong> — the server doesn't need to track what changed or compute diffs. It just reads the current state and renders.</li>
          <li><strong>No client-side state sync</strong> — the client doesn't maintain a model of the data. Every push is the full truth.</li>
          <li><strong>Correctness by default</strong> — any state the server knows about is reflected in the push. Nothing can drift out of sync.</li>
        </ul>
        <p>This works because Idiomorph is fast. Morphing a full board (~100 DOM nodes) against a nearly-identical new version takes under 1ms. The network cost is also minimal — a full board is 5-15KB of HTML, sent over an already-open connection with no HTTP overhead.</p>
      </section>

      <section class="docs-section">
        <h2>Idiomorph: smart DOM patching</h2>
        <p>Datastar uses <a href="https://github.com/bigskysoftware/idiomorph" style="color: var(--primary-7)">Idiomorph</a> to morph the DOM. Unlike innerHTML replacement, Idiomorph diffs the old and new HTML trees and makes the minimum DOM mutations needed. This preserves:</p>
        <ul class="docs-list">
          <li><strong>Focus</strong> — if an input is focused, it stays focused after the morph.</li>
          <li><strong>Scroll position</strong> — scrollable containers keep their position.</li>
          <li><strong>CSS transitions</strong> — elements that moved get animated via view transitions.</li>
          <li><strong>Form state</strong> — unsaved input values survive the morph.</li>
        </ul>
        <p>Idiomorph matches elements by <code>id</code> first, then by tag and position. This is why <strong>stable <code>id</code> attributes matter</strong>: without them, Idiomorph uses heuristic matching that can fail when siblings are added or removed.</p>
        <pre><code>{`// Every card gets a stable id for Idiomorph matching
<div id={\`card-\${card.id}\`} class="card" data-card-id={card.id}>
  ...
</div>`}</code></pre>
      </section>

      <section class="docs-section">
        <h2>Initial load vs. SSE pushes</h2>
        <p>Every route serves two purposes: the initial HTML page load and the SSE stream. The server distinguishes them with a header:</p>
        <pre><code>{`app.get('/boards/:boardId', async (c) => {
  // Datastar @get() sets this header on SSE requests
  if (c.req.header('Datastar-Request') === 'true') {
    return streamSSE(c, async (stream) => {
      // Push initial state, then listen for changes
      await push('#app', 'inner')
      bus.addEventListener('board:\${boardId}:changed', handler)
      while (!stream.closed) { await stream.sleep(30000) }
    })
  }
  // Normal browser navigation — return full HTML document
  return c.html('<!DOCTYPE html>' + (<Shell><Board ... /></Shell>).toString())
})`}</code></pre>
        <p>On initial load, the browser gets a complete HTML document with pre-rendered content. Datastar then opens the SSE connection, and the first SSE push morphs <code>#app inner</code> with fresh content. Subsequent pushes target the inner component (<code>#board outer</code>) as state changes.</p>
      </section>

      <section class="docs-section">
        <h2>Alternative: app shell + lazy UI</h2>
        <p>This app pre-renders full HTML on every request. But there's another pattern that's common with Datastar:</p>
        <ul class="docs-list">
          <li><strong>Initial load</strong> returns a lightweight app shell — just the layout, nav, and empty states.</li>
          <li><strong>First SSE push</strong> brings in the actual UI — the board, cards, data.</li>
        </ul>
        <p>This works well when the initial render is expensive or when you want faster time-to-first-byte. The app shell is cached (HTTP or Service Worker), and the dynamic content loads over SSE. The tradeoff is a brief "loading" state before the SSE connects and pushes the first morph.</p>
        <p>Both patterns work. Pre-render everything (like this app) gives you instant visual completeness. App shell + SSE gives you faster initial response and cleaner separation between shell and content.</p>
      </section>

      <section class="docs-section">
        <h2>The push trigger: event bus</h2>
        <p>After a command route appends events and updates the projection, it needs to notify all open SSE streams. This happens through a plain <code>EventTarget</code> used as an in-memory bus:</p>
        <pre><code>{`// After events are committed to the database:
bus.dispatchEvent(new CustomEvent('board:\${boardId}:changed'))

// In the SSE handler, this listener fires:
bus.addEventListener('board:\${boardId}:changed', async () => {
  const data = await getBoard(boardId)       // read fresh state
  await stream.writeSSE(dsePatch('#board',   // render + push
    <Board board={data.board} columns={data.columns} cards={data.cards} />,
    'outer', { useViewTransition: true }
  ))
})`}</code></pre>
        <p>The bus is scoped by topic — <code>board:&lt;id&gt;:changed</code> for data mutations on a specific board, <code>boards:changed</code> for the board list, <code>global:ui</code> for app-wide UI state like the command menu.</p>
      </section>

      <section class="docs-section">
        <h2>Multi-tab sync</h2>
        <p>Each browser tab opens its own SSE connection. All connections share the same server-side bus. When a mutation fires a bus event, <strong>every</strong> SSE stream subscribed to that topic independently reads the latest state, renders HTML, and pushes its own morph. Two tabs viewing the same board both get updated simultaneously.</p>
        <p>Tab counting uses the Service Worker's <code>Clients API</code> — <code>self.clients.matchAll()</code> returns all open windows. This is more reliable than tracking SSE connections, which can briefly fluctuate during Datastar's reconnect cycle.</p>
      </section>

      <section class="docs-section">
        <h2>View transitions</h2>
        <p>When the server includes <code>useViewTransition true</code> in the SSE event, Datastar wraps the morph in <code>document.startViewTransition()</code>. Combined with CSS <code>view-transition-name</code> on elements, this animates layout changes — columns sliding into new positions, cards fading in or out.</p>
        <p>View transitions are enabled for data mutations (adding, moving, deleting) but not for UI-only changes (opening a menu, toggling selection mode). This keeps the UI responsive without animating every state change.</p>
      </section>

      <DocsPager topic={topic} />
    </DocsInner>
  )
}

export function DocsSignalsContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>

      <section class="docs-section">
        <p>Most web frameworks put UI state on the client. An "edit mode" flag lives in <code>useState</code>, a selection set lives in a Zustand store, a modal's open/closed state is a reactive signal. The server returns data; the client decides how to display it.</p>
        <p>This app flips that. <strong>The server tracks all UI state</strong> — which card is being edited, which action sheet is open, which cards are selected — and pushes fully-rendered HTML with the right UI baked in. The client has almost no state of its own.</p>
      </section>

      <section class="docs-section">
        <h2>Server-owned UI state</h2>
        <p>Every board has an in-memory state object on the server that tracks ephemeral UI mode:</p>
        <pre><code>{`const boardUIState = new Map()  // Map<boardId, UIState>

function getUIState(boardId) {
  if (!boardUIState.has(boardId)) {
    boardUIState.set(boardId, {
      activeCardSheet: null,      // which card's action sheet is open
      activeColSheet: null,       // which column's action sheet is open
      selectionMode: false,       // multi-select active?
      selectedCards: new Set(),   // which cards are selected
      editingCard: null,          // which card has inline edit form
      editingBoardTitle: false,   // is the board title being renamed?
      showHelp: false,            // keyboard shortcut overlay visible?
      highlightCard: null,        // card to scroll-into-view + pulse
    })
  }
  return boardUIState.get(boardId)
}`}</code></pre>
        <p>This state is never persisted — it lives only in memory and resets when the server restarts. It's purely about <em>what the UI looks like right now</em>, not about data. Two separate bus topics reflect this split:</p>
        <ul class="docs-list">
          <li><code>board:&lt;id&gt;:changed</code> — data was mutated (events written to the database). Pushes morph <strong>with</strong> view transitions.</li>
          <li><code>board:&lt;id&gt;:ui</code> — only UI state changed (nothing persisted). Pushes morph <strong>without</strong> view transitions.</li>
        </ul>
        <p>Both fire the same full morph push. The rendering code doesn't distinguish between them — it reads the current projection <em>plus</em> the current UI state and renders the whole board.</p>
      </section>

      <section class="docs-section">
        <h2>Worked example: editing a card</h2>
        <p>Here's what happens when a user clicks the edit pencil on a card — no client-side state involved:</p>
        <ol class="docs-flow-list">
          <li><strong>Client sends intent</strong> — the edit button fires <code>@post('/cards/&lt;id&gt;/edit')</code>. No payload, no signal. Just "I want to edit this card."</li>
          <li><strong>Server updates UI state</strong> — the route handler toggles <code>editingCard</code> in the board's UI state and fires <code>emitUI(boardId)</code>:
            <pre><code>{`app.post('/cards/:cardId/edit', async (c) => {
  const ui = getUIState(boardId)
  ui.editingCard = ui.editingCard === cardId ? null : cardId
  ui.activeCardSheet = null     // close any open action sheet
  emitUI(boardId)               // notify SSE streams
  return c.body(null, 204)      // no response body needed
})`}</code></pre>
          </li>
          <li><strong>SSE push fires</strong> — the stream handler reads fresh state from IndexedDB and the current <code>uiState</code>, then renders the full board.</li>
          <li><strong>Component checks UI state</strong> — the Card component reads <code>uiState.editingCard</code> to decide what to render:
            <pre><code>{`function Card({ card, uiState, ... }) {
  const isEditing = uiState?.editingCard === card.id

  return (
    <div id={\`card-\${card.id}\`} class="card">
      {isEditing ? (
        <form data-on:submit__prevent={\`@put('/cards/\${card.id}', {contentType: 'form'})\`}>
          <input name="title" value={card.title} />
          <textarea name="description">{card.description}</textarea>
          <button type="submit">Save</button>
          <button type="button" data-on:click={\`@post('/cards/\${card.id}/edit-cancel')\`}>Cancel</button>
        </form>
      ) : (
        <span class="card-title">{card.title}</span>
      )}
    </div>
  )
}`}</code></pre>
          </li>
          <li><strong>Datastar morphs the DOM</strong> — Idiomorph patches the card element, replacing the title span with the edit form. Focus moves to the input.</li>
        </ol>
        <p>The edit form <em>appears</em> because the server rendered it into the morph, not because the client toggled a flag. When the user saves or cancels, another POST clears <code>editingCard</code>, and the next morph removes the form.</p>
      </section>

      <section class="docs-section">
        <h2>Where signals are actually used</h2>
        <p>Datastar's signal system is powerful, but this app uses it sparingly. In the entire codebase there are exactly <strong>two</strong> <code>data-signals</code> declarations:</p>
        <ol class="docs-flow-list">
          <li><strong>Command menu navigation</strong> — tracks the highlighted result index for arrow-key navigation:
            <pre><code>{`<div data-signals="{cmdIdx: 0, cmdCount: \${results.length}}">
  <!-- Arrow up/down adjust $cmdIdx -->
  <!-- Enter activates the item at $cmdIdx -->
</div>`}</code></pre>
          </li>
          <li><strong>Selection bar dropdown</strong> — a boolean to show/hide the column picker when batch-moving cards:
            <pre><code>{`<div data-signals="{showColumnPicker: false}">
  <button data-on:click="$showColumnPicker = !$showColumnPicker">Move to...</button>
  <div data-show="$showColumnPicker">
    <!-- column list -->
  </div>
</div>`}</code></pre>
          </li>
        </ol>
        <p>Both are trivial UI toggles — an index counter and a boolean. Every meaningful UI state change (editing, selecting, opening sheets, time-traveling) goes through the server.</p>
      </section>

      <section class="docs-section">
        <h2>Forms: sending data to the server</h2>
        <p>When the client needs to send structured data to the server — a card title, a description, a search query — Datastar binds inputs to signals and submits them as JSON:</p>
        <pre><code>{`<!-- Bind inputs to signals -->
<input data-bind="title" placeholder="Title" />
<textarea data-bind="description" placeholder="Description" />

<!-- On submit, all signals are sent as JSON -->
<form data-on:submit__prevent="@post('/cards', {contentType: 'json'})">
  <button type="submit">Create</button>
</form>`}</code></pre>
        <p>Instead of parsing <code>FormData</code> on the server, you receive structured JSON directly: <code>{`{ title: "...", description: "..." }`}</code>. This makes nested data, arrays, and complex shapes easier to work with than flat form fields.</p>
        <p>There are only <strong>seven</strong> form submissions in the entire app: create card, edit card (inline), edit card (detail page), create column, create board, rename board, and command menu search.</p>
      </section>

      <section class="docs-section">
        <h2>If you really love HTML forms</h2>
        <p>Alternatively, you can use standard HTML forms with <code>{`{contentType: 'form'}`}</code>:</p>
        <pre><code>{`<!-- Standard HTML form -->
<form data-on:submit__prevent__viewtransition=
  {\`@post('/columns/\${col.id}/cards', {contentType: 'form'}); evt.target.reset()\`}>
  <input name="title" placeholder="Add a card" />
</form>`}</code></pre>
        <p>This sends a URL-encoded form body — <code>title=My+Card</code> — which the server parses with <code>c.req.parseBody()</code>. Works fine for simple flat data, but gets awkward with nested structures.</p>
      </section>

      <section class="docs-section">
        <h2>Selection mode: a server-side set</h2>
        <p>Multi-card selection is the most complex UI state in the app, and it's entirely server-owned. The selection set (<code>selectedCards</code>) is a <code>Set</code> in <code>boardUIState</code>, not a client-side signal:</p>
        <pre><code>{`// Enter selection mode
app.post('/boards/:boardId/select-mode', async (c) => {
  const ui = getUIState(boardId)
  ui.selectionMode = true
  ui.selectedCards.clear()
  emitUI(boardId)
  return c.body(null, 204)
})

// Toggle a card's selection
app.post('/cards/:cardId/toggle-select', async (c) => {
  const ui = getUIState(boardId)
  if (ui.selectedCards.has(cardId)) {
    ui.selectedCards.delete(cardId)
  } else {
    ui.selectedCards.add(cardId)
  }
  emitUI(boardId)
  return c.body(null, 204)
})`}</code></pre>
        <p>Each toggle sends a POST, the server updates the set, and a morph pushes the full board with checkboxes and selection highlights baked in. The client never knows which cards are selected — it just renders what the server sends.</p>
      </section>

      <section class="docs-section">
        <h2>Action sheets: touch interaction, server state</h2>
        <p>On touch devices, tapping a card opens an action sheet with move, label, edit, and delete options. The client side dispatches a custom event, which triggers a fetch:</p>
        <pre><code>{`// In the page's inline script:
document.getElementById('app').addEventListener('kanban-card-tap', (e) => {
  fetch('/cards/' + e.detail.cardId + '/sheet', { method: 'POST' })
})

// On the server:
app.post('/cards/:cardId/sheet', async (c) => {
  const ui = getUIState(boardId)
  ui.activeCardSheet = ui.activeCardSheet === cardId ? null : cardId
  emitUI(boardId)
  return c.body(null, 204)
})`}</code></pre>
        <p>The action sheet component is rendered by the server only when <code>activeCardSheet</code> matches a card ID. Every button in the sheet — move to column, change label, edit, delete — is another <code>@post()</code> or <code>@delete()</code> to a server route. The sheet dismisses because the server sets <code>activeCardSheet = null</code> and pushes a morph without it.</p>
      </section>

      <section class="docs-section">
        <h2>Why this works</h2>
        <p>The "fewer signals is better" principle sounds limiting, but it eliminates entire categories of bugs:</p>
        <ul class="docs-list">
          <li><strong>No stale UI</strong> — there's no client state that can drift from the server. Every morph is ground truth.</li>
          <li><strong>No state synchronization</strong> — two tabs don't need to coordinate. Each gets independent morphs from the same server state.</li>
          <li><strong>No hydration mismatch</strong> — there's nothing to hydrate. The server renders, the client displays.</li>
          <li><strong>Simpler debugging</strong> — the UI is a pure function of server state. To reproduce a bug, check the server's state object — the UI follows deterministically.</li>
        </ul>
        <p>The tradeoff is latency: every UI state change requires a round-trip. With a fast backend, this is usually imperceptible. For slower connections, you can mask latency with CSS transitions and view transitions — the morph arrives before the eye notices the delay. Datastar also provides <code>data-indicator</code> for showing activity feedback while waiting for the server.</p>
      </section>

      <section class="docs-section">
        <h2>The pattern, summarized</h2>
        <table class="docs-table">
          <thead>
            <tr><th>Mechanism</th><th>Count</th><th>Purpose</th></tr>
          </thead>
          <tbody>
            <tr><td><code>data-signals</code></td><td>2</td><td>Arrow-key index, dropdown toggle</td></tr>
            <tr><td><code>@post</code> / <code>@delete</code> (no body)</td><td>~35</td><td>UI state changes: edit, select, sheets, help</td></tr>
            <tr><td>Form submissions</td><td>7</td><td>Card/column/board creation, editing, search</td></tr>
            <tr><td><code>boardUIState</code> keys</td><td>10+</td><td>All ephemeral UI mode state</td></tr>
          </tbody>
        </table>
        <p>Signals exist for the rare cases where client-only behavior makes sense (keyboard navigation, dropdown toggles). Everything else is a POST to the server. The server decides what the UI looks like and pushes it.</p>
      </section>

      <DocsPager topic={topic} />
    </DocsInner>
  )
}

export function DocsHypermediaContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>

      <section class="docs-section">
        <p>The web was built on hypermedia. That's the "H" in HTML — <strong>HyperText</strong> Markup Language. Links connect pages, forms submit data, and the server drives the flow by sending the client what to do next. This was the original pattern before we "discovered" SPAs.</p>
        <p>Datastar brings hypermedia back. Not as a throwback, but as a genuinely simpler way to build interactive apps.</p>
      </section>

      <section class="docs-section">
        <h2>What is hypermedia?</h2>
        <p>Hypermedia means the response includes everything the client needs to continue:</p>
        <ul class="docs-list">
          <li><strong>Links</strong> — <code>&lt;a href="..."&gt;</code> tells the client where to go next.</li>
          <li><strong>Forms</strong> — <code>&lt;form action="..."&gt;</code> tells the client where to send data.</li>
          <li><strong>Actions</strong> — buttons and inputs describe what the user can do.</li>
        </ul>
        <p>The client doesn't need to know ahead of time what operations are available. The server tells it — in every response.</p>
        <p>You can do hypermedia with JSON too — the key is including <em>what the client can do</em> in the response. But typical REST APIs with JSON don't do this; they return data and assume the client already knows the available operations.</p>
      </section>

      <section class="docs-section">
        <h2>The "follow your nose" principle</h2>
        <p>With a JSON API, the client needs out-of-band knowledge:</p>
        <pre><code>{`// Client must know:
// - the endpoint URL (/api/boards)
// - the HTTP method (GET)
// - the response shape
fetch('/api/boards')  // what if this changes?
  .then(r => r.json())
  .then(boards => ...)`}</code></pre>
        <p>With hypermedia, the server tells the client what to do:</p>
        <pre><code>{`// Server sends:
// <a href="/boards/new">Create Board</a>
// <a href="/boards/123">View Board</a>
// The client just follows links. No URL knowledge needed.`}</code></pre>
        <p>This is called "driving the application state through hypermedia" (HATEOAS). The server is the pilot; the client is the display.</p>
      </section>

      <section class="docs-section">
        <h2>How Datastar embraces hypermedia</h2>
        <p>Every HTML response from the server includes all available actions:</p>
        <pre><code>{`// Form — where to send data
<form action="/boards" method="POST">
  <input name="title" placeholder="Board title">
  <button type="submit">Create</button>
</form>

// Button — what action to trigger
<button data-on:click="@post('/boards/123/select-mode')">
  Select cards
</button>

// Link — where to go next
<a href="/boards/123">Open board</a>`}</code></pre>
        <p>The client never needs to construct URLs or know which API endpoints exist. The server says "here's what you can do," and Datastar wires it up.</p>
      </section>

      <section class="docs-section">
        <h2>Contrast: JSON API vs Hypermedia</h2>
        <table class="docs-table">
          <thead>
            <tr><th>JSON API</th><th>Hypermedia (Datastar)</th></tr>
          </thead>
          <tbody>
            <tr><td>Client knows all endpoints upfront</td><td>Server tells client what actions exist</td></tr>
            <tr><td>Client decides what to render</td><td>Server decides what the UI looks like</td></tr>
            <tr><td>Client maintains state</td><td>Server owns state, pushes UI</td></tr>
            <tr><td>Change URL scheme = break clients</td><td>Change is transparent to clients</td></tr>
            <tr><td>Need documentation</td><td>Self-documenting (it's just HTML)</td></tr>
          </tbody>
        </table>
      </section>

      <section class="docs-section">
        <h2>Why it fell out of favor</h2>
        <p>Hypermedia was the original web pattern, but it "fell out of favor" for a few reasons:</p>
        <ul class="docs-list">
          <li><strong>Page reloads felt slow</strong> — full HTML round-trip on every click.</li>
          <li><strong>No real-time</strong> — no way to push updates to the client.</li>
          <li><strong>Static feeling</strong> — pages felt like documents, not apps.</li>
        </ul>
        <p>Datastar fixes all three: SSE pushes updates without reloads, morphing feels instant, and the UI is fully interactive — all while keeping hypermedia's simplicity.</p>
      </section>

      <section class="docs-section">
        <h2>The self-documenting nature</h2>
        <p>One underappreciated benefit: hypermedia apps are self-documenting. View Source on any page shows every available action. There's no API docs to keep in sync, no GraphQL schema to generate, no SDK to update.</p>
        <p>If the server adds a new button, it's immediately available — no client code changes needed. The server said "here's a new action," the client received it, Datastar wired it up.</p>
      </section>

      <section class="docs-section">
        <h2>The pattern in this app</h2>
        <p>Every button, form, and link in this app is hypermedia-driven:</p>
        <ul class="docs-list">
          <li>Creating a board: <code>&lt;form action="/boards" method="POST"&gt;</code></li>
          <li>Opening a board: <code>&lt;a href="/boards/123"&gt;</code></li>
          <li>Editing a card: <code>data-on:click="@post('/cards/123/edit')"</code></li>
          <li>Deleting a column: <code>data-on:click="@delete('/columns/456')"</code></li>
        </ul>
        <p>The client code (<code>eg-kanban.js</code>) handles only drag-and-drop and touch interactions. Every meaningful action goes through the server, and the server tells the client what to display.</p>
      </section>

      <DocsPager topic={topic} />
    </DocsInner>
  )
}

export function DocsMpaContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>

      <section class="docs-section">
        <p>Single-page apps brought client-side routing: the URL changes without a page reload, JavaScript swaps the content, and navigation feels instant. But it came with a cost — complex routing code, hydration mismatches, and a second-class citizen on the web platform.</p>
        <p>This app takes a different approach: <strong>standard HTML navigation with View Transitions</strong>. No client-side router. Just <code>&lt;a&gt;</code> tags and the browser's native navigation, enhanced with smooth animations.</p>
      </section>

      <section class="docs-section">
        <h2>No client-side routing</h2>
        <p>Every link is a plain <code>&lt;a href="..."&gt;</code>:</p>
        <pre><code>{`// Plain anchor tag — no router needed
<a href={base()}>Home</a>
<a href={\`\${base()}boards/\${board.id}\`}>{board.title}</a>
<a href={base() + 'docs/core/event-sourcing'}>Docs</a>`}</code></pre>
        <p>Clicking a link triggers a normal browser navigation. The server returns a new HTML document. View Transitions smooth the transition between pages.</p>
        <p>This means:</p>
        <ul class="docs-list">
          <li><strong>No router code</strong> — no <code>react-router</code>, <code>wouter</code>, or custom routing logic.</li>
          <li><strong>URL works correctly</strong> — browser back/forward, deep links, sharing all work natively.</li>
          <li><strong>Progressive enhancement</strong> — works without JavaScript (mostly).</li>
        </ul>
      </section>

      <section class="docs-section">
        <h2>View Transitions API</h2>
        <p>When you navigate between pages, the browser normally does a hard cut — old page gone, new page appears. View Transitions let you animate that change:</p>
        <pre><code>{`// CSS: name elements for transition
.card { view-transition-name: card-123; }
.board-title { view-transition-name: board-title; }

// On navigation, browser captures old state,
// renders new state, and animates between them
// No JavaScript needed beyond the CSS`}</code></pre>
        <p>The key is <code>view-transition-name</code> — give elements the same name across pages, and the browser morphs them. In this app, board cards animate into the board view, columns slide into place.</p>
      </section>

      <section class="docs-section">
        <h2>Speculation Rules: prefetching</h2>
        <p>The downside of MPA is latency — every click is a full page round-trip. Speculation Rules fix this by prefetching pages before you click:</p>
        <pre><code>{`<script type="speculationrules">{JSON.stringify({
  prefetch: [{
    source: 'document',
    where: { href_matches: '/boards/*' },
    eagerness: 'moderate',
  }]
})}</script>`}</code></pre>
        <p>When the browser sees a link to a board page, it prefetches the HTML in the background. When you click, the page loads instantly from cache.</p>
        <p>This app enables speculation rules on non-board pages (the board list, docs). Board pages are excluded because they're heavier and the SSE connection already keeps them fresh.</p>
        <p>Note: Speculation Rules are supported in Chromium browsers. Safari and Firefox fall back to normal navigation — the app still works, just without instant prefetch.</p>
      </section>

      <section class="docs-section">
        <h2>Contrast with SPA client-side routing</h2>
        <table class="docs-table">
          <thead>
            <tr><th>SPA Routing</th><th>MPA + View Transitions</th></tr>
          </thead>
          <tbody>
            <tr><td>URL routing in JavaScript</td><td>Native browser navigation</td></tr>
            <tr><td>Hydration required</td><td>No hydration</td></tr>
            <tr><td>Back/forward needs handling</td><td>Works automatically</td></tr>
            <tr><td>Deep links require server config</td><td>Deep links just work</td></tr>
            <tr><td>Bundle includes router</td><td>No router in bundle</td></tr>
          </tbody>
        </table>
      </section>

      <DocsPager topic={topic} />
    </DocsInner>
  )
}

export function DocsIndexedDbContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>

      <section class="docs-section">
        <p>This app uses raw IndexedDB with thin helpers — no ORM, no abstraction layer, no migration framework. It's intentionally minimal to show the pattern clearly. This bonus section explains why and how.</p>
      </section>

      <section class="docs-section">
        <h2>The stores</h2>
        <p>There are only <strong>five</strong> object stores:</p>
        <ul class="docs-list">
          <li><code>events</code> — the immutable event log (source of truth)</li>
          <li><code>boards</code> — board projections</li>
          <li><code>columns</code> — column projections</li>
          <li><code>cards</code> — card projections</li>
          <li><code>meta</code> — snapshots and metadata</li>
        </ul>
        <p>Each projection store has indexes for common queries: <code>cards.byColumn</code>, <code>columns.byBoard</code>, <code>events.byId</code>.</p>
      </section>

      <section class="docs-section">
        <h2>Why raw IndexedDB?</h2>
        <ul class="docs-list">
          <li><strong>No extra dependencies</strong> — just <code>idb</code> for promise-based wrappers around the callback API.</li>
          <li><strong>Structured cloning</strong> — JavaScript objects serialize automatically. No <code>JSON.stringify</code> needed.</li>
          <li><strong>Transactions</strong> — atomicity comes free. Read-modify-write in a transaction; it all succeeds or fails together.</li>
          <li><strong>No migrations needed</strong> — events are the schema. If you can append events, the format doesn't matter.</li>
        </ul>
      </section>

      <section class="docs-section">
        <h2>Contrast with heavier options</h2>
        <table class="docs-table">
          <thead>
            <tr><th>Option</th><th>Tradeoff</th></tr>
          </thead>
          <tbody>
            <tr><td>Dexie.js</td><td>Nice API, but adds bundle size and another abstraction</td></tr>
            <tr><td>PGlite (SQLite in WASM)</td><td>Powerful queries, but heavy (~3MB) and overengineered for this</td></tr>
            <tr><td>OPFS</td><td>File-based, not ideal for structured data</td></tr>
            <tr><td>Raw IndexedDB + idb</td><td>~3KB, direct access, no abstraction leak</td></tr>
          </tbody>
        </table>
      </section>

      <section class="docs-section">
        <h2>Reading and writing</h2>
        <p>Writing appends an event and updates projections in a single transaction:</p>
        <pre><code>{`const tx = db.transaction(['events', 'boards', 'columns', 'cards'], 'readwrite')
await tx.objectStore('events').add(event)
await tx.objectStore('boards').put(projection)
await tx.done`}</code></pre>
        <p>Reading is straightforward:</p>
        <pre><code>{`const db = await dbPromise
const cards = await db.getAllFromIndex('cards', 'byColumn', columnId)`}</code></pre>
      </section>

      <section class="docs-section">
        <h2>Snapshots for fast startup</h2>
        <p>On service worker startup, replaying thousands of events is slow. This app periodically saves a snapshot to <code>meta</code> — a serialized projection. On load, it reads the snapshot and replays only events after the snapshot sequence.</p>
        <p>This keeps startup fast even with thousands of events.</p>
      </section>

      <DocsPager topic={topic} />
    </DocsInner>
  )
}

export function DocsFractionalIndexingContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>

      <section class="docs-section">
        <p>Not Datastar-specific — this is a general technique for ordered lists. When you drag a card to a new position, you need to store its order somehow. The naive approach uses integers: position 0, 1, 2, 3... But every insert or move requires renumbering everything after it.</p>
        <p>Fractional indexing solves this: positions are strings that sort alphabetically but leave room between neighbors. You can insert between any two items without renumbering.</p>
      </section>

      <section class="docs-section">
        <h2>How it works</h2>
        <p>Each position is a string key. The keys sort in lexicographic order (like alphabetical, but for strings):</p>
        <pre><code>{`// Initial cards at positions:
card1: "a"
card2: "b"
card3: "c"

// Insert between card1 and card2:
generateKeyBetween("a", "b")  // → "aV"

// Insert at the start:
generateKeyBetween(null, "a")  // → "]"

// Insert at the end:
generateKeyBetween("c", null)  // → "c0"`}</code></pre>
        <p>The library generates keys that always fit between any two existing keys. You never need to update other items.</p>
      </section>

      <section class="docs-section">
        <h2>The siblings array</h2>
        <p>When moving an item, you pass the <em>sorted siblings</em> (excluding the item being moved) and the drop index:</p>
        <pre><code>{`function positionForIndex(dropIndex, sortedSiblings) {
  const before = dropIndex > 0 ? sortedSiblings[dropIndex - 1].position : null
  const after = dropIndex < sortedSiblings.length ? sortedSiblings[dropIndex].position : null
  return generateKeyBetween(before, after)
}`}</code></pre>
        <p>The siblings array excludes the moved item because you're computing where it <em>goes</em>, not where it <em>was</em>.</p>
      </section>

      <section class="docs-section">
        <h2>Why not integers?</h2>
        <p>With integers, moving item at position 2 to position 0 means:</p>
        <pre><code>{`// Old: [0, 1, 2, 3]
// Move item 2 to position 0:
// Need to renumber: [0, 2, 3, 4] or [0, 1, 2, 3] → [0, -1, 1, 2] → ...`}</code></pre>
        <p>With fractional indexing:</p>
        <pre><code>{`// Old: ["a", "b", "c", "d"]
// Move item "c" to position 0:
// generateKeyBetween(null, "a") → "]"
// No other items changed.`}</code></pre>
      </section>

      <section class="docs-section">
        <h2>In this app</h2>
        <p>Cards and columns both use fractional indexing for position. When you drag a card, <code>eg-kanban.js</code> calculates the visual drop index and sends it to the server. The server converts it to a fractional key:</p>
        <pre><code>{`// Server receives dropIndex=2, siblings=[{position:"a"},{position:"b"},{position:"c"}]
// Computes: generateKeyBetween("b", "c") → "bV"`}</code></pre>
        <p>The event stores <code>position: "bV"</code>. Future inserts between any two items work without touching other positions.</p>
      </section>

      <DocsPager topic={topic} />
    </DocsInner>
  )
}

export function DocsLocalFirstContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>

      <section class="docs-section">
        <p><strong>Datastar is not built for local-first.</strong> This demo pushes it into territory it wasn't designed for. Local-first in the browser is still experimental. This bonus section is honest about the tradeoffs.</p>
      </section>

      <section class="docs-section">
        <h2>What "local-first" means here</h2>
        <ul class="docs-list">
          <li><strong>Data lives on-device</strong> — IndexedDB stores everything. No server, no API calls.</li>
          <li><strong>Works offline</strong> — the service worker serves the app, IndexedDB holds the data.</li>
          <li><strong>No costs</strong> — no hosting, no auth, no API keys.</li>
        </ul>
      </section>

      <section class="docs-section">
        <h2>Tradeoffs</h2>
        <ul class="docs-list">
          <li><strong>No cross-device sync</strong> — data lives in one browser. (WebRTC could fix this — future work.)</li>
          <li><strong>SW lifecycle</strong> — browser kills idle service workers after ~30s. In-memory state resets.</li>
          <li><strong>Storage eviction</strong> — browsers can evict IndexedDB under storage pressure.</li>
          <li><strong>No real backend</strong> — can't share boards with others without exporting/importing.</li>
        </ul>
      </section>

      <section class="docs-section">
        <h2>Event log is sync-ready</h2>
        <p>The event log is the key to future sync capability. If you add a transport layer (WebRTC or HTTP), the events are already structured for sharing:</p>
        <ul class="docs-list">
          <li>Immutable events — can be replayed in order</li>
          <li>Includes causation IDs — know what caused what</li>
          <li>Projections rebuild from events — no data loss</li>
        </ul>
        <p>The architecture is sync-ready; the transport layer is the missing piece.</p>
      </section>

      <section class="docs-section">
        <h2>Is this a good pattern?</h2>
        <p>Honestly? Not really. Datastar works best with a real backend. Running a SW as a server is a fun experiment but has fundamental limitations:</p>
        <ul class="docs-list">
          <li>No WebSockets in service workers — SSE only</li>
          <li>No background sync when SW is killed</li>
          <li>Limited storage APIs compared to a real database</li>
        </ul>
        <p>This demo exists to show Datastar patterns, not to recommend local-first as a production architecture.</p>
      </section>

      <section class="docs-section">
        <h2>The conventional wisdom</h2>
        <p>A <a href="https://zweiundeins.gmbh/en/methodology/spa-vs-hypermedia-real-world-performance-under-load" style="color: var(--primary-7)">2026 SPA-vs-Hypermedia benchmark by zwei und eins</a> lists "offline-first is a hard requirement" as a reason to choose an SPA architecture. That's the standard advice — and it's mostly right. SPAs can use standard tools like service worker caches, IndexedDB, and background sync APIs to work offline.</p>
        <p>This project is an experiment in the opposite direction: a <strong>hypermedia app that works offline</strong> by moving the server itself into the browser. It works, but with real limitations (see above). The interesting question isn't whether this is production-ready (it isn't), but whether the <em>architecture</em> — event sourcing, SSE morphing, server-owned state — could support offline with a proper sync layer added later.</p>
      </section>

      <DocsPager topic={topic} />
    </DocsInner>
  )
}

export function DocsBrotliContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>

      <section class="docs-section">
        <p>Long-lived SSE connections pushing frequent HTML morphs can benefit from compression. This bonus section covers the tradeoffs.</p>
      </section>

      <section class="docs-section">
        <h2>The optimization</h2>
        <p>A full board morph is 5-15KB of HTML. Over a long-lived SSE connection with frequent updates, that adds up. Brotli compression can shrink this by 70-80%.</p>
        <p>The server checks <code>Accept-Encoding: br</code> and streams compressed data:</p>
        <pre><code>{`// Server side:
if (request.headers.get('Accept-Encoding')?.includes('br')) {
  stream = compress(stream)  // brotli streaming compressor
  response.headers.set('Content-Encoding', 'br')
}`}</code></pre>
      </section>

      <section class="docs-section">
        <h2>Service worker limitation</h2>
        <p>You can't easily do this in a service worker. The browser's <code>Compression Streams API</code> supports gzip and deflate natively, but <strong>not brotli</strong>. You could use gzip as a fallback — it still saves 50-70% — but it's not as efficient as brotli.</p>
        <p>With a real backend (Node, Go, Python), brotli is a simple addition and a significant optimization for high-frequency morphs.</p>
      </section>

      <section class="docs-section">
        <h2>Real-world numbers</h2>
        <p>A <a href="https://zweiundeins.gmbh/en/methodology/spa-vs-hypermedia-real-world-performance-under-load" style="color: var(--primary-7)">2026 benchmark by zwei und eins</a> built the same AI chat app as both an SPA (Next.js) and a hypermedia app (PHP/Swoole/Datastar), then measured SSE compression on identical conversations:</p>
        <ul class="docs-list">
          <li><strong>Single turn</strong> — Brotli achieved an <strong>18.7× compression ratio</strong>, turning 112 KB of uncompressed HTML into 6 KB transferred (vs. 14.4 KB uncompressed for the SPA with no compression).</li>
          <li><strong>10-turn conversation</strong> — on a persistent SSE stream, Brotli hit <strong>58.5× compression</strong>. Cross-turn repetition in the HTML gives the compressor more to work with as the conversation grows.</li>
          <li><strong>Net result</strong> — despite sending 29× more raw data (naively re-streaming the full HTML fragment per token), the hypermedia version transferred <strong>2× less data</strong> than the SPA over 10 turns.</li>
        </ul>
        <p>The key insight: a persistent SSE connection lets Brotli build a shared dictionary across all pushes. The more similar the morphs are to each other (which they are — it's the same template with incremental content changes), the better the compression gets over time.</p>
      </section>

      <section class="docs-section">
        <h2>Tradeoffs</h2>
        <ul class="docs-list">
          <li><strong>CPU cost</strong> — compression takes CPU cycles on both ends.</li>
          <li><strong>Latency</strong> — streaming compression helps, but there's still overhead.</li>
          <li><strong>Not needed for low-frequency updates</strong> — if updates are rare, the savings don't matter.</li>
        </ul>
      </section>

      <DocsPager topic={topic} />
    </DocsInner>
  )
}

export function DocsServiceWorkerContent({ topic, commandMenu }) {
  return (
    <DocsInner topic={topic} commandMenu={commandMenu}>
      <h1>{topic.title}</h1>

      <section class="docs-section">
        <p><strong>This is not a recommended Datastar pattern.</strong> The service worker as server is an interesting experiment that makes this demo self-contained — no backend infrastructure required. Datastar works best with a real server in any language.</p>
        <p>That said, running a server inside a service worker teaches you a lot about how the browser, service workers, and SSE interact. This bonus section covers the implementation details.</p>
      </section>

      <section class="docs-section">
        <h2>Why a service worker?</h2>
        <p>This app runs entirely in the browser. No backend server, no database hosting, no deployment pipeline. The service worker intercepts requests, runs a Hono server, talks to IndexedDB, and pushes HTML via SSE. It's a full-stack app in a single JavaScript file.</p>
        <p>The tradeoffs are significant, covered below. But for an educational demo, it means you can clone the repo, run <code>pnpm dev</code>, and have a working app with zero setup.</p>
      </section>

      <section class="docs-section">
        <h2>Fetch interception</h2>
        <p>The service worker registers a <code>fetch</code> event listener that decides what to serve:</p>
        <pre><code>{`self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  
  // Static assets: let the browser handle them.
  // This regex passes JS, CSS, images, fonts through to the network.
  if (/\\.(js|css|png|svg|ico|woff2?|json|webmanifest)/.test(url.pathname)) {
    return
  }
  
  // Strip the SW scope prefix so Hono routes match.
  // /datastar-sw-experiment/boards/123 → /boards/123
  const scope = new URL(self.registration.scope).pathname
  if (scope !== '/' && url.pathname.startsWith(scope)) {
    url.pathname = '/' + url.pathname.slice(scope.length)
  }
  
  // Forward to Hono
  event.respondWith(app.fetch(new Request(url, init)))
})`}</code></pre>
        <p>Static assets bypass the service worker entirely — they're served by Vite in development or cached by the browser in production. This is critical for a Safari quirk: the browser's fetch handler doesn't reliably intercept <code>&lt;script src&gt;</code> subresource requests on service-worker-served pages.</p>
      </section>

      <section class="docs-section">
        <h2>The base() function</h2>
        <p>GitHub Pages serves this app under a subpath: <code>/datastar-sw-experiment/</code>. Every URL in the rendered HTML must include this prefix. The <code>base()</code> helper returns it:</p>
        <pre><code>{`function base() {
  if (!_base) _base = new URL(self.registration.scope).pathname
  return _base
}

// Usage in JSX:
<a href={\`\${base()}boards/\${board.id}\`}>Board</a>
<link rel="stylesheet" href={\`\${base()}\${__STELLAR_CSS__}\`} />`}</code></pre>
        <p>This is used everywhere: routes, form actions, SSE URLs, stylesheet links, script src, even the manifest href. Without it, links break on GitHub Pages.</p>
      </section>

      <section class="docs-section">
        <h2>Lifecycle: install, activate, idle kill</h2>
        <p>Service workers have a strict lifecycle:</p>
        <ul class="docs-list">
          <li><strong>install</strong> — calls <code>skipWaiting()</code> to take control immediately.</li>
          <li><strong>activate</strong> — calls <code>clients.claim()</code> to take control of existing pages without reload.</li>
          <li><strong>idle kill</strong> — browsers terminate idle service workers after ~30 seconds. When you come back, the SW restarts fresh.</li>
        </ul>
        <p>This means in-memory state is <strong>ephemeral</strong>. The event bus, <code>boardUIState</code>, caches — all gone on restart. The app handles this through event sourcing: on startup, it loads a snapshot from IndexedDB and replays events after the snapshot sequence number.</p>
      </section>

      <section class="docs-section">
        <h2>Ephemeral state: what survives restart</h2>
        <table class="docs-table">
          <thead>
            <tr><th>State</th><th>Survives SW restart?</th></tr>
          </thead>
          <tbody>
            <tr><td>IndexedDB (events, projections)</td><td>Yes — persisted to disk</td></tr>
            <tr><td>boardUIState (editing, selection)</td><td>No — in-memory Map</td></tr>
            <tr><td>Event bus listeners</td><td>No — recreated on each request</td></tr>
            <tr><td>Theme preference (localStorage)</td><td>Yes — browser storage</td></tr>
          </tbody>
        </table>
        <p>When the SW restarts, boards open fresh: no open action sheets, no editing, no selection. This is actually correct behavior — the user hasn't done anything yet in this SW instance.</p>
      </section>

      <section class="docs-section">
        <h2>SSE in a service worker</h2>
        <p>Server-Sent Events work inside a service worker, but with caveats:</p>
        <ul class="docs-list">
          <li>The SSE connection persists as long as the SW is alive. When the SW is killed, SSE drops silently.</li>
          <li>Datastar's <code>retry: 'always'</code> option handles reconnection — when the SW restarts, the client reconnects and gets a fresh morph.</li>
          <li>No WebSockets in service workers — SSE is the only real-time option.</li>
        </ul>
        <p>Each SSE stream needs a keep-alive loop to prevent premature closure:</p>
        <pre><code>{`// Without this, the stream closes when the bus has no events.
while (!stream.closed) {
  await stream.sleep(30000)  // check every 30s
}`}</code></pre>
      </section>

      <section class="docs-section">
        <h2>Debugging in a separate context</h2>
        <p>Service worker console logs appear in a different DevTools context than the page. This is confusing — <code>console.log</code> in the SW doesn't show up in the page's console.</p>
        <p>This app works around it with a broadcast channel:</p>
        <pre><code>{`// In the SW:
self.clients.matchAll().forEach(client => {
  client.postMessage({ type: 'log', args: [...] })
})

// In the page:
navigator.serviceWorker.addEventListener('message', (e) => {
  if (e.data.type === 'log') console.log(...e.data.args)
})`}</code></pre>
        <p>Still, breakpoints and debugging require opening DevTools → Application → Service Workers → click the link to open the SW's console.</p>
      </section>

      <section class="docs-section">
        <h2>Development friction: picking up changes</h2>
        <p>Browsers aggressively cache service workers. After editing <code>sw.jsx</code>, the old version may be served for up to 24 hours.</p>
        <p>The fix in this app:</p>
        <pre><code>{`// In index.html — on every page load in dev mode:
if (import.meta.hot) {
  reg.update()  // check for new SW
  import.meta.hot.on('sw-updated', () => reg.update())
}`}</code></pre>
        <p>When Vite rebuilds the SW, it sends an <code>sw-updated</code> HMR event. The page responds by calling <code>reg.update()</code>, which checks the server for a new version. Combined with <code>skipWaiting()</code> in the SW, this triggers an automatic update.</p>
      </section>

      <section class="docs-section">
        <h2>Pros and cons</h2>
        <table class="docs-table">
          <thead>
            <tr><th>Pros</th><th>Cons</th></tr>
          </thead>
          <tbody>
            <tr><td>Zero infrastructure</td><td>Browser kills idle SW (~30s)</td></tr>
            <tr><td>Fully offline capable</td><td>No WebSocket support</td></tr>
            <tr><td>Single-file server</td><td>Debugging in separate console</td></tr>
            <tr><td>No deployment needed</td><td>Safari can't intercept script src</td></tr>
            <tr><td>Instant latency (localhost)</td><td>Ephemeral in-memory state</td></tr>
          </tbody>
        </table>
      </section>

      <DocsPager topic={topic} />
    </DocsInner>
  )
}

// Topic content lookup — returns topic-specific component or falls back to stub
export function DocsTopicContent({ topic, commandMenu }) {
  switch (topic.slug) {
    case 'core/hypermedia':
      return <DocsHypermediaContent topic={topic} commandMenu={commandMenu} />
    case 'core/event-sourcing':
      return <DocsEventSourcingContent topic={topic} commandMenu={commandMenu} />
    case 'core/sse-fat-morph':
      return <DocsFatMorphingContent topic={topic} commandMenu={commandMenu} />
    case 'core/signals':
      return <DocsSignalsContent topic={topic} commandMenu={commandMenu} />
    case 'core/mpa':
      return <DocsMpaContent topic={topic} commandMenu={commandMenu} />
    case 'bonus/sw':
      return <DocsServiceWorkerContent topic={topic} commandMenu={commandMenu} />
    case 'bonus/indexeddb':
      return <DocsIndexedDbContent topic={topic} commandMenu={commandMenu} />
    case 'bonus/fractional':
      return <DocsFractionalIndexingContent topic={topic} commandMenu={commandMenu} />
    case 'bonus/local-first':
      return <DocsLocalFirstContent topic={topic} commandMenu={commandMenu} />
    case 'bonus/brotli':
      return <DocsBrotliContent topic={topic} commandMenu={commandMenu} />
    default:
      return <DocsTopicStubContent topic={topic} commandMenu={commandMenu} />
  }
}
