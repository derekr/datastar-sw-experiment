/**
 * Storage adapter contracts used by domain/query code.
 *
 * The immediate goal is to define stable boundaries so runtimes can swap
 * backing stores (IndexedDB in SW/browser, SQLite in Bun) without changing
 * event/CQRS logic.
 */

/**
 * @typedef {Object} AppDbAdapter
 * @property {() => Promise<any>} getDb Return the underlying database handle.
 * @property {string[]} allStores Projection + event store names used in tx boundaries.
 */

/**
 * @typedef {Object} EventStoreAdapter
 * @property {(eventId: string) => Promise<boolean>} hasEventId
 * @property {(event: any, tx?: any) => Promise<void>} appendEvent
 * @property {() => Promise<any[]>} listEvents
 */

/**
 * @typedef {Object} ProjectionStoreAdapter
 * @property {(boardId: string) => Promise<any|null>} getBoard
 * @property {(columnId: string) => Promise<any|null>} getColumn
 * @property {(cardId: string) => Promise<any|null>} getCard
 */

export {}
