import { EVENT_VERSIONS } from './constants.js'
import { compressToBase64url } from './compression.js'

// --- Board templates ---
// Templates are pre-defined event arrays. On first access, they're compressed
// to base64url hash fragments so the existing import flow handles everything.

export function templateEvent(type, data) {
  return { id: crypto.randomUUID(), type, v: EVENT_VERSIONS[type], data, ts: Date.now(), synced: false, correlationId: null, causationId: null, actorId: null }
}

export function buildTemplateEvents(title, columns) {
  const boardId = 'tpl-board'
  const events = [templateEvent('board.created', { id: boardId, title, createdAt: Date.now() })]
  for (const col of columns) {
    const colId = `tpl-col-${col.title.toLowerCase().replace(/\s+/g, '-')}`
    events.push(templateEvent('column.created', { id: colId, title: col.title, position: col.position, boardId }))
    if (col.cards) {
      for (const card of col.cards) {
        const cardId = `tpl-card-${crypto.randomUUID().slice(0, 8)}`
        events.push(templateEvent('card.created', { id: cardId, columnId: colId, title: card.title, position: card.position }))
        if (card.description) {
          events.push(templateEvent('card.descriptionUpdated', { id: cardId, description: card.description }))
        }
        if (card.label) {
          events.push(templateEvent('card.labelUpdated', { id: cardId, label: card.label }))
        }
      }
    }
  }
  return events
}

export const BOARD_TEMPLATES = [
  {
    id: 'kanban',
    title: 'Kanban',
    description: 'To Do / In Progress / Done',
    events: () => buildTemplateEvents('Kanban', [
      { title: 'To Do', position: 'a0', cards: [
        { title: 'Define project scope', position: 'a0', label: 'blue' },
        { title: 'Research competitors', position: 'a1' },
        { title: 'Draft initial wireframes', position: 'a2', label: 'purple' },
      ]},
      { title: 'In Progress', position: 'a1', cards: [
        { title: 'Set up dev environment', position: 'a0', label: 'green' },
      ]},
      { title: 'Done', position: 'a2', cards: [] },
    ]),
  },
  {
    id: 'sprint',
    title: 'Sprint Board',
    description: 'Backlog / Sprint / In Review / Done',
    events: () => buildTemplateEvents('Sprint Board', [
      { title: 'Backlog', position: 'a0', cards: [
        { title: 'User authentication', position: 'a0', label: 'red', description: 'OAuth + email/password login' },
        { title: 'Dashboard analytics', position: 'a1', label: 'blue' },
        { title: 'Export to CSV', position: 'a2' },
      ]},
      { title: 'Sprint', position: 'a1', cards: [
        { title: 'API rate limiting', position: 'a0', label: 'orange' },
        { title: 'Fix pagination bug', position: 'a1', label: 'red' },
      ]},
      { title: 'In Review', position: 'a2', cards: [] },
      { title: 'Done', position: 'a3', cards: [] },
    ]),
  },
  {
    id: 'personal',
    title: 'Personal',
    description: 'Today / This Week / Later / Done',
    events: () => buildTemplateEvents('Personal', [
      { title: 'Today', position: 'a0', cards: [
        { title: 'Morning workout', position: 'a0', label: 'green' },
        { title: 'Grocery shopping', position: 'a1' },
      ]},
      { title: 'This Week', position: 'a1', cards: [
        { title: 'Schedule dentist', position: 'a0', label: 'yellow' },
        { title: 'Read chapter 5', position: 'a1', label: 'purple' },
      ]},
      { title: 'Later', position: 'a2', cards: [
        { title: 'Plan weekend trip', position: 'a0', label: 'blue' },
      ]},
      { title: 'Done', position: 'a3', cards: [] },
    ]),
  },
  {
    id: 'project',
    title: 'Project Tracker',
    description: 'Ideas / Planning / Active / Shipped',
    events: () => buildTemplateEvents('Project Tracker', [
      { title: 'Ideas', position: 'a0', cards: [
        { title: 'Mobile app redesign', position: 'a0', label: 'purple' },
        { title: 'Public API', position: 'a1', label: 'blue' },
      ]},
      { title: 'Planning', position: 'a1', cards: [
        { title: 'v2.0 launch', position: 'a0', label: 'orange', description: 'Target Q2 — new onboarding flow + perf improvements' },
      ]},
      { title: 'Active', position: 'a2', cards: [] },
      { title: 'Shipped', position: 'a3', cards: [] },
    ]),
  },
]

// Cache compressed template hashes (computed on first access)
const _templateHashCache = new Map()
export async function getTemplateHash(tpl) {
  if (!_templateHashCache.has(tpl.id)) {
    const events = tpl.events()
    const hash = await compressToBase64url(JSON.stringify(events))
    _templateHashCache.set(tpl.id, hash)
  }
  return _templateHashCache.get(tpl.id)
}
