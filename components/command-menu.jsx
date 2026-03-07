/** @jsxImportSource hono/jsx */
import { Icon } from './icon.jsx'
import { LABEL_COLORS } from '../lib/constants.js'
import { base } from '../lib/base.js'

export function CommandMenu({ query, results }) {
  // Group results by their group header
  const groups = []
  let currentGroup = null
  for (const r of results) {
    if (!currentGroup || currentGroup.name !== r.group) {
      currentGroup = { name: r.group, items: [] }
      groups.push(currentGroup)
    }
    currentGroup.items.push(r)
  }

  // Build click handler per result type
  function clickHandler(r) {
    // Card: close menu + navigate to card detail route
    if (r.type === 'card') {
      return `fetch('${base()}command-menu/close',{method:'POST'}).then(function(){window.location.href='${base()}boards/${r.boardId}/cards/${r.id}'})`
    }
    // Popup: close menu + open in new window
    if (r.popupUrl) {
      return `fetch('${base()}command-menu/close',{method:'POST'}).then(function(){window.open('${r.popupUrl}','${r.popupName || '_blank'}','width=720,height=640')})`
    }
    // Inline JS action: close menu + run arbitrary JS
    if (r.jsAction) {
      return `fetch('${base()}command-menu/close',{method:'POST'}).then(function(){${r.jsAction}})`
    }
    // Board navigation
    if (r.href) {
      return `fetch('${base()}command-menu/close',{method:'POST'}).then(function(){window.location.href='${r.href}'})`
    }
    // Action: close menu + execute
    if (r.actionUrl) {
      return `fetch('${base()}command-menu/close',{method:'POST'}).then(function(){fetch('${r.actionUrl}',{method:'POST'})})`
    }
    return `@post('${base()}command-menu/close')`
  }

  const TYPE_ICONS = { action: 'lucide:zap', board: 'lucide:layout-dashboard', card: 'lucide:tag', column: 'lucide:columns-3' }

  let flatIdx = 0
  return (
    <div id="command-menu" class="command-menu-backdrop" data-on:click={`if(window.revertTheme)revertTheme();@post('${base()}command-menu/close')`}>
      <div class="command-menu-panel" data-on:click__stop="void 0" data-signals={`{cmdIdx: 0, cmdCount: ${results.length}}`}>
        <form id="command-menu-form" data-on:submit__prevent="void 0">
          <div class="command-menu-input-wrap">
            <span class="command-menu-icon"><Icon name="lucide:search" /></span>
            <input
              id="command-menu-input"
              class="command-menu-input"
              type="text"
              placeholder="Search boards, cards, actions..."
              value={query}
              autocomplete="off"
              data-on:input__debounce_150ms={`$cmdIdx = 0; @post('${base()}command-menu/search', {contentType: 'form'})`}
              data-on:keydown={`
                if (event.key === 'ArrowDown') { event.preventDefault(); $cmdIdx = ($cmdIdx + 1) % $cmdCount; requestAnimationFrame(function(){var a=document.querySelector('.command-menu-result--active');if(a&&a.dataset.themePreview&&window.previewTheme)previewTheme(a.dataset.themePreview)}); }
                else if (event.key === 'ArrowUp') { event.preventDefault(); $cmdIdx = ($cmdIdx - 1 + $cmdCount) % $cmdCount; requestAnimationFrame(function(){var a=document.querySelector('.command-menu-result--active');if(a&&a.dataset.themePreview&&window.previewTheme)previewTheme(a.dataset.themePreview)}); }
                else if (event.key === 'Enter') { event.preventDefault(); var a = document.querySelector('.command-menu-result--active'); if (a) a.click(); }
                else if (event.key === 'Escape') { event.preventDefault(); if(window.revertTheme)revertTheme(); @post('${base()}command-menu/close'); }
              `}
              name="query"
            />
          </div>
        </form>
        {results.length > 0 ? (
          <div class="command-menu-results">
            {groups.map(g => {
              const section = (
                <div id={`cmd-group-${g.name.toLowerCase().replace(/\s+/g, '-')}`} class="command-menu-section">
                  <div class="command-menu-section-header">{g.name}</div>
                  <ul class="command-menu-section-list">
                    {g.items.map(r => {
                      const idx = flatIdx++
                      return (
                        <li
                          id={`cmd-result-${r.id}`}
                          class="command-menu-result"
                          data-class={`{'command-menu-result--active': $cmdIdx === ${idx}}`}
                          data-on:click={clickHandler(r)}
                          {...(r.themeId ? { 'data-theme-preview': r.themeId, 'data-on:mouseenter': `if(window.previewTheme)previewTheme('${r.themeId}')` } : {})}
                        >
                          <span class="command-menu-result-title">
                            <span class="command-menu-type-icon">{TYPE_ICONS[r.type] ? <Icon name={TYPE_ICONS[r.type]} /> : ''}</span>
                            {r.type === 'card' && r.label && <span class="command-menu-label-dot" style={`background: ${LABEL_COLORS[r.label] || 'var(--neutral-7)'}`}>{' '}</span>}
                            {r.title}
                          </span>
                          <span class="command-menu-result-sub">{r.subtitle || ''}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
              return section
            })}
          </div>
        ) : query ? (
          <div class="command-menu-empty">No results found</div>
        ) : (
          <div class="command-menu-hint">Type to search across all boards and cards</div>
        )}
      </div>
    </div>
  )
}
