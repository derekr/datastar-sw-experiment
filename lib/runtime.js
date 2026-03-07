const runtimeConfig = {
  basePath: '/',
  matchClients: async () => [],
  isOnline: () => (typeof navigator !== 'undefined' ? navigator.onLine : true),
  subscribeConnectionChange: null,
}

function normalizeBasePath(basePath) {
  if (!basePath) return '/'
  let normalized = basePath.startsWith('/') ? basePath : `/${basePath}`
  if (!normalized.endsWith('/')) normalized += '/'
  return normalized
}

export function setRuntimeConfig(config = {}) {
  if (config.basePath != null) {
    runtimeConfig.basePath = normalizeBasePath(config.basePath)
  }
  if (config.matchClients) runtimeConfig.matchClients = config.matchClients
  if (config.isOnline) runtimeConfig.isOnline = config.isOnline
  if (config.subscribeConnectionChange !== undefined) {
    runtimeConfig.subscribeConnectionChange = config.subscribeConnectionChange
  }
}

export function getRuntimeConfig() {
  return runtimeConfig
}
