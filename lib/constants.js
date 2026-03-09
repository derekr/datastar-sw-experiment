// Max decompressed size for imports
export const MAX_DECOMPRESS_BYTES = 2 * 1024 * 1024
// Max events per import
export const MAX_IMPORT_EVENTS = 5000

// Event schema versions. Bump when event shape changes.
export const EVENT_VERSIONS = {
  'board.created': 1,
  'board.titleUpdated': 1,
  'board.deleted': 1,
  'column.created': 2,
  'column.deleted': 1,
  'column.moved': 1,
  'card.created': 1,
  'card.moved': 1,
  'card.deleted': 1,
  'card.titleUpdated': 1,
  'card.descriptionUpdated': 1,
  'card.labelUpdated': 1,
}

// Allowed event types for import validation
export const ALLOWED_EVENT_TYPES = new Set(Object.keys(EVENT_VERSIONS))

// --- Docs topics ---

export const DOCS_TOPICS = [
  { slug: 'core/hypermedia',    title: 'Hypermedia — The Missing Pattern', section: 'core' },
  { slug: 'core/event-sourcing', title: 'Event Sourcing & CQRS',          section: 'core' },
  { slug: 'core/sse-fat-morph', title: 'SSE & Fat Morphing',              section: 'core' },
  { slug: 'core/signals',       title: 'Signals & Server-Owned UI State', section: 'core' },
  { slug: 'core/mpa',          title: 'MPA Navigations',                section: 'core' },
  { slug: 'bonus/sw',           title: 'Service Worker as Server',         section: 'bonus' },
  { slug: 'bonus/indexeddb',    title: 'IndexedDB: Keeping It Light',    section: 'bonus' },
  { slug: 'bonus/fractional',   title: 'Fractional Indexing',            section: 'bonus' },
  { slug: 'bonus/local-first',  title: 'Local-First in the Browser',      section: 'bonus' },
  { slug: 'bonus/brotli',      title: 'Brotli Compression for SSE',     section: 'bonus' },
  { slug: 'bonus/dual-runtime', title: 'Dual Runtime: SW & Bun',         section: 'bonus' },
]

export const LABEL_COLORS = {
  red: 'var(--error-7)',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  blue: 'var(--primary-9)',
  purple: '#8b5cf6',
  pink: '#ec4899',
}

export const MAX_UNDO = 50
