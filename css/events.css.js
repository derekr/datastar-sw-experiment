export const EVENTS_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

.icon--lucide { vertical-align: -0.125em; }

body {
  font-family: 'Inconsolata', ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace;
  background: var(--neutral-1);
  color: var(--neutral-11);
  padding: clamp(12px, 4vw, 24px);
  min-height: 100dvh;
  font-size: var(--font-size--1);
}

a { color: var(--primary-8); }

h1 { font-size: var(--font-size-1); font-weight: var(--font-weight-semi-bold); margin-bottom: var(--size-0); display: flex; align-items: center; gap: var(--size--2); }
h1 span { font-size: var(--font-size--2); color: var(--neutral-7); font-weight: var(--font-weight-normal); }

.event-list { display: flex; flex-direction: column; gap: 2px; }

details {
  background: var(--neutral-3);
  border-radius: var(--border-radius-0);
  border: 1px solid var(--neutral-5);
  transition: border-color var(--anim-duration-fast);
}

details[open] { border-color: var(--neutral-6); }

summary {
  padding: 8px 12px;
  cursor: pointer;
  display: flex;
  gap: 12px;
  align-items: center;
  list-style: none;
  user-select: none;
}

summary::-webkit-details-marker { display: none; }

summary::before {
  content: '▸';
  color: var(--neutral-6);
  font-size: var(--font-size--2);
  transition: transform var(--anim-duration-fast);
  flex-shrink: 0;
}

details[open] summary::before { transform: rotate(90deg); }

.seq { color: var(--neutral-6); min-width: 3ch; text-align: right; }
.type { color: var(--primary-8); font-weight: var(--font-weight-semi-bold); font-size: 0.8em; }
.type--delete { color: var(--error-8); }
.type--move { color: var(--secondary-8); }
.type--create { color: var(--secondary-7); }
.type--update { color: var(--primary-8); }
.evt-summary { color: var(--neutral-9); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ts { color: var(--neutral-6); margin-left: auto; font-size: 0.8em; flex-shrink: 0; }
.synced { font-size: 0.75em; padding: 1px 6px; border-radius: 4px; flex-shrink: 0; }
.synced--no { background: var(--error-4); color: var(--secondary-8); }
.synced--yes { background: var(--secondary-4); color: var(--secondary-7); }

pre {
  padding: 12px;
  margin: 0;
  border-top: 1px solid var(--neutral-5);
  overflow-x: auto;
  font-size: 0.85em;
  line-height: 1.5;
  color: var(--neutral-9);
}

.actions { display: flex; gap: 8px; margin-bottom: var(--size-0); }

.actions button {
  background: var(--neutral-5);
  border: 1px solid var(--neutral-6);
  border-radius: var(--border-radius-0);
  color: var(--neutral-11);
  padding: 6px 12px;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.85em;
  transition: background var(--anim-duration-fast);
}

.actions button:hover { background: var(--neutral-6); }
.actions button:disabled { opacity: 0.5; cursor: wait; }

.board-filter {
  background: var(--neutral-5);
  border: 1px solid var(--neutral-6);
  border-radius: var(--border-radius-0);
  color: var(--neutral-11);
  padding: 6px 12px;
  font-family: inherit;
  font-size: 0.85em;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2394a3b8'%3E%3Cpath d='M2 4l4 4 4-4'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  padding-right: 28px;
}
.board-filter:hover { background-color: var(--neutral-6); }

.event-count {
  color: var(--neutral-7);
  font-size: 0.8em;
  padding: 4px 0 8px;
}

.events-scroll {
  overflow-y: auto;
  max-height: calc(100dvh - 120px);
  scroll-behavior: smooth;
}
`
