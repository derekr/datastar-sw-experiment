/** @jsxImportSource hono/jsx */
import { Icon } from './icon.jsx'
import { LabelPicker, eventLabel } from './kanban.jsx'
import { LABEL_COLORS } from '../lib/constants.js'
import { base } from '../lib/base.js'

export function CardDetail({ card, column, columns, board, events, commandMenu, CommandMenu }) {
  const desc = card.description || ''
  const label = card.label || null
  const created = events.find(e => e.type === 'card.created')
  const lastModified = events.length > 0 ? events[events.length - 1] : null

  return (
    <div id="card-detail" style={`view-transition-name: card-expand${label ? `; --card-label-color: ${LABEL_COLORS[label] || 'var(--neutral-7)'}` : ''}`}>
      <div class="card-detail-header">
        <a id="card-detail-back" href={`${base()}boards/${board.id}`} class="back-link"><Icon name="lucide:arrow-left" /> {board.title}</a>
      </div>
      <div class="card-detail-body">
          <div class="card-detail-main">
          <div id="card-detail-label-bar" class="card-detail-label-bar" style={label ? `background: ${LABEL_COLORS[label]}` : 'display:none'}></div>
          <form
            class="card-detail-form"
            data-on:submit__prevent={`@put('${base()}cards/${card.id}', {contentType: 'form'})`}
          >
            <input
              id="card-detail-title"
              name="title"
              type="text"
              value={card.title}
              class="card-detail-title-input"
              placeholder="Card title"
              autocomplete="off"
            />
            <textarea
              id="card-detail-desc"
              name="description"
              class="card-detail-desc-input"
              placeholder="Add a description..."
              rows="6"
            >{desc}</textarea>
            <div class="card-detail-form-actions">
              <button type="submit" class="btn btn--primary">Save</button>
            </div>
          </form>

          <div class="card-detail-section">
            <h3 class="card-detail-section-title">Label</h3>
            <LabelPicker cardId={card.id} currentLabel={label} />
          </div>

          <div class="card-detail-section">
            <h3 class="card-detail-section-title">Column</h3>
            <div class="card-detail-column-picker">
              {columns.map(col => (
                <button
                  class={`card-detail-col-btn${col.id === card.columnId ? ' card-detail-col-btn--active' : ''}`}
                  data-on:click={col.id !== card.columnId ? `@post('${base()}cards/${card.id}/move-to/${col.id}')` : 'void 0'}
                  disabled={col.id === card.columnId}
                >{col.title}</button>
              ))}
            </div>
          </div>
        </div>

        <div class="card-detail-sidebar">
          <div class="card-detail-section">
            <h3 class="card-detail-section-title">Details</h3>
            <dl class="card-detail-meta">
              {created && <>
                <dt>Created</dt>
                <dd>{new Date(created.ts).toLocaleDateString()} {new Date(created.ts).toLocaleTimeString()}</dd>
              </>}
              {lastModified && lastModified !== created && <>
                <dt>Last modified</dt>
                <dd>{new Date(lastModified.ts).toLocaleDateString()} {new Date(lastModified.ts).toLocaleTimeString()}</dd>
              </>}
              <dt>Column</dt>
              <dd>{column?.title || 'Unknown'}</dd>
            </dl>
          </div>

          <div class="card-detail-section">
            <h3 class="card-detail-section-title">History</h3>
            {events.length > 0 ? (
              <ul class="card-detail-history">
                {[...events].reverse().map(e => (
                  <li class="card-detail-history-item">
                    <span class="card-detail-history-label">{eventLabel(e.type)}</span>
                    <time class="card-detail-history-time">{new Date(e.ts).toLocaleDateString()} {new Date(e.ts).toLocaleTimeString()}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="card-detail-empty">No history yet</p>
            )}
          </div>

          <div class="card-detail-section card-detail-danger">
            <button
              class="btn btn--danger"
              data-on:click={`if(confirm('Delete this card?')) { fetch('${base()}cards/${card.id}',{method:'DELETE'}).then(function(){window.location.href='${base()}boards/${board.id}'}) }`}
            >Delete card</button>
          </div>
        </div>
      </div>
      {commandMenu && (
        <CommandMenu
          query={commandMenu.query}
          results={commandMenu.results || []}
        />
      )}
    </div>
  )
}
