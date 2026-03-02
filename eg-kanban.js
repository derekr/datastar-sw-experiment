// eg-kanban.js — Kanban drag-and-drop library
// Adapted from eg-grid (github.com/derekr/eg-grid)
// Pointer-based drag with FLIP animation, auto-scroll, drop indicators.
// Designed for server-driven UI (SSE morphs) — emits events, does not own layout.

;(function () {
  'use strict'

  // ── Constants ──────────────────────────────────────────────────────────────

  var DRAG_THRESHOLD = 5
  var HYSTERESIS_PX = 20       // pixels past midpoint before changing target
  var TARGET_DEBOUNCE = 40     // ms between target changes
  var EDGE_SIZE = 60           // camera edge zone in px
  var SCROLL_SPEED = 15        // camera scroll px/frame
  var FLIP_DURATION = 200
  var FLIP_EASING = 'cubic-bezier(0.2, 0, 0, 1)'
  var MO_TIMEOUT = 500         // ms to wait for morph before cleaning up FLIP

  // ── Helpers ────────────────────────────────────────────────────────────────

  function getCardId(el) {
    return el ? el.getAttribute('data-card-id') || '' : ''
  }

  function getColumnEl(el) {
    return el ? el.closest('.column') : null
  }

  function getColumnId(colEl) {
    if (!colEl) return ''
    // id is "column-{uuid}", strip prefix
    return colEl.id ? colEl.id.replace(/^column-/, '') : ''
  }

  // Find which column the pointer X is over
  function findTargetColumn(x, columns) {
    for (var i = 0; i < columns.length; i++) {
      var rect = columns[i].getBoundingClientRect()
      if (x >= rect.left && x <= rect.right) return { el: columns[i], index: i }
    }
    // If not directly over a column, find nearest
    var best = null, bestDist = Infinity
    for (var j = 0; j < columns.length; j++) {
      var r = columns[j].getBoundingClientRect()
      var cx = r.left + r.width / 2
      var d = Math.abs(x - cx)
      if (d < bestDist) { bestDist = d; best = { el: columns[j], index: j } }
    }
    return best
  }

  // Find card drop position within a column's cards container
  function findCardPosition(y, container) {
    var cards = Array.from(container.querySelectorAll('.card:not([data-kanban-dragging])'))
    for (var i = 0; i < cards.length; i++) {
      var rect = cards[i].getBoundingClientRect()
      if (y < rect.top + rect.height / 2) return i
    }
    return cards.length
  }

  // Find column drop position among sibling columns
  function findColumnPosition(x, columnsContainer, draggedCol) {
    var cols = Array.from(columnsContainer.querySelectorAll('.column:not([data-kanban-dragging])'))
    for (var i = 0; i < cols.length; i++) {
      var rect = cols[i].getBoundingClientRect()
      if (x < rect.left + rect.width / 2) return i
    }
    return cols.length
  }

  // ── Drop Indicators ────────────────────────────────────────────────────────

  function createCardIndicator() {
    var el = document.createElement('div')
    el.className = 'drop-indicator'
    el.style.pointerEvents = 'none'
    el.setAttribute('data-card-id', 'drop-indicator')
    return el
  }

  function createColumnIndicator() {
    var el = document.createElement('div')
    el.className = 'col-drop-indicator'
    el.style.pointerEvents = 'none'
    return el
  }

  function removeIndicator(indicator) {
    if (indicator && indicator.parentNode) indicator.parentNode.removeChild(indicator)
  }

  function positionCardIndicator(indicator, container, position) {
    var cards = Array.from(container.querySelectorAll('.card:not([data-kanban-dragging])'))
    if (!indicator.parentNode || indicator.parentNode !== container) {
      container.appendChild(indicator)
    }
    if (cards[position]) {
      container.insertBefore(indicator, cards[position])
    } else {
      container.appendChild(indicator)
    }
  }

  function positionColumnIndicator(indicator, columnsContainer, position) {
    var cols = Array.from(columnsContainer.querySelectorAll('.column:not([data-kanban-dragging])'))
    if (!indicator.parentNode || indicator.parentNode !== columnsContainer) {
      columnsContainer.appendChild(indicator)
    }
    if (cols[position]) {
      columnsContainer.insertBefore(indicator, cols[position])
    } else {
      columnsContainer.appendChild(indicator)
    }
  }

  // ── FLIP Animation (MutationObserver-based, waits for SSE morph) ───────────
  //
  // Called AFTER cleanupDrag() restores the element to normal flow.
  // The element is back in its original DOM position. We watch for the
  // SSE morph to move it to the new position, then FLIP from cursorX/Y.

  function setupFlip(itemSelector, cursorX, cursorY, opts) {
    var el = document.querySelector(itemSelector)
    if (!el) return
    var suppressAll = opts && opts.suppressSiblings
    var siblingSelector = opts && opts.siblingSelector

    // Suppress VT on this element (and optionally siblings) so morph lands instantly
    el.style.viewTransitionName = 'none'
    if (suppressAll && siblingSelector) {
      document.querySelectorAll(siblingSelector).forEach(function (s) {
        s.style.viewTransitionName = 'none'
      })
    }

    // Snapshot the pre-morph position (element is back in original flow)
    var preRect = el.getBoundingClientRect()
    var done = false

    function restoreAll() {
      var sel = siblingSelector || itemSelector
      document.querySelectorAll(sel).forEach(function (s) {
        s.style.viewTransitionName = ''
      })
    }

    var mo = new MutationObserver(function () {
      if (done) return
      var target = document.querySelector(itemSelector)
      if (!target) { done = true; mo.disconnect(); restoreAll(); return }

      // Keep VT suppressed through morph (Idiomorph may restore inline styles)
      if (target.style.viewTransitionName !== 'none') target.style.viewTransitionName = 'none'
      if (suppressAll && siblingSelector) {
        document.querySelectorAll(siblingSelector).forEach(function (s) {
          if (s.style.viewTransitionName !== 'none') s.style.viewTransitionName = 'none'
        })
      }

      // Check if element moved from its pre-morph position
      var rect = target.getBoundingClientRect()
      if (Math.abs(rect.left - preRect.left) < 1 && Math.abs(rect.top - preRect.top) < 1) return

      // Element moved — FLIP from cursor position to new DOM position
      done = true
      mo.disconnect()
      var dx = cursorX - (rect.left + rect.width / 2)
      var dy = cursorY - (rect.top + rect.height / 2)
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) { restoreAll(); return }

      target.setAttribute('data-kanban-dropping', '')
      target.animate(
        [{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }],
        { duration: FLIP_DURATION, easing: FLIP_EASING }
      ).onfinish = function () {
        target.removeAttribute('data-kanban-dropping')
        restoreAll()
      }
    })

    var root = document.getElementById('app')
    if (root) mo.observe(root, { childList: true, subtree: true })
    setTimeout(function () {
      if (!done) { done = true; mo.disconnect(); restoreAll() }
    }, MO_TIMEOUT)
  }

  // ── Camera (auto-scroll) ──────────────────────────────────────────────────

  function initCamera(scrollContainer) {
    var rafId = null
    var lastX = 0, lastY = 0
    var active = false

    function scrollLoop() {
      if (!active) { rafId = null; return }
      var rect = scrollContainer.getBoundingClientRect()
      var rx = lastX - rect.left, ry = lastY - rect.top
      var vx = 0, vy = 0

      if (rx < EDGE_SIZE) vx = -SCROLL_SPEED * (1 - rx / EDGE_SIZE)
      else if (rx > rect.width - EDGE_SIZE) vx = SCROLL_SPEED * (1 - (rect.width - rx) / EDGE_SIZE)
      if (ry < EDGE_SIZE) vy = -SCROLL_SPEED * (1 - ry / EDGE_SIZE)
      else if (ry > rect.height - EDGE_SIZE) vy = SCROLL_SPEED * (1 - (rect.height - ry) / EDGE_SIZE)

      if (vx || vy) {
        scrollContainer.scrollLeft += vx
        scrollContainer.scrollTop += vy
      }
      rafId = requestAnimationFrame(scrollLoop)
    }

    return {
      start: function () { active = true },
      update: function (x, y) {
        lastX = x; lastY = y
        if (active && rafId === null) rafId = requestAnimationFrame(scrollLoop)
      },
      stop: function () {
        active = false
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
      }
    }
  }

  // ── Main init ─────────────────────────────────────────────────────────────

  window.initKanban = function (boardEl) {
    var camera = null
    var cardIndicator = null
    var colIndicator = null
    var pending = null  // { el, pointerId, startX, startY, type: 'card'|'column' }
    var drag = null     // active drag state
    var lastTarget = null  // { columnId, position } for hysteresis
    var lastTargetTime = 0

    function emit(name, detail) {
      boardEl.dispatchEvent(new CustomEvent('kanban-' + name, { bubbles: true, detail: detail }))
    }

    function getColumns() {
      return Array.from(boardEl.querySelectorAll('.column:not([data-kanban-dragging])'))
    }

    function getScrollContainer() {
      return boardEl.querySelector('.columns')
    }

    // ── Pointer handlers ──────────────────────────────────────────────────

    function startDrag(p, e) {
      var el = p.el
      var rect = el.getBoundingClientRect()

      drag = {
        el: el,
        type: p.type,
        pointerId: p.pointerId,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        origRect: rect,
        startX: e.clientX,
        startY: e.clientY
      }

      el.setAttribute('data-kanban-dragging', '')
      el.style.position = 'fixed'
      el.style.left = rect.left + 'px'
      el.style.top = rect.top + 'px'
      el.style.width = rect.width + 'px'
      el.style.height = rect.height + 'px'
      el.style.zIndex = '100'
      el.style.pointerEvents = 'none'
      document.body.style.cursor = 'grabbing'

      // Start camera
      var sc = getScrollContainer()
      if (sc) {
        camera = initCamera(sc)
        camera.start()
      }

      if (p.type === 'card') {
        cardIndicator = createCardIndicator()
        emit('card-drag-start', { cardId: getCardId(el), element: el })
      } else {
        colIndicator = createColumnIndicator()
        emit('column-drag-start', { columnId: getColumnId(el), element: el })
      }

      pending = null
    }

    function onPointerMove(e) {
      if (pending && !drag) {
        var dx = e.clientX - pending.startX
        var dy = e.clientY - pending.startY
        if (Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD) {
          startDrag(pending, e)
        } else {
          return
        }
      }
      if (!drag) return

      // Update element position
      drag.el.style.left = (e.clientX - drag.offsetX) + 'px'
      drag.el.style.top = (e.clientY - drag.offsetY) + 'px'

      // Update camera
      if (camera) camera.update(e.clientX, e.clientY)

      // Detect target
      var now = performance.now()
      if (now - lastTargetTime < TARGET_DEBOUNCE) return

      if (drag.type === 'card') {
        updateCardTarget(e.clientX, e.clientY)
      } else {
        updateColumnTarget(e.clientX)
      }
    }

    function updateCardTarget(x, y) {
      var columns = getColumns()
      var target = findTargetColumn(x, columns)
      if (!target) return

      var container = target.el.querySelector('.cards-container')
      if (!container) return

      var position = findCardPosition(y, container)
      var columnId = getColumnId(target.el)
      var key = columnId + ':' + position

      // Hysteresis: don't change if we haven't moved past the threshold
      if (lastTarget && lastTarget.key === key) return
      lastTarget = { key: key, columnId: columnId, position: position }
      lastTargetTime = performance.now()

      // Position indicator
      if (cardIndicator) {
        positionCardIndicator(cardIndicator, container, position)
      }

      emit('card-drag-move', {
        cardId: getCardId(drag.el),
        columnId: columnId,
        position: position,
        x: x, y: y
      })
    }

    function updateColumnTarget(x) {
      var sc = getScrollContainer()
      if (!sc) return

      var position = findColumnPosition(x, sc, drag.el)
      var key = 'col:' + position

      if (lastTarget && lastTarget.key === key) return
      lastTarget = { key: key, position: position }
      lastTargetTime = performance.now()

      if (colIndicator) {
        positionColumnIndicator(colIndicator, sc, position)
      }

      emit('column-drag-move', {
        columnId: getColumnId(drag.el),
        position: position,
        x: x
      })
    }

    function cleanupDrag() {
      if (!drag) return
      var el = drag.el
      el.removeAttribute('data-kanban-dragging')
      el.style.position = ''
      el.style.left = ''
      el.style.top = ''
      el.style.width = ''
      el.style.height = ''
      el.style.zIndex = ''
      el.style.pointerEvents = ''
      document.body.style.cursor = ''

      if (camera) { camera.stop(); camera = null }
      removeIndicator(cardIndicator); cardIndicator = null
      removeIndicator(colIndicator); colIndicator = null
      lastTarget = null
      lastTargetTime = 0

      el.releasePointerCapture(drag.pointerId)
      drag = null
    }

    function onPointerUp(e) {
      if (pending && !drag) {
        // Didn't cross threshold — just a click
        pending.el.releasePointerCapture(pending.pointerId)
        pending = null
        return
      }
      if (!drag) return

      var cursorX = e.clientX, cursorY = e.clientY

      if (drag.type === 'card') {
        var columns = getColumns()
        var target = findTargetColumn(cursorX, columns)
        var columnId = '', position = 0
        if (target) {
          var container = target.el.querySelector('.cards-container')
          columnId = getColumnId(target.el)
          position = container ? findCardPosition(cursorY, container) : 0
        }
        var cardId = getCardId(drag.el)

        // Clean up drag state FIRST (restore to normal flow)
        cleanupDrag()
        // THEN set up FLIP — snapshots pre-morph position, waits for morph
        setupFlip('[data-card-id="' + cardId + '"]', cursorX, cursorY, {
          suppressSiblings: false
        })
        emit('card-drag-end', { cardId: cardId, columnId: columnId, position: position })

      } else {
        var sc = getScrollContainer()
        var colPosition = sc ? findColumnPosition(cursorX, sc, null) : 0
        var draggedColumnId = getColumnId(drag.el)

        // Clean up drag state FIRST (restore to normal flow)
        cleanupDrag()
        // THEN set up FLIP — suppress VT on ALL columns AND cards so they
        // move as a unit instead of each card animating independently
        setupFlip('#column-' + draggedColumnId, cursorX, cursorY, {
          suppressSiblings: true,
          siblingSelector: '.column, .card'
        })
        emit('column-drag-end', { columnId: draggedColumnId, position: colPosition })
      }
    }

    function onPointerCancel(e) {
      if (drag) {
        var type = drag.type
        var id = type === 'card' ? getCardId(drag.el) : getColumnId(drag.el)
        cleanupDrag()
        emit(type + '-drag-cancel', type === 'card' ? { cardId: id } : { columnId: id })
      }
      if (pending) {
        pending.el.releasePointerCapture(pending.pointerId)
        pending = null
      }
    }

    function onPointerDown(e) {
      if (drag || pending) return
      if (e.button !== 0) return  // left button only

      var target = e.target
      var type = null
      var el = null

      // Column drag: grab via .drag-handle
      var handle = target.closest('.drag-handle')
      if (handle) {
        el = handle.closest('.column')
        type = 'column'
      }

      // Card drag: grab the card itself (but not buttons inside it)
      if (!type) {
        if (target.closest('button') || target.closest('input') || target.closest('a')) return
        var card = target.closest('.card')
        if (card) {
          el = card
          type = 'card'
        }
      }

      if (!el || !type) return

      e.preventDefault()
      pending = {
        el: el,
        type: type,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY
      }
      el.setPointerCapture(e.pointerId)
    }

    // ── Keyboard ──────────────────────────────────────────────────────────

    function onKeyDown(e) {
      if (e.key === 'Escape' && drag) {
        onPointerCancel(e)
      }
    }

    // ── Bind events ───────────────────────────────────────────────────────

    boardEl.addEventListener('pointerdown', onPointerDown)
    boardEl.addEventListener('pointermove', onPointerMove)
    boardEl.addEventListener('pointerup', onPointerUp)
    boardEl.addEventListener('pointercancel', onPointerCancel)
    document.addEventListener('keydown', onKeyDown)

    // Return cleanup function
    return function destroy() {
      boardEl.removeEventListener('pointerdown', onPointerDown)
      boardEl.removeEventListener('pointermove', onPointerMove)
      boardEl.removeEventListener('pointerup', onPointerUp)
      boardEl.removeEventListener('pointercancel', onPointerCancel)
      document.removeEventListener('keydown', onKeyDown)
      cleanupDrag()
    }
  }
})()
