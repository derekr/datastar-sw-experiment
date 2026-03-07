import { getRuntimeConfig } from './runtime.js'

let _base

export function base() {
  if (!_base) _base = getRuntimeConfig().basePath
  return _base
}
