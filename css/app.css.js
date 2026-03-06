export const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* Lucide icons via CSS mask-image (generated at build time by @iconify/utils) */
${__LUCIDE_ICON_CSS__}
.icon--lucide { vertical-align: -0.125em; }

/* Remove 300ms tap delay on all interactive elements */
a, button, input, textarea, select, [data-on\\:click], [tabindex] {
  touch-action: manipulation;
}

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background: var(--neutral-1);
  color: var(--neutral-11);
  min-height: 100dvh;
  -webkit-text-size-adjust: 100%;
  overscroll-behavior: none;
  /* Safe area insets for notched devices (landscape) */
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
}

/* ── Shared icon-only button ─────────────────────────── */
.icon-btn {
  background: none; border: none; color: var(--neutral-6); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 6px; border-radius: 4px; line-height: 1;
  font-size: var(--font-size--1);
  transition: color var(--anim-duration-fast), background var(--anim-duration-fast);
}
.icon-btn:hover { background: var(--neutral-5); color: var(--neutral-11); }
.icon-btn--danger:hover { color: var(--error-7); }

/* ── Boards list ─────────────────────────────────────── */

#boards-list {
  padding: clamp(12px, 4vw, 24px);
  max-width: 800px;
  margin: 0 auto;
}
#boards-list h1 {
  font-size: var(--font-size-2);
  font-weight: var(--font-weight-semi-bold);
  margin-bottom: clamp(16px, 3vw, 24px);
}

.boards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(200px, 100%), 1fr));
  gap: clamp(10px, 2vw, 16px);
}

.board-card {
  background: var(--neutral-3);
  border: 1px solid var(--neutral-5);
  border-radius: var(--border-radius-2);
  position: relative;
  transition: border-color var(--anim-duration-fast);
}
.board-card:hover { border-color: var(--primary-7); }
.board-card-link {
  display: block;
  padding: clamp(14px, 3vw, 20px);
  text-decoration: none;
  color: inherit;
  cursor: pointer;
}
.board-card h2 { font-size: var(--font-size-0); font-weight: var(--font-weight-semi-bold); margin-bottom: 8px; }
.board-meta { font-size: var(--font-size--2); color: var(--neutral-7); display: flex; gap: 6px; flex-wrap: wrap; }

.board-delete-btn {
  position: absolute;
  top: 8px;
  right: 8px;
}

.board-new {
  background: transparent;
  border: var(--border-width-1) dashed var(--neutral-5);
  border-radius: var(--border-radius-2);
  padding: clamp(14px, 3vw, 20px);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* 16px min on all inputs/textareas prevents iOS Safari auto-zoom on focus.
   Doubled selector for specificity to beat .class input rules. */
input:not(#_), textarea:not(#_), select:not(#_) { font-size: max(1rem, 16px); }

.board-new input {
  background: var(--neutral-1);
  border: 1px solid var(--neutral-5);
  border-radius: var(--border-radius-0);
  padding: 10px;
  color: var(--neutral-11);
  font-size: var(--font-size--1);
}
.board-new input::placeholder { color: var(--neutral-6); }
.board-new input:focus { outline: none; border-color: var(--primary-7); }
.board-new button {
  background: var(--primary-7);
  border: none;
  border-radius: var(--border-radius-0);
  color: #fff;
  padding: 10px 14px;
  cursor: pointer;
  font-size: var(--font-size--1);
  font-weight: var(--font-weight-semi-bold);
}
.board-new button:hover { background: var(--primary-6); }

.boards-toolbar {
  margin-top: clamp(16px, 3vw, 24px);
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}
.toolbar-btn {
  background: var(--neutral-3);
  color: var(--neutral-8);
  border: 1px solid var(--neutral-5);
  border-radius: var(--border-radius-0);
  padding: 8px 16px;
  font-size: var(--font-size--1);
  cursor: pointer;
  text-decoration: none;
  transition: background var(--anim-duration-fast), color var(--anim-duration-fast);
}
.toolbar-btn:hover { background: var(--neutral-5); color: var(--neutral-11); }

/* ── Templates ───────────────────────────────────────── */

#templates-section {
  margin-top: clamp(24px, 4vw, 40px);
}
.templates-heading {
  font-size: var(--font-size--1);
  font-weight: var(--font-weight-medium);
  color: var(--neutral-7);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: clamp(10px, 2vw, 16px);
}
.templates-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(160px, 100%), 1fr));
  gap: clamp(8px, 1.5vw, 12px);
}
.template-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: clamp(14px, 3vw, 20px) clamp(10px, 2vw, 14px);
  background: var(--neutral-3);
  border: 1px solid var(--neutral-5);
  border-radius: var(--border-radius-2);
  text-decoration: none;
  color: inherit;
  cursor: pointer;
  transition: border-color var(--anim-duration-fast), background var(--anim-duration-fast);
  text-align: center;
}
.template-card:hover {
  border-color: var(--primary-7);
  background: var(--neutral-3);
}
.template-card:active {
  background: var(--neutral-5);
}
.template-card-icon {
  font-size: var(--font-size-2);
  line-height: 1;
}
.template-card-title {
  font-size: var(--font-size--1);
  font-weight: var(--font-weight-semi-bold);
  color: var(--neutral-11);
}
.template-card-desc {
  font-size: var(--font-size--2);
  color: var(--neutral-7);
  line-height: 1.3;
}

/* ── Board detail ───────────────────────────────────── */

.board-header {
  display: flex;
  align-items: center;
  gap: clamp(8px, 2vw, 16px);
  margin-bottom: clamp(12px, 3vw, 24px);
  flex-wrap: wrap;
}
.board-back-title {
  font-size: var(--font-size-1);
  font-weight: var(--font-weight-semi-bold);
  color: var(--neutral-11);
}
.board-back-title:hover { color: var(--primary-7); text-decoration: none; }
.board-title-edit-btn { font-size: var(--font-size--2); padding: 4px; }
.board-title-edit-btn:hover { color: var(--primary-7); }
.board-title-form {
  display: flex;
  align-items: center;
  gap: 8px;
}
.board-title-form input {
  font-size: var(--font-size-2);
  font-weight: var(--font-weight-semi-bold);
  background: var(--neutral-3);
  border: 1px solid var(--neutral-6);
  border-radius: var(--border-radius-0);
  color: var(--neutral-11);
  padding: 2px 8px;
  min-width: 0;
  width: 20ch;
}
.board-title-save, .board-title-cancel {
  background: var(--neutral-5);
  color: var(--neutral-11);
  border: 1px solid var(--neutral-6);
  border-radius: var(--border-radius-0);
  padding: 4px 12px;
  font-size: var(--font-size--1);
  cursor: pointer;
}
.board-title-save:hover { background: var(--primary-7); border-color: var(--primary-7); }
.board-title-cancel:hover { background: var(--neutral-6); }
.back-link {
  color: var(--primary-7);
  text-decoration: none;
  font-size: var(--font-size--1);
  white-space: nowrap;
}
.back-link:hover { text-decoration: underline; }

#board { padding: clamp(8px, 2vw, 24px); }

.columns {
  display: flex;
  gap: clamp(10px, 2vw, 16px);
  overflow-x: auto;
  /* Let columns scroll edge-to-edge; padding on scroll container
     so first/last column aren't flush against the viewport edge. */
  padding: 0 clamp(8px, 2vw, 24px) 16px;
  align-items: flex-start;
  /* Momentum scrolling on iOS */
  -webkit-overflow-scrolling: touch;
  /* Prevent horizontal overscroll from triggering back-navigation */
  overscroll-behavior-x: contain;
  /* Snap columns into view on swipe */
  scroll-snap-type: x mandatory;
  scroll-padding: 0 clamp(8px, 2vw, 24px);
}

.column {
  background: var(--neutral-3);
  border-radius: var(--border-radius-2);
  padding: clamp(10px, 2vw, 16px);
  /* Fluid column width: 85vw on phones, capped at 300px on wider screens */
  width: clamp(260px, 75vw, 300px);
  min-width: clamp(260px, 75vw, 300px);
  max-width: 300px;
  flex-shrink: 0;
  user-select: none;
  scroll-snap-align: center;
}

.column[data-kanban-dragging],
.column[data-kanban-hold] { opacity: 0.5; z-index: 100; }
.column[data-kanban-dropping] { position: relative; z-index: 50; box-shadow: var(--shadow-4); }

.column-ghost {
  border: var(--border-width-1) dashed var(--primary-7);
  border-radius: var(--border-radius-2);
  background: color-mix(in oklch, var(--primary-7) 5%, transparent);
  flex-shrink: 0;
  box-sizing: border-box;
}

.column input, .column textarea { user-select: text; }

.column-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: var(--size--2);
  cursor: grab;
  -webkit-touch-callout: none;
}

.column-header:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--primary-7); border-radius: var(--border-radius-0); }

.column-header h2 {
  font-size: var(--font-size--2);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--neutral-8);
  font-weight: var(--font-weight-semi-bold);
  flex: 1;
}

/* col-delete-btn: positioning only — base styles from .icon-btn */

.count {
  font-size: var(--font-size--2);
  background: var(--neutral-5);
  color: var(--neutral-8);
  padding: 2px 8px;
  border-radius: var(--border-radius-1);
}

.cards-container {
  min-height: 48px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: var(--border-radius-0);
  padding: 4px;
  transition: background var(--anim-duration-fast), box-shadow var(--anim-duration-fast);
}

.empty {
  color: var(--neutral-6);
  font-size: var(--font-size--1);
  text-align: center;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: var(--border-radius-0);
}

/* Hide "No cards yet" when a drag ghost is in the same container */
.cards-container:has(.card-ghost) .empty { display: none; }

.card {
  background: var(--neutral-1);
  border: 1px solid var(--neutral-5);
  border-radius: var(--border-radius-0);
  padding: 10px 12px;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  cursor: grab;
  transition: border-color var(--anim-duration-fast);
  user-select: none;
  -webkit-touch-callout: none;
}

.card:hover { border-color: var(--neutral-6); }
.card:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--primary-7); }
.card[data-kanban-dragging],
.card[data-kanban-hold] { opacity: 0.5; z-index: 100; }
.card[data-kanban-dropping] { position: relative; z-index: 50; box-shadow: var(--shadow-4); }

.card--labeled { padding-top: 8px; }

.card-content { flex: 1; min-width: 0; }
.card-title { font-size: var(--font-size--1); word-break: break-word; }
.card-desc { font-size: var(--font-size--2); color: var(--neutral-8); margin: 4px 0 0; word-break: break-word; }
.card-actions { display: flex; align-items: center; gap: 0; flex-shrink: 0; margin-left: 4px; }

.card-edit-btn .icon--lucide { font-size: 0.85em; }
.card-edit-btn:hover { color: var(--primary-7); }

.card-edit-form {
  width: 100%; margin-top: 8px; display: flex; flex-direction: column; gap: var(--size-0);
}
.card-edit-inputs {
  display: flex; flex-direction: column; gap: 6px;
}
.card-edit-form input,
.card-edit-form textarea {
  background: var(--neutral-3); color: var(--neutral-11); border: 1px solid var(--neutral-5); border-radius: var(--border-radius-0);
  padding: 8px 10px; font-size: var(--font-size--1); font-family: inherit; resize: vertical;
}
.card-edit-form input:focus,
.card-edit-form textarea:focus { outline: none; border-color: var(--primary-7); }
.card-edit-actions { display: flex; gap: 6px; }
.card-edit-actions button {
  padding: 8px 14px; border-radius: var(--border-radius-0); border: 1px solid var(--neutral-5); cursor: pointer;
  font-size: var(--font-size--2); transition: background var(--anim-duration-fast);
}
.card-edit-actions button[type="submit"] { background: var(--primary-7); color: #fff; border-color: var(--primary-7); }
.card-edit-actions button[type="submit"]:hover { background: var(--primary-6); }
.card-edit-actions button[type="button"] { background: var(--neutral-3); color: var(--neutral-8); }
.card-edit-actions button[type="button"]:hover { background: var(--neutral-5); }

/* ── Label picker + swatches ─────────────────────── */

.label-picker {
  display: flex;
  align-items: center;
  gap: 8px;
}
.label-picker-label {
  font-size: var(--font-size--2);
  color: var(--neutral-8);
  white-space: nowrap;
}
.label-picker-swatches,
.action-sheet-swatches {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.label-swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid transparent;
  background: var(--swatch-color);
  cursor: pointer;
  padding: 0;
  transition: border-color var(--anim-duration-fast), transform var(--anim-duration-fast);
}
.label-swatch:hover { transform: scale(1.2); }
.label-swatch--active {
  border-color: #fff;
  box-shadow: 0 0 0 2px var(--swatch-color);
}
.label-swatch--lg {
  width: 28px;
  height: 28px;
}
.label-swatch-clear {
  background: none;
  border: 1px solid var(--neutral-6);
  border-radius: 50%;
  width: 20px;
  height: 20px;
  color: var(--neutral-8);
  cursor: pointer;
  padding: 0;
  font-size: var(--font-size--2);
  display: grid;
  place-items: center;
  transition: color var(--anim-duration-fast);
}
.label-swatch-clear:hover { color: var(--error-8); }

.card-ghost {
  border: var(--border-width-1) dashed var(--primary-7);
  border-radius: var(--border-radius-0);
  background: color-mix(in oklch, var(--primary-7) 8%, transparent);
  flex-shrink: 0;
  box-sizing: border-box;
}

/* During pointer drag, suppress ALL VTNs — drag itself provides visual feedback */
#board[data-kanban-active] .column,
#board[data-kanban-active] .card { view-transition-name: none !important; }

/* Suppress text selection on everything during drag */
#board[data-kanban-active] { user-select: none; -webkit-user-select: none; }

/* Disable scroll snap during drag — lets auto-scroll work smoothly */
#board[data-kanban-active] .columns { scroll-snap-type: none; }

/* Pointer drag needs touch-action: none to prevent browser scroll stealing
   the pointer. Only set for fine pointer (mouse/trackpad) — touch devices
   use native scroll + tap-for-action-sheet instead of drag. */
@media (pointer: fine) {
  .card, .column { touch-action: none; }
}

.delete-btn { flex-shrink: 0; }

.add-form {
  display: flex;
  gap: 8px;
  margin-top: var(--size--2);
}

.add-form input {
  flex: 1;
  min-width: 0;
  background: var(--neutral-1);
  border: 1px solid var(--neutral-5);
  border-radius: var(--border-radius-0);
  padding: 10px;
  color: var(--neutral-11);
  font-size: var(--font-size--1);
}

.add-form input::placeholder { color: var(--neutral-6); }
.add-form input:focus { outline: none; border-color: var(--primary-7); }

.add-form button {
  background: var(--primary-7);
  border: none;
  border-radius: var(--border-radius-0);
  color: #fff;
  padding: 10px 14px;
  cursor: pointer;
  font-size: var(--font-size-0);
  font-weight: var(--font-weight-semi-bold);
  transition: background var(--anim-duration-fast);
}

.add-form button:hover { background: var(--primary-6); }

.add-col-form {
  display: flex;
  gap: 8px;
  margin-top: var(--size-0);
  padding: 0 clamp(8px, 2vw, 24px);
  flex-wrap: wrap;
}

.add-col-form input {
  background: var(--neutral-3);
  border: 1px solid var(--neutral-5);
  border-radius: var(--border-radius-0);
  padding: 10px 14px;
  color: var(--neutral-11);
  font-size: var(--font-size--1);
  flex: 1;
  min-width: 0;
}

.add-col-form input::placeholder { color: var(--neutral-6); }
.add-col-form input:focus { outline: none; border-color: var(--primary-7); }

.add-col-form button {
  background: var(--neutral-5);
  border: 1px solid var(--neutral-6);
  border-radius: var(--border-radius-0);
  color: var(--neutral-11);
  padding: 10px 16px;
  cursor: pointer;
  font-size: var(--font-size--1);
  font-weight: var(--font-weight-semi-bold);
  white-space: nowrap;
  transition: background var(--anim-duration-fast);
}

.add-col-form button:hover { background: var(--neutral-6); }

/* ── Select mode button ───────────────────────────── */

.tab-count {
  font-size: var(--font-size--2);
  color: var(--primary-7);
  background: color-mix(in oklch, var(--primary-7) 15%, transparent);
  padding: 2px 8px;
  border-radius: var(--border-radius-1);
  white-space: nowrap;
}
.tab-count--hidden { display: none; }

/* ── Status chip (offline / local / synced) ──────── */

.status-chip {
  font-size: var(--font-size--2);
  padding: 2px 8px;
  border-radius: var(--border-radius-1);
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.status-chip::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}
.status-chip--offline {
  color: var(--error-8);
  background: color-mix(in oklch, var(--error-8) 15%, transparent);
}
.status-chip--offline::before { background: var(--error-8); }
.status-chip--local {
  color: var(--neutral-8);
  background: color-mix(in oklch, var(--neutral-8) 15%, transparent);
}
.status-chip--local::before { background: var(--neutral-8); }
.status-chip--pending {
  color: var(--secondary-8);
  background: color-mix(in oklch, var(--secondary-8) 15%, transparent);
}
.status-chip--pending::before { background: var(--secondary-8); }
.status-chip--synced {
  color: var(--secondary-7);
  background: color-mix(in oklch, var(--secondary-7) 15%, transparent);
}
.status-chip--synced::before { background: var(--secondary-7); }

.select-mode-btn {
  background: var(--neutral-5);
  border: 1px solid var(--neutral-6);
  border-radius: var(--border-radius-0);
  color: var(--neutral-8);
  padding: 4px 10px;
  font-size: var(--font-size--2);
  cursor: pointer;
  transition: background var(--anim-duration-fast), color var(--anim-duration-fast);
  white-space: nowrap;
}
.select-mode-btn:hover { background: var(--neutral-6); color: var(--neutral-11); }

/* ── Card selection checkbox ─────────────────────── */

.card-select-checkbox {
  background: none;
  border: none;
  font-size: var(--font-size-1);
  color: var(--neutral-7);
  cursor: pointer;
  padding: 4px;
  min-width: 44px;
  min-height: 44px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  line-height: 1;
}
.card--selected { border-color: var(--primary-7); background: var(--primary-4); }
.card--selected .card-select-checkbox { color: var(--primary-8); }

/* ── Help overlay ────────────────────────────────── */

.help-overlay-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: grid;
  place-items: center;
  z-index: var(--zindex-dialog);
  animation: fade-in 150ms ease-out;
}
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }

.help-overlay {
  background: var(--neutral-3);
  border: 1px solid var(--neutral-5);
  border-radius: var(--border-radius-2);
  padding: var(--size-2);
  max-width: 420px;
  width: calc(100% - 32px);
  max-height: calc(100vh - 64px);
  overflow-y: auto;
  box-shadow: var(--shadow-6);
}

.help-overlay-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--size-0);
}
.help-overlay-title {
  font-size: var(--font-size-0);
  font-weight: var(--font-weight-semi-bold);
  color: var(--neutral-11);
}
.help-overlay-close { font-size: var(--font-size-1); color: var(--neutral-8); padding: 4px 8px; }

.help-section { margin-bottom: var(--size-0); }
.help-section:last-child { margin-bottom: 0; }
.help-section-title {
  font-size: var(--font-size--2);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--neutral-7);
  margin-bottom: 8px;
}

.help-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: var(--font-size--1);
  color: var(--neutral-9);
}
.help-row kbd {
  background: var(--neutral-1);
  border: 1px solid var(--neutral-5);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: var(--font-size--2);
  font-family: inherit;
  color: var(--neutral-11);
  white-space: nowrap;
}

/* ── Card highlight (search result) ──────────────── */

.card--highlighted {
  outline: 2px solid var(--primary-8);
  outline-offset: 2px;
  animation: card-highlight-pulse 1.5s ease-in-out 2;
}
@keyframes card-highlight-pulse {
  0%, 100% { outline-color: var(--primary-8); box-shadow: 0 0 0 0 transparent; }
  50% { outline-color: var(--primary-9); box-shadow: 0 0 12px 2px color-mix(in oklch, var(--primary-8) 30%, transparent); }
}

/* ── Command menu (Cmd+K) ────────────────────────── */

.command-menu-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: min(20vh, 120px);
  z-index: var(--zindex-dropdown);
  animation: fade-in 150ms ease-out;
}

.command-menu-panel {
  background: var(--neutral-3);
  border: 1px solid var(--neutral-5);
  border-radius: var(--border-radius-2);
  width: min(520px, calc(100% - 32px));
  max-height: calc(100vh - 180px);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-6);
  overflow: hidden;
}

.command-menu-input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: var(--size--2) var(--size-0);
  border-bottom: 1px solid var(--neutral-5);
}

.command-menu-icon {
  color: var(--neutral-7);
  font-size: var(--font-size-1);
  flex-shrink: 0;
}

.command-menu-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--neutral-11);
  font-size: var(--font-size-0);
  font-family: inherit;
}
.command-menu-input::placeholder { color: var(--neutral-7); }

.command-menu-results {
  overflow-y: auto;
  padding-bottom: 4px;
}

.command-menu-section-header {
  padding: 8px var(--size-0) 4px;
  font-size: var(--font-size--2);
  font-weight: var(--font-weight-semi-bold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--neutral-7);
}

.command-menu-section-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.command-menu-result {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px var(--size-0);
  cursor: pointer;
  color: var(--neutral-9);
  font-size: var(--font-size--1);
  gap: var(--size--2);
}
.command-menu-result:hover { background: var(--neutral-5); }
.command-menu-result--active {
  background: var(--neutral-5);
  color: var(--neutral-12);
}

.command-menu-result-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-menu-type-icon {
  flex-shrink: 0;
  font-size: var(--font-size--2);
  opacity: 0.6;
  width: 1.1em;
  text-align: center;
}

.command-menu-label-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
  font-size: 0;
  line-height: 0;
}

.command-menu-result-sub {
  color: var(--neutral-7);
  font-size: var(--font-size--2);
  flex-shrink: 0;
  white-space: nowrap;
}

.command-menu-empty,
.command-menu-hint {
  padding: var(--size-0);
  text-align: center;
  color: var(--neutral-7);
  font-size: var(--font-size--1);
}

/* ── Action sheet ────────────────────────────────── */

.action-sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: var(--zindex-drawer);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
}

.action-sheet {
  background: var(--neutral-3);
  border-radius: var(--border-radius-3) var(--border-radius-3) 0 0;
  padding: var(--size-0);
  padding-bottom: calc(var(--size-0) + env(safe-area-inset-bottom, 0px));
  width: 100%;
  max-width: 400px;
  max-height: 80vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* Slide up animation */
  animation: sheet-slide-up 200ms var(--anim-ease-emphasized);
}
@keyframes sheet-slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.action-sheet-header {
  padding: 4px 0 8px;
  border-bottom: 1px solid var(--neutral-5);
  margin-bottom: 4px;
}
.action-sheet-title {
  font-size: var(--font-size--1);
  font-weight: var(--font-weight-semi-bold);
  color: var(--neutral-11);
  word-break: break-word;
}

.action-sheet-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.action-sheet-label {
  font-size: var(--font-size--2);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--neutral-7);
  padding: 4px 0;
}

.action-sheet-btn {
  background: var(--neutral-1);
  border: 1px solid var(--neutral-5);
  border-radius: var(--border-radius-0);
  color: var(--neutral-11);
  padding: var(--size--2) var(--size-0);
  font-size: var(--font-size--1);
  cursor: pointer;
  text-align: left;
  transition: background var(--anim-duration-fast);
  min-height: 44px;
}
.action-sheet-btn:hover { background: var(--neutral-3); border-color: var(--neutral-6); }
.action-sheet-btn--danger { color: var(--error-8); }
.action-sheet-btn--danger:hover { background: var(--error-2); border-color: var(--error-4); }
.action-sheet-btn--cancel {
  background: var(--neutral-5);
  border-color: var(--neutral-6);
  text-align: center;
  font-weight: var(--font-weight-semi-bold);
  margin-top: 4px;
}
.action-sheet-btn--cancel:hover { background: var(--neutral-6); }

/* ── Selection bar (bottom action bar) ───────────── */

/* ── Time travel ──────────────────────────────────── */
.board--time-travel { opacity: 0.85; }
.time-travel-bar {
  background: var(--neutral-3);
  border: 1px solid var(--primary-7);
  border-radius: var(--border-radius-1);
  padding: var(--size--2) var(--size-0);
  margin-bottom: clamp(12px, 3vw, 24px);
}
.tt-header {
  display: flex;
  align-items: center;
  gap: var(--size--2);
  margin-bottom: 8px;
}
.tt-label {
  font-weight: var(--font-weight-semi-bold);
  font-size: var(--font-size--1);
  color: var(--primary-7);
}
.tt-info {
  flex: 1;
  font-size: var(--font-size--2);
  color: var(--neutral-8);
}
.tt-exit {
  background: var(--neutral-5);
  color: var(--neutral-11);
  border: 1px solid var(--neutral-6);
  border-radius: var(--border-radius-0);
  padding: 4px 12px;
  font-size: var(--font-size--2);
  cursor: pointer;
}
.tt-exit:hover { background: var(--primary-7); border-color: var(--primary-7); }
.tt-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tt-step {
  background: var(--neutral-5);
  color: var(--neutral-11);
  border: 1px solid var(--neutral-6);
  border-radius: var(--border-radius-0);
  width: 36px;
  height: 28px;
  font-size: var(--font-size--1);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tt-step:hover:not(:disabled) { background: var(--neutral-6); }
.tt-step:disabled { opacity: 0.3; cursor: default; }
#tt-slider {
  flex: 1;
  accent-color: var(--primary-7);
  height: 6px;
}
.tt-counter {
  font-size: var(--font-size--2);
  color: var(--neutral-7);
  min-width: 5ch;
  text-align: right;
}

.selection-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--neutral-3);
  border-top: 1px solid var(--neutral-5);
  padding: var(--size--2) clamp(12px, 4vw, 24px);
  padding-bottom: calc(var(--size--2) + env(safe-area-inset-bottom, 0px));
  display: flex;
  align-items: center;
  gap: var(--size--2);
  z-index: 150;
  /* Slide up */
  animation: sheet-slide-up 200ms var(--anim-ease-emphasized);
}
.selection-bar-count {
  font-size: var(--font-size--1);
  color: var(--neutral-8);
  white-space: nowrap;
}
.selection-bar-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-left: auto;
  position: relative;
}
.selection-bar-btn {
  background: var(--neutral-5);
  border: 1px solid var(--neutral-6);
  border-radius: var(--border-radius-0);
  color: var(--neutral-11);
  padding: 8px 14px;
  font-size: var(--font-size--1);
  cursor: pointer;
  min-height: 44px;
  transition: background var(--anim-duration-fast);
  white-space: nowrap;
}
.selection-bar-btn:hover { background: var(--neutral-6); }
.selection-bar-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.selection-bar-btn--danger { color: var(--error-8); border-color: var(--error-4); }
.selection-bar-btn--danger:hover { background: var(--error-2); }

/* Column picker dropdown above the "Move to…" button */
.column-picker {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 6px;
  background: var(--neutral-3);
  border: 1px solid var(--neutral-6);
  border-radius: var(--border-radius-0);
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 160px;
  box-shadow: var(--shadow-3);
  z-index: 160;
}
.column-picker-btn {
  background: none;
  border: none;
  color: var(--neutral-11);
  padding: 10px 12px;
  font-size: var(--font-size--1);
  cursor: pointer;
  border-radius: var(--border-radius-0);
  text-align: left;
  transition: background var(--anim-duration-fast);
  min-height: 44px;
}
.column-picker-btn:hover { background: var(--neutral-5); }

/* Extra bottom padding on board when selection bar is visible */
#board:has(.selection-bar) .columns { padding-bottom: 80px; }

/* MPA cross-document view transitions */
@view-transition { navigation: auto; }

/* Named groups morph position+size; root swaps instantly */
::view-transition-group(*) {
  animation-duration: 200ms;
  animation-timing-function: var(--anim-ease-emphasized);
}
::view-transition-group(root) { animation: none; }
::view-transition-old(*) { animation: none; opacity: 0; }
::view-transition-new(*) { animation: none; }

/* Card expand/collapse — group morphs position+size,
   new snapshot paints over old */
::view-transition-group(card-expand) {
  animation-duration: 200ms;
  animation-timing-function: var(--anim-ease-emphasized);
  overflow: clip;
  z-index: 100;
}
::view-transition-old(card-expand) {
  animation: none;
  height: 100%;
  overflow: clip;
}
::view-transition-new(card-expand) {
  animation: vt-fade-in 120ms ease 50ms both;
  mix-blend-mode: normal;
  height: 100%;
  overflow: clip;
}
/* Board fades in only when collapsing back from card detail */
html:active-view-transition-type(card-collapse) ::view-transition-new(root) {
  animation: vt-fade-in 150ms ease both;
}

@keyframes vt-fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
@keyframes vt-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
/* ── Card detail page ────────────────────────────── */

#card-detail {
  max-width: 900px;
  margin: 0 auto;
  padding: var(--size-0);
}
.card-detail-header {
  margin-bottom: var(--size-1);
}
.card-detail-body {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: var(--size-2);
}
@media (max-width: 700px) {
  .card-detail-body {
    grid-template-columns: 1fr;
  }
}
.card-detail-main {
  display: flex;
  flex-direction: column;
  gap: var(--size-1);
}
.card-detail-label-bar {
  height: 4px;
  border-radius: 4px;
}
.card-detail-form {
  display: flex;
  flex-direction: column;
  gap: var(--size--2);
}
.card-detail-title-input {
  font-size: var(--font-size-2);
  font-weight: var(--font-weight-bold);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--border-radius-0);
  color: var(--neutral-11);
  padding: 8px;
  width: 100%;
  box-sizing: border-box;
}
.card-detail-title-input:focus {
  border-color: var(--primary-9);
  outline: none;
  background: var(--neutral-3);
}
.card-detail-desc-input {
  background: var(--neutral-3);
  border: 1px solid var(--neutral-5);
  border-radius: var(--border-radius-0);
  color: var(--neutral-11);
  padding: 10px;
  font-size: var(--font-size-0);
  resize: vertical;
  min-height: 120px;
  width: 100%;
  box-sizing: border-box;
  font-family: inherit;
}
.card-detail-desc-input:focus {
  border-color: var(--primary-9);
  outline: none;
}
.card-detail-form-actions {
  display: flex;
  gap: 8px;
}
.card-detail-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.card-detail-section-title {
  font-size: var(--font-size--2);
  font-weight: var(--font-weight-semi-bold);
  text-transform: uppercase;
  color: var(--neutral-7);
  letter-spacing: 0.05em;
  margin: 0;
}
.card-detail-column-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.card-detail-col-btn {
  padding: 6px 14px;
  border-radius: var(--border-radius-0);
  border: 1px solid var(--neutral-5);
  background: var(--neutral-3);
  color: var(--neutral-11);
  cursor: pointer;
  font-size: var(--font-size--1);
}
.card-detail-col-btn--active {
  background: var(--primary-9);
  border-color: var(--primary-9);
  color: #fff;
  cursor: default;
}
.card-detail-col-btn:not(:disabled):hover {
  background: var(--neutral-5);
}

/* Sidebar */
.card-detail-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--size-1);
}
.card-detail-meta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  font-size: var(--font-size--1);
  margin: 0;
}
.card-detail-meta dt {
  color: var(--neutral-7);
}
.card-detail-meta dd {
  margin: 0;
  color: var(--neutral-9);
}
.card-detail-history {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 300px;
  overflow-y: auto;
}
.card-detail-history-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 8px;
  background: var(--neutral-3);
  border-radius: 4px;
  font-size: var(--font-size--2);
}
.card-detail-history-label {
  color: var(--neutral-11);
}
.card-detail-history-time {
  color: var(--neutral-7);
  font-size: var(--font-size--2);
}
.card-detail-empty {
  color: var(--neutral-7);
  font-size: var(--font-size--1);
}
.card-detail-danger {
  padding-top: var(--size--2);
  border-top: 1px solid var(--neutral-5);
}

/* card-expand-btn: base styles from .icon-btn */
.card-expand-btn { text-decoration: none; }

/* Generic button styles */
.btn {
  padding: 8px 18px;
  border: none;
  border-radius: var(--border-radius-0);
  cursor: pointer;
  font-size: var(--font-size--1);
  font-weight: var(--font-weight-medium);
}
.btn--primary {
  background: var(--primary-9);
  color: #fff;
}
.btn--primary:hover { background: var(--primary-8); }
.btn--danger {
  background: var(--error-7);
  color: #fff;
}
.btn--danger:hover { background: var(--error-6); }

::view-transition-new(*) { animation: none; }
/* Columns above default during view transitions so moving column renders on top */
::view-transition-group(*.col) { z-index: 50; }

/* body cursor during drag (set by eg-kanban) */
body[style*="cursor: grabbing"] * { cursor: grabbing !important; }
`
