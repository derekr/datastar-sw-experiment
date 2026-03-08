const assetConfig = {
  stellarCssPath: 'css/stellar.css',
  kanbanJsPath: 'eg-kanban.js',
  lucideIconCSS: '',
}

export function setAssetConfig(config = {}) {
  if (config.stellarCssPath != null) assetConfig.stellarCssPath = config.stellarCssPath
  if (config.kanbanJsPath != null) assetConfig.kanbanJsPath = config.kanbanJsPath
  if (config.lucideIconCSS != null) assetConfig.lucideIconCSS = config.lucideIconCSS
}

export function getAssetConfig() {
  return assetConfig
}
