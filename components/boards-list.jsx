/** @jsxImportSource hono/jsx */
import { Icon } from './icon.jsx'
import { base } from '../lib/base.js'
import { raw } from 'hono/html'

export function BoardCard({ board }) {
  return (
    <div class="board-card" style={`view-transition-name: board-${board.id}`}>
      <a class="board-card-link" href={`${base()}boards/${board.id}`}>
        <h2>{board.title}</h2>
        <div class="board-meta">
          <span>{board.columnCount} {board.columnCount === 1 ? 'column' : 'columns'}</span>
          <span>·</span>
          <span>{board.cardCount} {board.cardCount === 1 ? 'card' : 'cards'}</span>
        </div>
      </a>
      <button
        class="board-delete-btn icon-btn icon-btn--danger"
        data-on:click__prevent__viewtransition={`@delete('${base()}boards/${board.id}')`}
      ><Icon name="lucide:x" /></button>
    </div>
  )
}

export function BoardsList({ boards, templates, commandMenu, CommandMenu }) {
  return (
    <div id="boards-list">
      <h1>Boards</h1>
      <div class="boards-grid">
        {boards.map(b => <BoardCard board={b} />)}
        <form
          class="board-new"
          data-on:submit__prevent={`@post('${base()}boards', {contentType: 'form'})`}
        >
          <input name="title" type="text" placeholder="New board name..." autocomplete="off" />
          <button type="submit"><Icon name="lucide:plus" /> Board</button>
        </form>
      </div>
      {templates && templates.length > 0 && (
        <div id="templates-section">
          <h2 class="templates-heading">Start from a template</h2>
          <div class="templates-grid">
            {templates.map(t => (
              <button
                class="template-card"
                id={`template-${t.id}`}
                data-template-hash={t.hash}
              >
                <span class="template-card-icon">{
                  t.id === 'kanban' ? '\u{1F4CB}' :
                  t.id === 'sprint' ? '\u{1F3C3}' :
                  t.id === 'personal' ? '\u{2705}' :
                  '\u{1F680}'
                }</span>
                <span class="template-card-title">{t.title}</span>
                <span class="template-card-desc">{t.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div class="boards-toolbar">
        <a href={`${base()}docs`} class="toolbar-btn"><Icon name="lucide:book-open" /> Docs</a>
        <button class="toolbar-btn" id="export-btn">Export</button>
        <button class="toolbar-btn" id="import-btn">Import</button>
        <input type="file" id="import-file" accept=".json" style="display:none" />
      </div>
      <script>{raw(`
        // Template card click handler — POST compressed hash directly to import
        document.querySelectorAll('.template-card[data-template-hash]').forEach(function(btn) {
          btn.addEventListener('click', async function() {
            var hash = this.getAttribute('data-template-hash');
            if (!hash) return;
            // Disable all template buttons to prevent double-click
            document.querySelectorAll('.template-card').forEach(function(b) { b.disabled = true; });
            this.querySelector('.template-card-title').textContent = 'Creating...';
            try {
              var resp = await fetch('${base()}import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: hash })
              });
              var result = await resp.json();
              if (resp.ok && result.boardId) {
                window.location.href = '${base()}boards/' + result.boardId;
              } else {
                alert('Template failed: ' + (result.error || resp.statusText));
                document.querySelectorAll('.template-card').forEach(function(b) { b.disabled = false; });
              }
            } catch(err) {
              alert('Template failed: ' + err.message);
              document.querySelectorAll('.template-card').forEach(function(b) { b.disabled = false; });
            }
          });
        });
        document.getElementById('export-btn').addEventListener('click', async function() {
          var resp = await fetch('${base()}export');
          var blob = await resp.blob();
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'kanban-export.json';
          a.click();
          URL.revokeObjectURL(url);
        });
        document.getElementById('import-btn').addEventListener('click', function() {
          document.getElementById('import-file').click();
        });
        document.getElementById('import-file').addEventListener('change', async function(e) {
          var file = e.target.files[0];
          if (!file) return;
          var text = await file.text();
          // File import: compress events to base64url and POST as { data: compressed }
          // so it goes through the same validated import route as share URLs
          try {
            var events = JSON.parse(text);
            if (!Array.isArray(events)) throw new Error('Expected array');
            // Compress using browser-native CompressionStream
            var jsonStr = JSON.stringify(events);
            var encoded = new TextEncoder().encode(jsonStr);
            var cs = new CompressionStream('deflate');
            var writer = cs.writable.getWriter();
            writer.write(encoded);
            writer.close();
            var reader = cs.readable.getReader();
            var chunks = [];
            while (true) {
              var result = await reader.read();
              if (result.done) break;
              chunks.push(result.value);
            }
            var totalLen = chunks.reduce(function(s,c) { return s + c.length; }, 0);
            var merged = new Uint8Array(totalLen);
            var offset = 0;
            for (var i = 0; i < chunks.length; i++) {
              merged.set(chunks[i], offset);
              offset += chunks[i].length;
            }
            // base64url encode in 32K chunks to avoid RangeError
            var CHUNK = 32768;
            var b64 = '';
            for (var j = 0; j < merged.length; j += CHUNK) {
              b64 += String.fromCharCode.apply(null, merged.subarray(j, j + CHUNK));
            }
            b64 = btoa(b64).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
            var resp = await fetch('${base()}import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ data: b64 })
            });
            var result = await resp.json();
            if (resp.ok && result.boardId) {
              window.location.href = '${base()}boards/' + result.boardId;
            } else {
              alert('Import failed: ' + (result.error || resp.statusText));
            }
          } catch(err) {
            alert('Import failed: ' + err.message);
          }
          e.target.value = '';
        });
      `)}</script>
      {commandMenu && (
        <CommandMenu
          query={commandMenu.query}
          results={commandMenu.results || []}
        />
      )}
    </div>
  )
}
