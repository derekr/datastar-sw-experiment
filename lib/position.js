import { generateKeyBetween } from 'fractional-indexing'

// --- Position helpers (fractional indexing) ---

// Codepoint-order comparator for fractional-indexing string keys.
// fractional-indexing uses a base-62 alphabet (0-9, A-Z, a-z) where uppercase
// precedes lowercase by codepoint. localeCompare is case-insensitive and breaks
// this ordering (e.g. "Zz" sorts after "a0"), so we use raw < / > comparison.
export const cmpPosition = (a, b) => {
  const pa = a.position || ''
  const pb = b.position || ''
  return pa < pb ? -1 : pa > pb ? 1 : 0
}

// Given a drop index (0-based insertion point among visible siblings) and the
// sorted list of siblings (excluding the moved item), compute a fractional key.
// eg-kanban.js sends integer drop indices; this converts to a fractional key
// so the event stores a commutative position value (no sibling reindexing).
export function positionForIndex(dropIndex, sortedSiblings) {
  const before = dropIndex > 0 ? sortedSiblings[dropIndex - 1].position : null
  const after = dropIndex < sortedSiblings.length ? sortedSiblings[dropIndex].position : null
  return generateKeyBetween(before, after)
}
