// --- SSE helpers ---

export function flattenJsx(jsx) {
  return jsx.toString().replace(/\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

export function dsePatch(selector, jsx, mode = 'outer', { useViewTransition = false } = {}) {
  performance?.mark('dsePatch-start')
  const html = flattenJsx(jsx)
  performance?.mark('dsePatch-render')
  const lines = [`mode ${mode}`, `selector ${selector}`]
  if (useViewTransition) lines.push('useViewTransition true')
  lines.push(`elements ${html}`)
  performance?.mark('dsePatch-end')
  performance?.measure('dsePatch', 'dsePatch-start', 'dsePatch-end')
  return {
    event: 'datastar-patch-elements',
    data: lines.join('\n'),
  }
}
