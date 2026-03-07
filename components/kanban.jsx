/** @jsxImportSource hono/jsx */

import { Icon } from './icon.jsx'
import { LABEL_COLORS } from '../lib/constants.js'
import { base } from '../lib/base.js'
import { cmpPosition } from '../lib/position.js'

export function LabelPicker({ cardId, currentLabel }) {
  const swatches = Object.entries(LABEL_COLORS).map(([name, color]) => {
    const target = currentLabel === name ? 'none' : name
    return (
      <button
        type="button"
        class={`label-swatch${currentLabel === name ? ' label-swatch--active' : ''}`}
        style={`--swatch-color: ${color}`}
        data-on:click={`@post('${base()}cards/${cardId}/label/${target}')`}
        title={name}
      >{' '}</button>
    )
  })
  return (
    <div class="label-picker">
      <span class="label-picker-label">Label</span>
      <div class="label-picker-swatches">
        {swatches}
        <button
            type="button"
            id={`label-clear-${cardId}`}
            class="label-swatch-clear"
            style={currentLabel ? '' : 'display:none'}
            data-on:click={`@post('${base()}cards/${cardId}/label/none')`}
            title="Remove label"
          ><Icon name="lucide:x" /></button>
      </div>
    </div>
  )
}

export function Card({ card, uiState, boardId }) {
  const desc = card.description || ''
  const label = card.label || null
  const isReadOnly = uiState?.timeTravelPos >= 0
  const isEditing = !isReadOnly && uiState?.editingCard === card.id
  const isSelecting = !isReadOnly && uiState?.selectionMode
  const isSelected = uiState?.selectedCards?.has(card.id)
  const isHighlighted = uiState?.highlightCard === card.id

  return (
    <div
      class={`card${isSelected ? ' card--selected' : ''}${label ? ' card--labeled' : ''}${isHighlighted ? ' card--highlighted' : ''}`}
      id={`card-${card.id}`}
      data-card-id={card.id}
      tabindex="0"
      style={label ? `border-top: 3px solid ${LABEL_COLORS[label] || 'var(--neutral-7)'}` : ''}
      {...(isSelecting ? {
        'data-kanban-no-drag': '',
        'data-on:click': `@post('${base()}cards/${card.id}/toggle-select')`,
      } : {})}
    >
      <span id={`card-${card.id}-checkbox`} class="card-select-checkbox" style={isSelecting ? '' : 'display:none'}>{isSelected ? <Icon name="lucide:square-check" /> : <Icon name="lucide:square" />}</span>
      <div class="card-content">
        <span class="card-title">{card.title}</span>
        {desc && <p class="card-desc">{desc}</p>}
      </div>
      <div id={`card-${card.id}-actions`} class="card-actions" style={!isSelecting && !isReadOnly ? '' : 'display:none'}>
        <button
          class="card-edit-btn icon-btn"
          data-on:click={`@post('${base()}cards/${card.id}/edit')`}
          title="Edit"
        ><Icon name="lucide:pencil" /></button>
        {boardId && (
          <a
            class="card-expand-btn icon-btn"
            href={`${base()}boards/${boardId}/cards/${card.id}`}
            title="Open"
          ><Icon name="lucide:arrow-up-right" /></a>
        )}
        <button
          class="delete-btn icon-btn icon-btn--danger"
          data-on:click__viewtransition={`@delete('${base()}cards/${card.id}')`}
          title="Delete"
        >
          <Icon name="lucide:x" />
        </button>
      </div>
      <form
        id={`card-${card.id}-edit-form`}
        class="card-edit-form"
        style={isEditing ? '' : 'display:none'}
        data-on:submit__prevent={`@put('${base()}cards/${card.id}', {contentType: 'form'})`}
      >
        <div class="card-edit-inputs">
          <input name="title" type="text" value={card.title} placeholder="Title" autocomplete="off" />
          <textarea name="description" placeholder="Description (optional)" rows="2">{desc}</textarea>
        </div>
        <LabelPicker cardId={card.id} currentLabel={label} />
        <div class="card-edit-actions">
          <button type="submit">Save</button>
          <button type="button" data-on:click={`@post('${base()}cards/${card.id}/edit-cancel')`}>Cancel</button>
        </div>
      </form>
    </div>
  )
}

export function ActionSheet({ card, columns }) {
  // Show "Move to" buttons for every column except the card's current one
  const otherColumns = columns.filter(c => c.id !== card.columnId)
  return (
    <div class="action-sheet-backdrop" data-on:click={`@post('${base()}cards/sheet/dismiss')`}>
      <div class="action-sheet" data-on:click__stop="void 0">
        <div class="action-sheet-header">
          <span class="action-sheet-title">{card.title}</span>
        </div>
        {otherColumns.length > 0 && (
          <div class="action-sheet-section">
            <span class="action-sheet-label">Move to</span>
            {otherColumns.map(col => (
              <button
                class="action-sheet-btn"
                data-on:click={`@post('${base()}cards/${card.id}/sheet-move/${col.id}')`}
              >{col.title}</button>
            ))}
          </div>
        )}
        <div class="action-sheet-section">
          <span class="action-sheet-label">Label</span>
          <div class="action-sheet-swatches">
            {Object.entries(LABEL_COLORS).map(([name, color]) => {
              const target = card.label === name ? 'none' : name
              return (
                <button
                  class={`label-swatch label-swatch--lg${card.label === name ? ' label-swatch--active' : ''}`}
                  style={`--swatch-color: ${color}`}
                  data-on:click={`@post('${base()}cards/${card.id}/label/${target}')`}
                  title={name}
                >{' '}</button>
              )
            })}
            {card.label && (
              <button
                class="label-swatch-clear"
                data-on:click={`@post('${base()}cards/${card.id}/label/none')`}
                title="Remove label"
              ><Icon name="lucide:x" /></button>
            )}
          </div>
        </div>
        <div class="action-sheet-section">
          <button
            class="action-sheet-btn"
            data-on:click={`@post('${base()}cards/${card.id}/edit')`}
          >Edit</button>
          <button
            class="action-sheet-btn action-sheet-btn--danger"
            data-on:click__viewtransition={`@delete('${base()}cards/${card.id}')`}
          >Delete</button>
        </div>
        <button
          class="action-sheet-btn action-sheet-btn--cancel"
          data-on:click={`@post('${base()}cards/sheet/dismiss')`}
        >Cancel</button>
      </div>
    </div>
  )
}

export function ColumnSheet({ col, colIndex, columnCount, boardId }) {
  return (
    <div class="action-sheet-backdrop" data-on:click={`@post('${base()}columns/sheet/dismiss')`}>
      <div class="action-sheet" data-on:click__stop="void 0">
        <div class="action-sheet-header">
          <span class="action-sheet-title">{col.title}</span>
        </div>
        <div class="action-sheet-section">
          <span class="action-sheet-label">Reorder</span>
          {colIndex > 0 && (
            <button
              class="action-sheet-btn"
              data-on:click={`@post('${base()}columns/${col.id}/sheet-move-left')`}
            ><Icon name="lucide:arrow-left" /> Move left</button>
          )}
          {colIndex < columnCount - 1 && (
            <button
              class="action-sheet-btn"
              data-on:click={`@post('${base()}columns/${col.id}/sheet-move-right')`}
            >Move right <Icon name="lucide:arrow-right" /></button>
          )}
        </div>
        {columnCount > 1 && (
          <div class="action-sheet-section">
            <button
              class="action-sheet-btn action-sheet-btn--danger"
              data-on:click__viewtransition={`@delete('${base()}columns/${col.id}')`}
            >Delete column</button>
          </div>
        )}
        <button
          class="action-sheet-btn action-sheet-btn--cancel"
          data-on:click={`@post('${base()}columns/sheet/dismiss')`}
        >Cancel</button>
      </div>
    </div>
  )
}

export function Column({ col, cards, columnCount, uiState, boardId }) {
  const colCards = cards
    .filter(c => c.columnId === col.id)
    .sort(cmpPosition)
  const isReadOnly = uiState?.timeTravelPos >= 0

  return (
    <div
      class="column"
      id={`column-${col.id}`}
      style={`view-transition-name: col-${col.id}; view-transition-class: col`}
    >
      <div class="column-header" tabindex="0">
        <h2>{col.title}</h2>
        <span class="count">{colCards.length}</span>
        <button
            id={`col-${col.id}-delete`}
            class="col-delete-btn icon-btn icon-btn--danger"
            style={!isReadOnly && columnCount > 1 ? '' : 'display:none'}
            data-on:click__viewtransition={`@delete('${base()}columns/${col.id}')`}
            title="Delete column"
          ><Icon name="lucide:x" /></button>
      </div>
      <div class="cards-container" data-column-id={col.id}>
        {colCards.length === 0
          ? <p class="empty">No cards yet</p>
          : colCards.map(card => <Card card={card} uiState={uiState} boardId={boardId} />)}
      </div>
      <form
        id={`add-form-${col.id}`}
        class="add-form"
        style={!isReadOnly && !uiState?.selectionMode ? '' : 'display:none'}
        data-on:submit__prevent__viewtransition={`@post('${base()}columns/${col.id}/cards', {contentType: 'form'}); evt.target.reset()`}
      >
        <input name="title" type="text" placeholder="Add a card..." autocomplete="off" />
        <button type="submit" title="Add card"><Icon name="lucide:plus" /></button>
      </form>
    </div>
  )
}

export function eventLabel(type) {
  const labels = {
    'board.created': 'Board created',
    'board.titleUpdated': 'Title renamed',
    'board.deleted': 'Board deleted',
    'column.created': 'Column added',
    'column.deleted': 'Column deleted',
    'column.moved': 'Column moved',
    'card.created': 'Card added',
    'card.moved': 'Card moved',
    'card.deleted': 'Card deleted',
    'card.titleUpdated': 'Card renamed',
    'card.descriptionUpdated': 'Description edited',
    'card.labelUpdated': 'Label changed',
  }
  return labels[type] || type
}

export function TimeTravelBar({ boardId, events, pos }) {
  const current = events[pos]
  const ts = current ? new Date(current.ts).toLocaleTimeString() : ''
  const seekUrl = `${base()}boards/${boardId}/time-travel/seek`
  return (
    <div id="time-travel-bar" class="time-travel-bar">
      <div class="tt-header">
        <span class="tt-label">History</span>
        <span id="tt-info" class="tt-info">
          {current ? `${eventLabel(current.type)} — ${ts}` : 'No events'}
        </span>
        <button
          id="tt-exit"
          class="tt-exit"
          data-on:click={`@post('${base()}boards/${boardId}/time-travel/exit')`}
        >Exit</button>
      </div>
      <div id="tt-form" class="tt-controls">
        <button
          id="tt-prev"
          type="button"
          class="tt-step"
          title="Previous event"
          disabled={pos <= 0}
          data-on:click={`fetch('${seekUrl}', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'position=${pos - 1}'})`}
        ><Icon name="lucide:chevron-left" /></button>
        <input
          id="tt-slider"
          type="range"
          min="0"
          max={String(events.length - 1)}
          value={String(pos)}
          aria-label="Event history position"
          data-on:input__debounce_100ms={`fetch('${seekUrl}', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'position='+evt.target.value})`}
        />
        <button
          id="tt-next"
          type="button"
          class="tt-step"
          title="Next event"
          disabled={pos >= events.length - 1}
          data-on:click={`fetch('${seekUrl}', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'position=${pos + 1}'})`}
        ><Icon name="lucide:chevron-right" /></button>
        <span id="tt-counter" class="tt-counter">{pos + 1} / {events.length}</span>
      </div>
    </div>
  )
}

export function HelpOverlay({ boardId }) {
  return (
    <div id="help-overlay" class="help-overlay-backdrop" data-on:click={`@post('${base()}boards/${boardId}/help-dismiss')`}>
      <div class="help-overlay" data-on:click__stop="void 0">
        <div class="help-overlay-header">
          <span class="help-overlay-title">Keyboard shortcuts</span>
          <button class="help-overlay-close icon-btn" data-on:click={`@post('${base()}boards/${boardId}/help-dismiss')`}><Icon name="lucide:x" /></button>
        </div>
        <div class="help-overlay-body">
          <div class="help-section">
            <h3 class="help-section-title">Navigate</h3>
            <div class="help-row"><kbd>{'↑ ↓ ← →'}</kbd><span>Move focus between cards</span></div>
            <div class="help-row"><kbd>h j k l</kbd><span>Vim-style navigation</span></div>
          </div>
          <div class="help-section">
            <h3 class="help-section-title">Move items</h3>
            <div class="help-row"><kbd>{'Ctrl + ↑ ↓ ← →'}</kbd><span>Move card or column</span></div>
            <div class="help-row"><kbd>Ctrl + h j k l</kbd><span>Vim-style move</span></div>
          </div>
          <div class="help-section">
            <h3 class="help-section-title">Actions</h3>
            <div class="help-row"><kbd>Ctrl + Z</kbd><span>Undo</span></div>
            <div class="help-row"><kbd>Ctrl + Shift + Z</kbd><span>Redo</span></div>
            <div class="help-row"><kbd>{'\u2318'}K</kbd><span>Command menu</span></div>
            <div class="help-row"><kbd>Escape</kbd><span>Cancel drag / close overlay</span></div>
            <div class="help-row"><kbd>?</kbd><span>Toggle this help</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function StatusChip({ isOnline, unsyncedCount, hasSyncConfig }) {
  if (!isOnline) {
    return <span id="status-chip" class="status-chip status-chip--offline" title="No network connection">Offline</span>
  }
  if (!hasSyncConfig) {
    return <span id="status-chip" class="status-chip status-chip--local" title={`${unsyncedCount} event${unsyncedCount !== 1 ? 's' : ''} stored locally`}>Local</span>
  }
  if (unsyncedCount > 0) {
    return <span id="status-chip" class="status-chip status-chip--pending" title={`${unsyncedCount} event${unsyncedCount !== 1 ? 's' : ''} pending sync`}>{unsyncedCount} pending</span>
  }
  return <span id="status-chip" class="status-chip status-chip--synced" title="All events synced">Synced</span>
}

export function Board({ board, columns, cards, uiState, tabCount, connStatus, commandMenu, CommandMenu }) {
  const isTimeTraveling = uiState?.timeTravelPos >= 0
  const isSelecting = !isTimeTraveling && uiState?.selectionMode
  const isEditingTitle = !isTimeTraveling && uiState?.editingBoardTitle
  const selectedCount = uiState?.selectedCards?.size || 0
  const sheetCard = !isTimeTraveling && uiState?.activeCardSheet
    ? cards.find(c => c.id === uiState.activeCardSheet) || null
    : null
  const sheetColIndex = !isTimeTraveling && uiState?.activeColSheet
    ? columns.findIndex(c => c.id === uiState.activeColSheet)
    : -1
  const sheetCol = sheetColIndex >= 0 ? columns[sheetColIndex] : null
  return (
    <div id="board" class={isTimeTraveling ? 'board--time-travel' : ''}>
      <div id="board-header" class="board-header">
        {isEditingTitle
          ? <>
              <a id="board-back" href={base()} class="back-link board-back-title"><Icon name="lucide:arrow-left" /> {board.title}</a>
              <form
                id="board-title-form"
                class="board-title-form"
                data-on:submit__prevent={`@put('${base()}boards/${board.id}', {contentType: 'form'})`}
              >
                <input id="board-title-input" name="title" type="text" value={board.title} autocomplete="off" />
                <button type="submit" class="board-title-save">Save</button>
                <button type="button" class="board-title-cancel" data-on:click={`@post('${base()}boards/${board.id}/title-edit-cancel')`}>Cancel</button>
              </form>
            </>
          : <>
              <a id="board-back" href={base()} class="back-link board-back-title"><Icon name="lucide:arrow-left" /> {board.title}</a>
              {!isTimeTraveling && (
                <button
                  id="board-title-edit-btn"
                  class="board-title-edit-btn icon-btn"
                  data-on:click={`@post('${base()}boards/${board.id}/title-edit')`}
                  title="Edit board title"
                ><Icon name="lucide:pencil" /></button>
              )}
            </>
        }
        <span id="tab-count" class={`tab-count${tabCount > 1 ? '' : ' tab-count--hidden'}`} title={`${tabCount} tabs viewing this board`}>{tabCount > 1 ? `${tabCount} tabs` : ''}</span>
        {connStatus && <StatusChip isOnline={connStatus.isOnline} unsyncedCount={connStatus.unsyncedCount} hasSyncConfig={connStatus.hasSyncConfig} />}
        {!isSelecting && !isTimeTraveling && (
          <button
            id="select-mode-btn"
            class="select-mode-btn"
            data-on:click={`@post('${base()}boards/${board.id}/select-mode')`}
          >Select</button>
        )}
        {!isTimeTraveling && (
          <button
            id="time-travel-btn"
            class="select-mode-btn"
            data-on:click={`@post('${base()}boards/${board.id}/time-travel')`}
          >History</button>
        )}
        {!isSelecting && !isTimeTraveling && (
          <button
            id="share-btn"
            class="select-mode-btn"
            data-on:click={`
              fetch('${base()}boards/${board.id}/share', {method:'POST'})
                .then(r => r.json())
                .then(d => {
                  var url = location.origin + d.shareUrl;
                  navigator.clipboard.writeText(url).then(function() {
                    var btn = document.getElementById('share-btn');
                    if (btn) { btn.textContent = 'Copied!'; setTimeout(function(){ btn.textContent = 'Share'; }, 2000); }
                  });
                })
            `}
          >Share</button>
        )}
      </div>
      {isTimeTraveling && (
        <TimeTravelBar boardId={board.id} events={uiState.timeTravelEvents} pos={uiState.timeTravelPos} />
      )}
      <div class="columns">
        {columns.map(col => (
          <Column col={col} cards={cards} columnCount={columns.length} uiState={uiState} boardId={board.id} />
        ))}
      </div>
      <form
        id="add-col-form"
        class="add-col-form"
        style={!isSelecting && !isTimeTraveling ? '' : 'display:none'}
        data-on:submit__prevent__viewtransition={`@post('${base()}boards/${board.id}/columns', {contentType: 'form'}); evt.target.reset()`}
      >
        <input name="title" type="text" placeholder="Add a column..." autocomplete="off" />
        <button type="submit"><Icon name="lucide:plus" /> Column</button>
      </form>
      {isSelecting && (
        <SelectionBar boardId={board.id} columns={columns} selectedCount={selectedCount} />
      )}
      {sheetCard && (
        <ActionSheet card={sheetCard} columns={columns} />
      )}
      {sheetCol && (
        <ColumnSheet col={sheetCol} colIndex={sheetColIndex} columnCount={columns.length} boardId={board.id} />
      )}
      {uiState?.showHelp && (
        <HelpOverlay boardId={board.id} />
      )}
      {commandMenu && (
        <CommandMenu
          query={commandMenu.query}
          results={commandMenu.results || []}
        />
      )}
    </div>
  )
}

export function SelectionBar({ boardId, columns, selectedCount }) {
  return (
    <div id="selection-bar" class="selection-bar" data-signals="{showColumnPicker: false}">
      <span class="selection-bar-count">{selectedCount} selected</span>
      <div class="selection-bar-actions">
        <button
          class="selection-bar-btn"
          data-on:click="$showColumnPicker = !$showColumnPicker"
          disabled={selectedCount === 0}
        >Move to…</button>
        <div class="column-picker" data-show="$showColumnPicker">
          {columns.map(col => (
            <button
              class="column-picker-btn"
              data-on:click={`@post('${base()}boards/${boardId}/batch-move/${col.id}'); $showColumnPicker = false`}
            >{col.title}</button>
          ))}
        </div>
        <button
          class="selection-bar-btn selection-bar-btn--danger"
          data-on:click__viewtransition={`@post('${base()}boards/${boardId}/batch-delete')`}
          disabled={selectedCount === 0}
        >Delete</button>
        <button
          class="selection-bar-btn"
          data-on:click={`@post('${base()}boards/${boardId}/select-mode/cancel')`}
        >Cancel</button>
      </div>
    </div>
  )
}
