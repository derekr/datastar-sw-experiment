export const DOCS_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* Lucide icons via CSS mask-image */
${__LUCIDE_ICON_CSS__}
.icon--lucide { vertical-align: -0.125em; }

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background: var(--neutral-1);
  color: var(--neutral-11);
  min-height: 100dvh;
  -webkit-text-size-adjust: 100%;
}

/* ── Layout ──────────────────────────────────────── */

.docs-layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  min-height: 100dvh;
}

@media (max-width: 768px) {
  .docs-layout { grid-template-columns: 1fr; }
  .docs-sidebar { display: none; }
}

/* ── Sidebar ─────────────────────────────────────── */

.docs-sidebar {
  position: sticky;
  top: 0;
  height: 100dvh;
  overflow-y: auto;
  padding: var(--size-0) var(--size--1);
  border-right: 1px solid var(--neutral-4);
  background: var(--neutral-2);
}

.docs-sidebar-home {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--primary-7);
  text-decoration: none;
  font-size: var(--font-size--1);
  margin-bottom: var(--size-1);
}
.docs-sidebar-home:hover { text-decoration: underline; }

.docs-sidebar-overview { margin-bottom: var(--size--1); }

.docs-sidebar-section { margin-bottom: var(--size-0); }

.docs-sidebar-heading {
  font-size: var(--font-size--2);
  font-weight: var(--font-weight-semi-bold);
  color: var(--neutral-7);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.docs-sidebar-list { list-style: none; }
.docs-sidebar-list li { margin-bottom: 2px; }

.docs-sidebar-link {
  display: block;
  padding: 6px 10px;
  border-radius: var(--border-radius-0);
  color: var(--neutral-9);
  text-decoration: none;
  font-size: var(--font-size--1);
  transition: background var(--anim-duration-fast), color var(--anim-duration-fast);
}
.docs-sidebar-link:hover { background: var(--neutral-4); color: var(--neutral-11); }
.docs-sidebar-link--active {
  background: color-mix(in oklch, var(--primary-7) 15%, transparent);
  color: var(--primary-9);
  font-weight: var(--font-weight-medium);
}

/* ── Content ─────────────────────────────────────── */

.docs-content {
  max-width: 780px;
  padding: var(--size-2) var(--size-1);
  line-height: 1.7;
}

.docs-content h1 {
  font-size: var(--font-size-3);
  font-weight: var(--font-weight-bold);
  margin-bottom: var(--size--2);
  line-height: 1.2;
}

.docs-content h2 {
  font-size: var(--font-size-1);
  font-weight: var(--font-weight-semi-bold);
  margin-top: var(--size-2);
  margin-bottom: var(--size--1);
}

.docs-content h3 {
  font-size: var(--font-size-0);
  font-weight: var(--font-weight-semi-bold);
  margin-top: var(--size-1);
  margin-bottom: var(--size--2);
}

.docs-content p {
  margin-bottom: var(--size--1);
  color: var(--neutral-10);
}

.docs-content code {
  background: var(--neutral-3);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
}

.docs-content pre {
  background: var(--neutral-3);
  border: 1px solid var(--neutral-4);
  border-radius: var(--border-radius-1);
  padding: var(--size--1);
  overflow-x: auto;
  margin-bottom: var(--size--1);
  font-size: var(--font-size--2);
  line-height: 1.6;
}
.docs-content pre code { background: none; padding: 0; }

/* ── Hero (index page) ───────────────────────────── */

.docs-hero {
  margin-bottom: var(--size-2);
  padding-bottom: var(--size-1);
  border-bottom: 1px solid var(--neutral-4);
}
.docs-hero h1 {
  font-size: var(--font-size-4);
  margin-bottom: var(--size--1);
}
.docs-hero-sub {
  font-size: var(--font-size-0);
  color: var(--neutral-9);
  max-width: 600px;
}
.docs-hero-note {
  font-size: var(--font-size--1);
  color: var(--neutral-7);
  margin-top: var(--size--2);
  font-style: italic;
}

/* ── Content sections ────────────────────────────── */

.docs-section {
  margin-bottom: var(--size-2);
}
.docs-section h2 {
  font-size: var(--font-size-1);
  font-weight: var(--font-weight-semi-bold);
  margin-bottom: var(--size--1);
}
.docs-section h3 {
  font-size: var(--font-size-0);
  font-weight: var(--font-weight-semi-bold);
  margin-top: var(--size-1);
  margin-bottom: var(--size--2);
}
.docs-section p {
  margin-bottom: var(--size--1);
  color: var(--neutral-10);
  line-height: 1.7;
}
.docs-section code {
  background: var(--neutral-3);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
}

.docs-flow-list {
  list-style: none;
  counter-reset: flow;
  margin: var(--size-0) 0;
  display: flex;
  flex-direction: column;
  gap: var(--size--1);
}
.docs-flow-list li {
  counter-increment: flow;
  position: relative;
  padding-left: 2.5em;
  line-height: 1.7;
  color: var(--neutral-10);
}
.docs-flow-list li::before {
  content: counter(flow);
  position: absolute;
  left: 0;
  top: 0.15em;
  width: 1.8em;
  height: 1.8em;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in oklch, var(--primary-7) 15%, transparent);
  color: var(--primary-9);
  font-size: var(--font-size--2);
  font-weight: var(--font-weight-bold);
  border-radius: 50%;
}

/* ── Lists ───────────────────────────────────────── */

.docs-list {
  list-style: none;
  margin: var(--size-0) 0;
  display: flex;
  flex-direction: column;
  gap: var(--size--2);
}
.docs-list li {
  padding-left: 1.2em;
  position: relative;
  line-height: 1.7;
  color: var(--neutral-10);
}
.docs-list li::before {
  content: '—';
  position: absolute;
  left: 0;
  color: var(--neutral-6);
}

/* ── Event types grid ────────────────────────────── */

.docs-event-types {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--size--1);
  margin: var(--size-0) 0;
}
.docs-event-group {
  background: var(--neutral-3);
  border: 1px solid var(--neutral-4);
  border-radius: var(--border-radius-1);
  padding: var(--size--1) var(--size-0);
}
.docs-event-group h3 {
  font-size: var(--font-size--2);
  font-weight: var(--font-weight-semi-bold);
  color: var(--neutral-8);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}
.docs-event-group ul {
  list-style: none;
}
.docs-event-group li {
  font-size: var(--font-size--1);
  margin-bottom: 2px;
}

/* ── Table ───────────────────────────────────────── */

.docs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size--1);
  margin: var(--size-0) 0;
}
.docs-table th,
.docs-table td {
  padding: 6px var(--size--1);
  border-bottom: 1px solid var(--neutral-4);
  text-align: left;
}
.docs-table th {
  font-weight: var(--font-weight-semi-bold);
  color: var(--neutral-9);
  font-size: var(--font-size--2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.docs-table td code {
  font-size: var(--font-size--2);
}

/* ── Interactive Visualizations ───────────────────────── */

.docs-viz {
  border: 1px solid var(--neutral-4);
  border-radius: var(--border-radius-2);
  padding: var(--size-1);
  margin: var(--size-1) 0;
  background: var(--neutral-2);
}

.docs-viz-flow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size--1);
  flex-wrap: wrap;
}

.docs-viz-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: var(--size--1);
  border-radius: var(--border-radius-1);
  background: var(--neutral-3);
  border: 1px solid var(--neutral-4);
  min-width: 80px;
}

.docs-viz-node-title {
  font-weight: var(--font-weight-semi-bold);
  font-size: var(--font-size--2);
}

.docs-viz-node-desc {
  font-size: var(--font-size--2);
  color: var(--neutral-8);
}

.docs-viz-arrow {
  color: var(--primary-6);
  font-size: var(--font-size-1);
}

.docs-viz-zoom {
  margin-top: var(--size--1);
  padding-top: var(--size--1);
  border-top: 1px solid var(--neutral-4);
}

.docs-viz-zoom summary {
  font-size: var(--font-size--1);
  color: var(--neutral-8);
  cursor: pointer;
  user-select: none;
}

.docs-viz-zoom[open] summary {
  margin-bottom: var(--size--1);
}

.docs-viz-zoom-content {
  padding: var(--size--1);
  background: var(--neutral-3);
  border-radius: var(--border-radius-1);
  font-size: var(--font-size--1);
}

.docs-viz-step {
  display: flex;
  align-items: flex-start;
  gap: var(--size--1);
  margin-bottom: var(--size--2);
}

.docs-viz-step-num {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--primary-6);
  color: var(--primary-6-on);
  font-size: var(--font-size--2);
  font-weight: var(--font-weight-semi-bold);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.docs-viz-step-content {
  flex: 1;
}

/* ── TOC grid ────────────────────────────────────── */

.docs-toc-section { margin-bottom: var(--size-2); }
.docs-toc-section h2 {
  font-size: var(--font-size-1);
  font-weight: var(--font-weight-semi-bold);
  margin-bottom: 6px;
}
.docs-toc-intro {
  font-size: var(--font-size--1);
  color: var(--neutral-8);
  margin-bottom: var(--size-0);
}

.docs-toc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--size--1);
}

.docs-toc-card {
  display: block;
  padding: var(--size--1) var(--size-0);
  background: var(--neutral-3);
  border: 1px solid var(--neutral-4);
  border-radius: var(--border-radius-1);
  text-decoration: none;
  color: var(--neutral-11);
  transition: border-color var(--anim-duration-fast), background var(--anim-duration-fast);
}
.docs-toc-card:hover { border-color: var(--primary-7); background: var(--neutral-4); }
.docs-toc-card h3 { font-size: var(--font-size--1); font-weight: var(--font-weight-medium); margin: 0; }
.docs-toc-num {
  display: inline-block;
  font-size: var(--font-size--2);
  font-weight: var(--font-weight-bold);
  color: var(--primary-7);
  margin-bottom: 4px;
}

.docs-toc-card--bonus {
  border-style: dashed;
  background: var(--neutral-2);
}
.docs-toc-card--bonus:hover { background: var(--neutral-3); }

/* ── Badge ───────────────────────────────────────── */

.docs-badge {
  display: inline-block;
  font-size: var(--font-size--2);
  padding: 2px 10px;
  border-radius: 999px;
  font-weight: var(--font-weight-medium);
  margin-bottom: var(--size--1);
}
.docs-badge--bonus {
  background: color-mix(in oklch, var(--secondary-7) 15%, transparent);
  color: var(--secondary-9);
}

/* ── Stub ────────────────────────────────────────── */

.docs-stub {
  padding: var(--size-1);
  background: var(--neutral-3);
  border: 1px dashed var(--neutral-5);
  border-radius: var(--border-radius-1);
  color: var(--neutral-8);
  margin: var(--size-0) 0;
}

/* ── Pager ────────────────────────────────────────── */

.docs-pager {
  display: flex;
  justify-content: space-between;
  margin-top: var(--size-2);
  padding-top: var(--size-0);
  border-top: 1px solid var(--neutral-4);
}
.docs-pager-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--primary-7);
  text-decoration: none;
  font-size: var(--font-size--1);
}
.docs-pager-link:hover { text-decoration: underline; }
.docs-pager-next { margin-left: auto; }
`
