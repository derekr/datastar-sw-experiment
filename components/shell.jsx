/** @jsxImportSource hono/jsx */
import { raw } from 'hono/html'
import { CSS } from '../css/app.css.js'
import { base } from '../lib/base.js'
import { getAssetConfig } from '../lib/assets.js'

export function Shell({ path, children }) {
  const assets = getAssetConfig()
  const routePath = path || '/'
  const isCardPage = /^\/boards\/[^/]+\/cards\//.test(routePath)
  const isBoardPage = routePath.startsWith('/boards/') && !isCardPage
  // Client-side SSE URL needs the base path so the browser hits the SW scope.
  const sseUrl = base() + routePath.replace(/^\//, '')
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        <meta id="theme-color-meta" name="theme-color" content="#121017" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="manifest" href={`${base()}manifest.json`} />
        <link rel="icon" href={`${base()}icon.svg`} type="image/svg+xml" />
        <link rel="apple-touch-icon" href={`${base()}icon-192.png`} />
        <script>{raw(`(function(){var t=localStorage.getItem('theme')||'system';function apply(t){var dark=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.dataset.theme=dark?'dark':'light';var m=document.getElementById('theme-color-meta');if(m)m.content=dark?'#121017':'#f4eefa'}apply(t);matchMedia('(prefers-color-scheme:dark)').addEventListener('change',function(){var t=localStorage.getItem('theme')||'system';if(t==='system')apply(t)});window.applyTheme=function(t){localStorage.setItem('theme',t);apply(t)};window.previewTheme=function(t){apply(t)};window.revertTheme=function(){apply(localStorage.getItem('theme')||'system')}})()`)}</script>
        <link rel="preload" href="https://fonts.bunny.net/inter/files/inter-latin-100-normal.woff2" as="font" type="font/woff2" crossorigin />
        <link rel="preload" href="https://fonts.bunny.net/inter/files/inter-latin-900-normal.woff2" as="font" type="font/woff2" crossorigin />
        <link rel="stylesheet" href={`${base()}${assets.stellarCssPath}`} />
        <title>Kanban</title>
        <style>{raw(CSS + '\n' + (assets.lucideIconCSS || ''))}</style>
        <script
          type="module"
          src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.8/bundles/datastar.js"
        ></script>
        {isBoardPage && <script src={`${base()}${assets.kanbanJsPath}`}></script>}
        {!isBoardPage && <script type="speculationrules">{raw(JSON.stringify({
          prefetch: [{
            source: 'document',
            where: { href_matches: `${base()}boards/*` },
            eagerness: 'moderate',
          }],
        }))}</script>}
      </head>
      <body>
        <main
          id="app"
          data-init={`@get('${sseUrl}', { retry: 'always', retryMaxCount: 1000 })`}
        >
          {children || <p>Loading...</p>}
        </main>
        <script>{raw(`
          // Board import: detect #import=<compressed> in URL hash
          (function() {
            var m = location.hash.match(/^#import=(.+)$/);
            if (!m) return;
            var data = m[1];
            history.replaceState(null, '', location.pathname + location.search);
            var app = document.getElementById('app');
            if (app) app.innerHTML = '<p>Importing board...</p>';
            // Remove data-init to prevent SSE stream from starting during import
            if (app) app.removeAttribute('data-init');
            fetch('${base()}import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ data: data }),
            }).then(function(r) { return r.json(); }).then(function(result) {
              if (result.boardId) {
                window.location.replace('${base()}boards/' + result.boardId);
              } else {
                window.location.replace('${base()}');
              }
            }).catch(function(e) {
              console.error('Board import failed:', e);
              if (app) app.innerHTML = '<p>Import failed. <a href="${base()}">Go to boards</a></p>';
            });
          })();

          if (navigator.serviceWorker) {
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              window.location.reload();
            });
            // Re-register with updateViaCache:'none' to update existing
            // installations — forces conditional requests for sw.js, bypassing
            // HTTP cache (fixes stale SW on GitHub Pages CDN).
            navigator.serviceWorker.ready.then(reg => {
              navigator.serviceWorker.register(reg.active.scriptURL, { updateViaCache: 'none' })
                .then(r => r.update());
              setInterval(() => reg.update(), 60 * 1000);
            });
          }
          navigator.storage?.persist?.();

          // Haptic feedback via Vibration API (no-op on desktop / unsupported browsers)
          var _noHaptics = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          function haptic(pattern) {
            if (_noHaptics || !navigator.vibrate) return;
            navigator.vibrate(pattern);
          }
          haptic.tap = function() { haptic(8); };
          haptic.drop = function() { haptic(15); };
          haptic.warn = function() { haptic([12, 40, 12]); };

          // Initialize eg-kanban when #board appears.
          // Runs on mutations (SSE morph) AND immediately for pre-rendered content.
          // Track the DOM node reference so we re-init if Idiomorph replaces #board.
          var kanbanCleanup = null;
          var kanbanBoardEl = null;
          function checkKanban() {
            var board = document.getElementById('board');
            // If #board is a different DOM node than what we initialized, tear down old one
            if (board && kanbanCleanup && board !== kanbanBoardEl) {
              kanbanCleanup();
              kanbanCleanup = null;
              kanbanBoardEl = null;
            }
            if (board && !kanbanCleanup && window.initKanban) {
              kanbanCleanup = window.initKanban(board);
              kanbanBoardEl = board;
            }
            if (!board && kanbanCleanup) {
              kanbanCleanup();
              kanbanCleanup = null;
              kanbanBoardEl = null;
            }
          }
          var boardObserver = new MutationObserver(checkKanban);
          boardObserver.observe(document.getElementById('app'), { childList: true, subtree: true });
          checkKanban();

          // Drag-and-drop and keyboard moves use raw fetch() to SW routes.
          // eg-kanban.js emits CustomEvents — the SSE morph handles UI updates.

          // Focus restoration after SSE morph: save the focused element's
          // identity before the morph replaces the DOM, then re-focus it.
          var pendingFocus = null;
          var _lastCmdMenuSeen = false;
          var focusObserver = new MutationObserver(function() {
            // Auto-focus command menu input when it first appears
            var cmdMenu = document.getElementById('command-menu');
            if (cmdMenu && !_lastCmdMenuSeen) {
              var cmdInput = document.getElementById('command-menu-input');
              if (cmdInput) cmdInput.focus();
            }
            _lastCmdMenuSeen = !!cmdMenu;
            // Scroll highlighted card into view (command menu search result)
            var highlighted = document.querySelector('.card--highlighted');
            if (highlighted) {
              highlighted.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            }
            if (!pendingFocus) return;
            var el = null;
            if (pendingFocus.cardId) {
              el = document.querySelector('[data-card-id="' + pendingFocus.cardId + '"]');
            } else if (pendingFocus.columnId) {
              var col = document.getElementById('column-' + pendingFocus.columnId);
              if (col) el = col.querySelector('.column-header');
            }
            if (el) { el.focus({ preventScroll: false }); pendingFocus = null; }
          });
          focusObserver.observe(document.getElementById('app'), { childList: true, subtree: true });

          document.getElementById('app').addEventListener('kanban-card-drag-end', function(e) {
            var d = e.detail;
            if (!d.columnId || !d.cardId) return;
            haptic.drop();
            pendingFocus = { cardId: d.cardId };
            fetch('${base()}cards/' + d.cardId + '/move', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dropColumnId: d.columnId, dropPosition: d.position })
            });
          });

          // Touch card tap → open action sheet (server-tracked)
          document.getElementById('app').addEventListener('kanban-card-tap', function(e) {
            var d = e.detail;
            if (!d.cardId) return;
            haptic.tap();
            fetch('${base()}cards/' + d.cardId + '/sheet', { method: 'POST' });
          });

          // Touch column tap → open column action sheet
          document.getElementById('app').addEventListener('kanban-column-tap', function(e) {
            var d = e.detail;
            if (!d.columnId) return;
            haptic.tap();
            fetch('${base()}columns/' + d.columnId + '/sheet', { method: 'POST' });
          });

          // Enter on focused card → open for editing
          document.getElementById('app').addEventListener('kanban-card-open', function(e) {
            var d = e.detail;
            if (!d.cardId) return;
            pendingFocus = { cardId: d.cardId };
            fetch('${base()}cards/' + d.cardId + '/edit', { method: 'POST' });
          });

          document.getElementById('app').addEventListener('kanban-column-drag-end', function(e) {
            var d = e.detail;
            if (!d.columnId) return;
            haptic.drop();
            pendingFocus = { columnId: d.columnId };
            fetch('${base()}columns/' + d.columnId + '/move', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dropPosition: d.position })
            });
          });

          // Undo/Redo: Ctrl+Z / Ctrl+Shift+Z (or Cmd on Mac)
          document.addEventListener('keydown', function(e) {
            if (!(e.ctrlKey || e.metaKey) || e.key !== 'z') return;
            // Don't intercept when typing in an input/textarea
            var tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea') return;
            e.preventDefault();
            var boardMatch = location.pathname.match(/boards\\/([^/]+)/);
            if (!boardMatch) return;
            var boardId = boardMatch[1];
            var action = e.shiftKey ? 'redo' : 'undo';
            fetch('${base()}boards/' + boardId + '/' + action, { method: 'POST' });
          });

          // Cmd+K → toggle command menu (works on any page)
          document.addEventListener('keydown', function(e) {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
              e.preventDefault();
              fetch('${base()}command-menu/open', {
                method: 'POST',
                headers: { 'X-Context': location.pathname }
              });
            }
          });

          // Escape → dismiss command menu (global) or help overlay (board-specific)
          // ? key → toggle help overlay (board-specific)
          document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
              if (document.getElementById('command-menu')) {
                e.preventDefault();
                fetch('${base()}command-menu/close', { method: 'POST' });
                return;
              }
              var boardMatch = location.pathname.match(/boards\\/([^/]+)/);
              if (boardMatch && document.getElementById('help-overlay')) {
                e.preventDefault();
                fetch('${base()}boards/' + boardMatch[1] + '/help-dismiss', { method: 'POST' });
              }
              return;
            }
            var tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea') return;
            var boardMatch = location.pathname.match(/boards\\/([^/]+)/);
            if (!boardMatch) return;
            if (e.key === '?') {
              e.preventDefault();
              fetch('${base()}boards/' + boardMatch[1] + '/help', { method: 'POST' });
            }
          });

          // Notify SW of connection changes so status chip updates
          window.addEventListener('online', function() {
            fetch('${base()}connection-change', { method: 'POST' });
          });
          window.addEventListener('offline', function() {
            fetch('${base()}connection-change', { method: 'POST' });
          });

          // Haptic feedback on Datastar-driven actions via event delegation
          document.getElementById('app').addEventListener('click', function(e) {
            var t = e.target;
            if (!t || !t.closest) return;
            if (t.closest('.action-sheet-btn--danger') || t.closest('.delete-btn')) {
              haptic.warn();
            } else if (t.closest('.card-select-checkbox') || t.closest('.card--selected') || t.closest('[data-on\\\\:click*="toggle-select"]')) {
              haptic.tap();
            } else if (t.closest('.label-swatch')) {
              haptic.tap();
            }
          }, true);

          // View transition: card expand / collapse
          // When navigating TO a card detail page, tag the card element so the
          // browser animates it into the detail view.
          window.addEventListener('pageswap', function(e) {
            if (!e.viewTransition) return;
            var url = new URL(e.activation.entry.url);
            var m = url.pathname.match(/boards\\/[^/]+\\/cards\\/([^/]+)/);
            if (m) {
              var el = document.getElementById('card-' + m[1]);
              if (el) el.style.viewTransitionName = 'card-expand';
            }
          });
          // When navigating FROM a card detail page back to a board, tag the
          // card element on the new page so the detail collapses back into it.
          window.addEventListener('pagereveal', function(e) {
            if (!e.viewTransition) return;
            var from = navigation.activation && navigation.activation.from;
            if (!from) return;
            var m = new URL(from.url).pathname.match(/boards\\/[^/]+\\/cards\\/([^/]+)/);
            if (m) {
              e.viewTransition.types.add('card-collapse');
              var el = document.getElementById('card-' + m[1]);
              if (el) el.style.viewTransitionName = 'card-expand';
            }
          });
        `)}</script>
      </body>
    </html>
  )
}
