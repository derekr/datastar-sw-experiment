import { createRequire } from 'module'
import { getIconsCSS } from '@iconify/utils'

export const USED_ICONS = [
  'x', 'square-check', 'square', 'pencil', 'arrow-up-right',
  'arrow-left', 'arrow-right', 'plus', 'chevron-left', 'chevron-right',
  'search', 'book-open', 'zap', 'layout-dashboard', 'tag', 'columns-3',
]

export function buildIconCSS() {
  const require = createRequire(import.meta.url)
  const lucide = require('@iconify-json/lucide/icons.json')
  return getIconsCSS(lucide, USED_ICONS, {
    iconSelector: '.icon--{prefix}--{name}',
    commonSelector: '.icon--{prefix}',
    overrideSelector: '.icon--{prefix}.icon--{prefix}--{name}',
  })
}
