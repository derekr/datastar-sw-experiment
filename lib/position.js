import { generateKeyBetween } from 'fractional-indexing'

// --- Position helpers (fractional indexing) ---

// Lexicographic comparator for fractional-indexing string keys.
export const cmpPosition = (a, b) => (a.position || '').localeCompare(b.position || '')

// Given a drop index (0-based insertion point among visible siblings) and the
// sorted list of siblings (excluding the moved item), compute a fractional key.
// eg-kanban.js sends integer drop indices; this converts to a fractional key
// so the event stores a commutative position value (no sibling reindexing).
export function positionForIndex(dropIndex, sortedSiblings) {
  const before = dropIndex > 0 ? sortedSiblings[dropIndex - 1].position : null
  const after = dropIndex < sortedSiblings.length ? sortedSiblings[dropIndex].position : null
  return generateKeyBetween(before, after)
}
