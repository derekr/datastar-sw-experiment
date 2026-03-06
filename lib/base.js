let _base
export function base() {
  if (!_base) _base = new URL(self.registration.scope).pathname
  return _base
}
