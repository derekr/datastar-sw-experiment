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
  var REORDER_DURATION = 150   // ms for sibling reorder transitions during drag
  var REORDER_EASING = 'cubic-bezier(0.2, 0, 0, 1)'
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

  // ── Ghost Placeholders ──────────────────────────────────────────────────────
  // Reserve space where the item will land so siblings flow around it naturally.

  function createGhost(className, width, height) {
    var el = document.createElement('div')
    el.className = className
    el.style.width = width + 'px'
    el.style.height = height + 'px'
    el.style.pointerEvents = 'none'
    el.style.viewTransitionName = 'none'
    return el
  }

  function removeGhost(ghost) {
    if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost)
  }

  function positionGhost(ghost, container, position, childSelector) {
    var children = Array.from(container.querySelectorAll(childSelector))
    if (ghost.parentNode !== container) container.appendChild(ghost)
    if (children[position]) {
      container.insertBefore(ghost, children[position])
    } else {
      container.appendChild(ghost)
    }
  }

  // ── Reorder FLIP (sibling transitions during drag) ──────────────────────────
  // Snapshot children rects, run a DOM mutation, then animate any that moved.

  function animateFromMap(container, childSelector, beforeMap) {
    var after = container.querySelectorAll(childSelector)
    for (var j = 0; j < after.length; j++) {
      var el = after[j]
      var oldRect = beforeMap.get(el)
      if (!oldRect) continue

      var newRect = el.getBoundingClientRect()
      var dx = oldRect.left - newRect.left
      var dy = oldRect.top - newRect.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue

      var running = el._kanbanReorder
      if (running) running.cancel()

      el._kanbanReorder = el.animate(
        [{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }],
        { duration: REORDER_DURATION, easing: REORDER_EASING }
      )
      el._kanbanReorder.onfinish = el._kanbanReorder.oncancel = (function (e) {
        return function () { e._kanbanReorder = null }
      })(el)
    }
  }

  function flipChildren(container, childSelector, mutationFn) {
    var children = Array.from(container.querySelectorAll(childSelector))
    var before = new Map()
    for (var i = 0; i < children.length; i++) {
      before.set(children[i], children[i].getBoundingClientRect())
    }
    mutationFn()
    animateFromMap(container, childSelector, before)
  }

  // ── FLIP Animation (MutationObserver-based, waits for SSE morph) ───────────
  //
  // Called AFTER softCleanup() — the element is still position:fixed at the
  // cursor, marked with data-kanban-hold. When Idiomorph processes the SSE
  // morph, it resets all inline styles (they're not in the server HTML) and
  // removes data-kanban-hold. The MO detects the attribute removal, then
  // FLIP-animates from firstRect (cursor position) to new flow position.
  // Zero snap-back.

  function setupFlip(itemSelector, firstRect, opts) {
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

    var done = false

    function restoreAll() {
      var sel = siblingSelector || itemSelector
      document.querySelectorAll(sel).forEach(function (s) {
        s.style.viewTransitionName = ''
      })
      // Re-enable view-transition-name on all items (CSS !important lifts)
      var board = document.getElementById('board')
      if (board) board.removeAttribute('data-kanban-active')
    }

    // Force-clean all drag inline styles from the element (in case Idiomorph
    // doesn't fully reset them, e.g. if it matches by id but keeps attributes).
    function forceCleanEl(target) {
      target.removeAttribute('data-kanban-dragging')
      target.removeAttribute('data-kanban-hold')
      target.style.position = ''
      target.style.left = ''
      target.style.top = ''
      target.style.width = ''
      target.style.height = ''
      target.style.zIndex = ''
      target.style.pointerEvents = ''
    }

    var mo = new MutationObserver(function (mutations) {
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

      // Detect morph: check if data-kanban-hold was removed by Idiomorph,
      // OR if the element no longer has position:fixed (Idiomorph reset styles)
      var holdRemoved = !target.hasAttribute('data-kanban-hold')
      var positionReset = target.style.position !== 'fixed'
      if (!holdRemoved && !positionReset) return

      // Morph landed — set dropping FIRST (for z-index), then clean drag styles
      done = true
      mo.disconnect()
      target.setAttribute('data-kanban-dropping', '')
      forceCleanEl(target)

      // FLIP from firstRect (where cursor was) to new DOM position
      var rect = target.getBoundingClientRect()
      var dx = (firstRect.left + firstRect.width / 2) - (rect.left + rect.width / 2)
      var dy = (firstRect.top + firstRect.height / 2) - (rect.top + rect.height / 2)
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) { target.removeAttribute('data-kanban-dropping'); restoreAll(); return }

      target.animate(
        [{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }],
        { duration: FLIP_DURATION, easing: FLIP_EASING }
      ).onfinish = function () {
        target.removeAttribute('data-kanban-dropping')
        restoreAll()
      }
    })

    var root = document.getElementById('app')
    if (root) mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-kanban-hold', 'style'] })

    // Safety timeout: if morph never arrives, force cleanup
    setTimeout(function () {
      if (!done) {
        done = true
        mo.disconnect()
        var target = document.querySelector(itemSelector)
        if (target) forceCleanEl(target)
        // Remove any orphaned ghost placeholders
        document.querySelectorAll('.card-ghost, .column-ghost').forEach(function (g) {
          g.parentNode.removeChild(g)
        })
        restoreAll()
      }
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

      // Determine container and create ghost BEFORE going position:fixed,
      // so flipChildren can snapshot siblings in their current positions.
      var ghostContainer, childSel, ghost
      if (p.type === 'card') {
        ghostContainer = el.closest('.cards-container')
        childSel = '.card:not([data-kanban-dragging]), .card-ghost'
        ghost = createGhost('card-ghost', rect.width, rect.height)
        cardIndicator = ghost
      } else {
        ghostContainer = getScrollContainer()
        childSel = '.column:not([data-kanban-dragging]), .column-ghost'
        ghost = createGhost('column-ghost', rect.width, rect.height)
        colIndicator = ghost
      }

      // Pull element out of flow + insert ghost in one batched mutation,
      // wrapped in FLIP so siblings animate smoothly.
      var nextSib = el.nextElementSibling
      if (ghostContainer) {
        flipChildren(ghostContainer, childSel, function () {
          el.setAttribute('data-kanban-dragging', '')
          el.style.position = 'fixed'
          el.style.left = rect.left + 'px'
          el.style.top = rect.top + 'px'
          el.style.width = rect.width + 'px'
          el.style.height = rect.height + 'px'
          el.style.zIndex = '100'
          el.style.pointerEvents = 'none'
          ghostContainer.insertBefore(ghost, nextSib)
        })
      } else {
        el.setAttribute('data-kanban-dragging', '')
        el.style.position = 'fixed'
        el.style.left = rect.left + 'px'
        el.style.top = rect.top + 'px'
        el.style.width = rect.width + 'px'
        el.style.height = rect.height + 'px'
        el.style.zIndex = '100'
        el.style.pointerEvents = 'none'
      }
      document.body.style.cursor = 'grabbing'
      // Suppress view-transition-name on all items so no stacking contexts
      // trap the position:fixed dragged element behind siblings.
      boardEl.setAttribute('data-kanban-active', '')

      // Start camera
      var sc = getScrollContainer()
      if (sc) {
        camera = initCamera(sc)
        camera.start()
      }

      if (p.type === 'card') {
        emit('card-drag-start', { cardId: getCardId(el), element: el })
      } else {
        emit('column-drag-start', { columnId: getColumnId(el), element: el })
      }

      pending = null
    }

    function onPointerMove(e) {
      if (pending && !drag) {
        // touch taps are tap-only, not drag — if finger moves too far, cancel
        if (pending.type === 'touch-card' || pending.type === 'touch-column') {
          var tdx = e.clientX - pending.startX
          var tdy = e.clientY - pending.startY
          if (Math.sqrt(tdx * tdx + tdy * tdy) >= 10) {
            pending = null  // scrolling — cancel tap detection
          }
          return
        }
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

      // Position ghost placeholder with sibling FLIP.
      // If the ghost is moving between columns, FLIP both containers.
      if (cardIndicator) {
        var oldContainer = cardIndicator.parentNode
        if (oldContainer && oldContainer !== container) {
          // Cross-column move: snapshot both, mutate, animate both
          var srcChildren = Array.from(oldContainer.querySelectorAll('.card:not([data-kanban-dragging]), .card-ghost'))
          var dstChildren = Array.from(container.querySelectorAll('.card:not([data-kanban-dragging]), .card-ghost'))
          var beforeMap = new Map()
          srcChildren.forEach(function (c) { beforeMap.set(c, c.getBoundingClientRect()) })
          dstChildren.forEach(function (c) { beforeMap.set(c, c.getBoundingClientRect()) })
          positionGhost(cardIndicator, container, position, '.card:not([data-kanban-dragging])')

          // Animate source container children
          animateFromMap(oldContainer, '.card:not([data-kanban-dragging]), .card-ghost', beforeMap)
          // Animate destination container children
          animateFromMap(container, '.card:not([data-kanban-dragging]), .card-ghost', beforeMap)
        } else {
          flipChildren(container, '.card:not([data-kanban-dragging]), .card-ghost', function () {
            positionGhost(cardIndicator, container, position, '.card:not([data-kanban-dragging])')
          })
        }
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
        flipChildren(sc, '.column:not([data-kanban-dragging]), .column-ghost', function () {
          positionGhost(colIndicator, sc, position, '.column:not([data-kanban-dragging])')
        })
      }

      emit('column-drag-move', {
        columnId: getColumnId(drag.el),
        position: position,
        x: x
      })
    }

    // Full cleanup — used on cancel or when no FLIP needed
    function cleanupDrag() {
      if (!drag) return
      var el = drag.el
      el.removeAttribute('data-kanban-dragging')
      el.removeAttribute('data-kanban-hold')
      el.style.position = ''
      el.style.left = ''
      el.style.top = ''
      el.style.width = ''
      el.style.height = ''
      el.style.zIndex = ''
      el.style.pointerEvents = ''
      document.body.style.cursor = ''
      boardEl.removeAttribute('data-kanban-active')

      if (camera) { camera.stop(); camera = null }
      removeGhost(cardIndicator); cardIndicator = null
      removeGhost(colIndicator); colIndicator = null
      lastTarget = null
      lastTargetTime = 0

      el.releasePointerCapture(drag.pointerId)
      drag = null
    }

    // Partial cleanup — release pointer/camera but keep element at cursor
    // for seamless handoff to Idiomorph. Element stays position:fixed until
    // the SSE morph lands and Idiomorph resets the inline styles.
    function softCleanup() {
      if (!drag) return
      document.body.style.cursor = ''
      if (camera) { camera.stop(); camera = null }
      // Ghost stays — Idiomorph removes it (not in server HTML)
      lastTarget = null
      lastTargetTime = 0
      drag.el.releasePointerCapture(drag.pointerId)
      // Mark element as "holding at cursor, waiting for morph"
      drag.el.setAttribute('data-kanban-hold', '')
      drag = null
    }

    function onPointerUp(e) {
      // Touch taps: if the finger didn't move much, emit event for action sheet
      if (pending && (pending.type === 'touch-card' || pending.type === 'touch-column')) {
        var dx = e.clientX - pending.startX
        var dy = e.clientY - pending.startY
        var elapsed = performance.now() - pending.startTime
        // Treat as tap if < 10px movement and < 500ms
        if (Math.sqrt(dx * dx + dy * dy) < 10 && elapsed < 500) {
          if (pending.type === 'touch-card') {
            var cardId = getCardId(pending.el)
            if (cardId) emit('card-tap', { cardId: cardId })
          } else {
            var columnId = getColumnId(pending.el)
            if (columnId) emit('column-tap', { columnId: columnId })
          }
        }
        pending = null
        return
      }

      if (pending && !drag) {
        // Didn't cross threshold — just a click
        pending.el.releasePointerCapture(pending.pointerId)
        pending = null
        return
      }
      if (!drag) return

      var cursorX = e.clientX, cursorY = e.clientY

      // Capture firstRect WHILE element is still position:fixed at cursor.
      // This is the "from" rect for the FLIP animation — no snap-back.
      var firstRect = drag.el.getBoundingClientRect()

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

        // Soft cleanup: release pointer/camera but keep element position:fixed
        // at cursor. data-kanban-hold marks it as "waiting for morph".
        softCleanup()
        // Set up FLIP — watches for Idiomorph to process the morph (removing
        // data-kanban-hold and resetting inline styles), then animates from
        // firstRect to new flow position.
        setupFlip('[data-card-id="' + cardId + '"]', firstRect, {
          suppressSiblings: false
        })
        emit('card-drag-end', { cardId: cardId, columnId: columnId, position: position })

      } else {
        var sc = getScrollContainer()
        var colPosition = sc ? findColumnPosition(cursorX, sc, null) : 0
        var draggedColumnId = getColumnId(drag.el)

        // Soft cleanup: keep element at cursor position
        softCleanup()
        // FLIP — suppress VT on ALL columns AND cards so they move as a
        // unit instead of each card animating independently
        setupFlip('#column-' + draggedColumnId, firstRect, {
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
        // touch pending doesn't capture, so only release for real drag pending
        if (pending.type !== 'touch-card' && pending.type !== 'touch-column') {
          pending.el.releasePointerCapture(pending.pointerId)
        }
        pending = null
      }
    }

    function onPointerDown(e) {
      if (drag || pending) return
      if (e.button !== 0) return  // left button only

      var target = e.target
      var type = null
      var el = null

      // Card drag: grab the card itself (but not buttons/inputs inside it)
      if (target.closest('button') || target.closest('input') || target.closest('a') || target.closest('textarea') || target.closest('form')) return
      var card = target.closest('.card')
      if (card) {
        // data-kanban-no-drag: card is in selection mode — let click through
        if (card.hasAttribute('data-kanban-no-drag')) return
        el = card
        type = 'card'
      }

      // Column drag: grab via .column-header (but not if we matched a card)
      if (!type) {
        var header = target.closest('.column-header')
        if (header) {
          el = header.closest('.column')
          type = 'column'
        }
      }

      if (!el || !type) return

      // Touch devices: skip drag entirely. Tap on card/column → action sheet.
      // Let native scroll handle swipe.
      if (e.pointerType === 'touch') {
        if (type === 'card' || type === 'column') {
          // Record touch start for tap detection (onPointerUp handles it)
          pending = {
            el: el,
            type: type === 'card' ? 'touch-card' : 'touch-column',
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            startTime: performance.now()
          }
          // Don't capture or preventDefault — allow native scroll
        }
        return
      }

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

    // Map vim keys to arrow directions
    var VIM_MAP = { h: 'Left', j: 'Down', k: 'Up', l: 'Right' }

    function directionFor(key) {
      if (key.startsWith('Arrow')) return key.slice(5) // ArrowUp → Up
      return VIM_MAP[key] || null
    }

    function getAllCards() {
      return Array.from(boardEl.querySelectorAll('.card'))
    }

    function getColumnHeaders() {
      return Array.from(boardEl.querySelectorAll('.column-header'))
    }

    function getCardsInColumn(colEl) {
      var container = colEl.querySelector('.cards-container')
      return container ? Array.from(container.querySelectorAll('.card')) : []
    }

    function focusCard(card) {
      if (card) card.focus({ preventScroll: false })
    }

    function navigateFromCard(card, dir) {
      var colEl = getColumnEl(card)
      if (!colEl) return
      var cards = getCardsInColumn(colEl)
      var idx = cards.indexOf(card)
      var columns = getColumns()
      var colIdx = columns.indexOf(colEl)

      if (dir === 'Up' || dir === 'Down') {
        var next = dir === 'Down' ? idx + 1 : idx - 1
        if (next >= 0 && next < cards.length) {
          focusCard(cards[next])
        } else if (dir === 'Down' && colIdx < columns.length - 1) {
          // Wrap to first card of next column
          var nextCards = getCardsInColumn(columns[colIdx + 1])
          if (nextCards.length) focusCard(nextCards[0])
        } else if (dir === 'Up' && colIdx > 0) {
          // Wrap to last card of previous column
          var prevCards = getCardsInColumn(columns[colIdx - 1])
          if (prevCards.length) focusCard(prevCards[prevCards.length - 1])
        } else if (dir === 'Up') {
          // At top of first column — focus the column header
          var header = colEl.querySelector('.column-header')
          if (header) header.focus()
        }
      } else {
        // Left/Right: jump to same-index card in adjacent column
        var adj = dir === 'Right' ? colIdx + 1 : colIdx - 1
        if (adj >= 0 && adj < columns.length) {
          var adjCards = getCardsInColumn(columns[adj])
          var target = Math.min(idx, adjCards.length - 1)
          if (adjCards.length) {
            focusCard(adjCards[target])
          } else {
            // Empty column — focus its header
            var h = columns[adj].querySelector('.column-header')
            if (h) h.focus()
          }
        }
      }
    }

    function navigateFromHeader(header, dir) {
      var colEl = header.closest('.column')
      var columns = getColumns()
      var colIdx = columns.indexOf(colEl)

      if (dir === 'Left' || dir === 'Right') {
        var adj = dir === 'Right' ? colIdx + 1 : colIdx - 1
        if (adj >= 0 && adj < columns.length) {
          var h = columns[adj].querySelector('.column-header')
          if (h) h.focus()
        }
      } else if (dir === 'Down') {
        // Focus first card in this column
        var cards = getCardsInColumn(colEl)
        if (cards.length) focusCard(cards[0])
      }
    }

    function moveCard(card, dir) {
      var colEl = getColumnEl(card)
      if (!colEl) return
      var container = colEl.querySelector('.cards-container')
      if (!container) return
      var cards = getCardsInColumn(colEl)
      var idx = cards.indexOf(card)
      var columns = getColumns()
      var colIdx = columns.indexOf(colEl)

      if (dir === 'Up' || dir === 'Down') {
        // Move within column
        var newIdx = dir === 'Down' ? idx + 1 : idx - 1
        if (newIdx < 0 || newIdx >= cards.length) return
        emit('card-drag-end', {
          cardId: getCardId(card),
          columnId: getColumnId(colEl),
          position: newIdx
        })
      } else {
        // Move to adjacent column
        var adj = dir === 'Right' ? colIdx + 1 : colIdx - 1
        if (adj < 0 || adj >= columns.length) return
        var adjCards = getCardsInColumn(columns[adj])
        // Insert at same index or end
        var pos = Math.min(idx, adjCards.length)
        emit('card-drag-end', {
          cardId: getCardId(card),
          columnId: getColumnId(columns[adj]),
          position: pos
        })
      }
    }

    function moveColumn(header, dir) {
      if (dir !== 'Left' && dir !== 'Right') return
      var colEl = header.closest('.column')
      var columns = getColumns()
      var colIdx = columns.indexOf(colEl)
      var newIdx = dir === 'Right' ? colIdx + 1 : colIdx - 1
      if (newIdx < 0 || newIdx >= columns.length) return
      emit('column-drag-end', {
        columnId: getColumnId(colEl),
        position: newIdx
      })
    }

    function isSelectionMode() {
      return !!boardEl.querySelector('.selection-bar')
    }

    // In selection mode, auto-focus the first card if nothing is focused
    function ensureCardFocus() {
      var focused = document.activeElement
      if (focused && boardEl.contains(focused) &&
          (focused.classList.contains('card') || focused.classList.contains('column-header'))) {
        return // already focused on a navigable element
      }
      var first = boardEl.querySelector('.card')
      if (first) focusCard(first)
    }

    function onKeyDown(e) {
      if (e.key === 'Escape' && drag) {
        onPointerCancel(e)
        return
      }

      var selecting = isSelectionMode()

      // Space/Enter on a focused card in selection mode → toggle selection
      if (selecting && (e.key === ' ' || e.key === 'Enter')) {
        var focused = document.activeElement
        if (focused && boardEl.contains(focused) && focused.classList.contains('card')) {
          e.preventDefault()
          focused.click() // triggers Datastar's data-on:click → toggle-select
          return
        }
      }

      var dir = directionFor(e.key)
      if (!dir) return

      // In selection mode, arrow keys should work even if nothing is focused yet
      if (selecting) {
        var focused = document.activeElement
        var hasFocusInBoard = focused && boardEl.contains(focused) &&
          (focused.classList.contains('card') || focused.classList.contains('column-header'))

        if (!hasFocusInBoard) {
          e.preventDefault()
          ensureCardFocus()
          return
        }

        // No Ctrl+arrow moves in selection mode
        var isCard = focused.classList.contains('card')
        var isHeader = focused.classList.contains('column-header')
        e.preventDefault()
        if (isCard) navigateFromCard(focused, dir)
        else if (isHeader) navigateFromHeader(focused, dir)
        return
      }

      var focused = document.activeElement
      if (!focused || !boardEl.contains(focused)) return

      var isCard = focused.classList.contains('card')
      var isHeader = focused.classList.contains('column-header')
      if (!isCard && !isHeader) return

      // Ctrl/Meta = move the item, plain = navigate focus
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        if (isCard) moveCard(focused, dir)
        else if (isHeader) moveColumn(focused, dir)
      } else {
        // Don't hijack vim keys when typing in an input
        if (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA') return
        e.preventDefault()
        if (isCard) navigateFromCard(focused, dir)
        else if (isHeader) navigateFromHeader(focused, dir)
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
