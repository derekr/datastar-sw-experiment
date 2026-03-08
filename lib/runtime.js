const runtimeConfig = {
  basePath: '/',
  matchClients: async () => [],
  isOnline: () => (typeof navigator !== 'undefined' ? navigator.onLine : true),
  subscribeConnectionChange: null,
  onBoardStreamOpen: null,
  onBoardStreamClose: null,
  countBoardConnections: null,
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
  if (config.onBoardStreamOpen !== undefined) {
    runtimeConfig.onBoardStreamOpen = config.onBoardStreamOpen
  }
  if (config.onBoardStreamClose !== undefined) {
    runtimeConfig.onBoardStreamClose = config.onBoardStreamClose
  }
  if (config.countBoardConnections !== undefined) {
    runtimeConfig.countBoardConnections = config.countBoardConnections
  }
}

export function getRuntimeConfig() {
  return runtimeConfig
}
