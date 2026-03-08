import { build } from 'vite';
import path from 'path';
import { createHash } from 'crypto';
import fs from 'fs';
import { buildIconCSS } from './lib/icon-css.js';

// Assets to bundle with content hashes.
// source: path relative to project root (the actual source file)
// publicPath: the URL path the SW references (via base() + this value)
// define: the global constant name injected via Vite's define
const BUNDLED_ASSETS = [
  { source: 'css/stellar.css', define: '__STELLAR_CSS__', contentType: 'text/css' },
  { source: 'eg-kanban.js', define: '__KANBAN_JS__', contentType: 'application/javascript' },
];

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

function hashedName(source, hash) {
  const ext = path.extname(source);
  const base = path.basename(source, ext);
  return `assets/${base}-${hash}${ext}`;
}

export default function serviceWorkerPlugin() {
  let config;
  let swCode = '';
  // Maps define constant name → value (the URL path segment after base()).
  // In dev: plain source paths. In prod: hashed asset paths.
  let assetDefines = {};

  async function buildSW() {
    // Convert assetDefines to Vite define format (JSON-stringified values).
    const define = {};
    for (const [key, value] of Object.entries(assetDefines)) {
      define[key] = JSON.stringify(value);
    }

    const result = await build({
      configFile: false,
      define,
      esbuild: {
        jsx: 'automatic',
        jsxImportSource: 'hono/jsx',
      },
      build: {
        write: false,
        rollupOptions: {
          input: path.resolve(config.root, 'sw.jsx'),
          output: { format: 'iife' },
        },
      },
      logLevel: 'silent',
    });
    swCode = result.output[0].code;
  }

  return {
    name: 'service-worker',

    config(userConfig, { command }) {
      // Compute asset defines for both dev and prod.
      // In dev, we serve assets from source paths.
      // In prod, generateBundle emits hashed copies.
      const root = userConfig.root || process.cwd();
      const defines = {};

      if (command === 'serve') {
        // Dev: use plain source paths (middleware serves them)
        for (const asset of BUNDLED_ASSETS) {
          defines[asset.define] = JSON.stringify(asset.source);
        }
      } else {
        // Prod: compute content hashes now so define values are available
        // during the main Rollup build of sw.jsx
        for (const asset of BUNDLED_ASSETS) {
          const content = fs.readFileSync(path.resolve(root, asset.source));
          const hash = hashContent(content);
          const hashed = hashedName(asset.source, hash);
          defines[asset.define] = JSON.stringify(hashed);
        }
      }

      // Icon CSS (mask-image rules) — same value for dev and prod.
      defines['__LUCIDE_ICON_CSS__'] = JSON.stringify(buildIconCSS());

      assetDefines = {};
      for (const [key, value] of Object.entries(defines)) {
        // Store the unquoted value for buildSW's inner define pass
        assetDefines[key] = JSON.parse(value);
      }

      return { define: defines };
    },

    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },

    async buildStart() {
      if (config.command === 'serve') {
        await buildSW();
      }
    },

    generateBundle() {
      // Prod only: emit hashed asset files into the bundle.
      if (config.command === 'build') {
        for (const asset of BUNDLED_ASSETS) {
          const content = fs.readFileSync(path.resolve(config.root, asset.source));
          const hash = hashContent(content);
          const fileName = hashedName(asset.source, hash);
          this.emitFile({
            type: 'asset',
            fileName,
            source: content,
          });
        }
      }
    },

    configureServer(server) {
      const swPath = path.resolve(config.root, 'sw.jsx');
      const kanbanPath = path.resolve(config.root, 'eg-kanban.js');
      const stellarPath = path.resolve(config.root, 'css/stellar.css');
      const libDir = path.resolve(config.root, 'lib') + path.sep;
      const componentsDir = path.resolve(config.root, 'components') + path.sep;
      const cssDir = path.resolve(config.root, 'css') + path.sep;
      server.watcher.on('change', async (filePath) => {
        // Rebuild SW when any source file it bundles changes
        if (filePath === swPath || filePath === kanbanPath
            || filePath.startsWith(libDir)
            || filePath.startsWith(componentsDir)
            || (filePath.startsWith(cssDir) && filePath !== stellarPath)) {
          console.log('[sw-plugin] ' + path.basename(filePath) + ' changed, rebuilding...');
          await buildSW();
          // Don't full-reload — that fires before the new SW activates,
          // causing a flash of old Shell. Instead, tell the page to
          // trigger reg.update() so the SW lifecycle handles the reload
          // via controllerchange.
          server.ws.send({ type: 'custom', event: 'sw-updated' });
        }
        if (filePath === stellarPath) {
          console.log('[sw-plugin] stellar.css changed, reloading...');
          server.ws.send({ type: 'full-reload' });
        }
      });

      server.middlewares.use((req, res, next) => {
        if (req.url === '/sw.js') {
          res.setHeader('Content-Type', 'application/javascript');
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.end(swCode);
          return;
        }

        // Serve bundled assets from source files during dev.
        for (const asset of BUNDLED_ASSETS) {
          if (req.url === '/' + asset.source) {
            const filePath = path.resolve(config.root, asset.source);
            res.setHeader('Content-Type', asset.contentType);
            res.setHeader('Cache-Control', 'no-cache');
            res.end(fs.readFileSync(filePath));
            return;
          }
        }

        next();
      });
    },
  };
}
