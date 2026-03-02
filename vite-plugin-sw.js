import { build } from 'vite';
import path from 'path';

export default function serviceWorkerPlugin() {
  let config;
  let swCode = '';

  async function buildSW() {
    const result = await build({
      configFile: false,
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
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    async buildStart() {
      if (config.command === 'serve') {
        await buildSW();
      }
    },
    configureServer(server) {
      const swPath = path.resolve(config.root, 'sw.jsx');
      const kanbanPath = path.resolve(config.root, 'eg-kanban.js');
      server.watcher.on('change', async (filePath) => {
        if (filePath === swPath || filePath === kanbanPath) {
          console.log('[sw-plugin] ' + path.basename(filePath) + ' changed, rebuilding...');
          await buildSW();
          // Don't full-reload — that fires before the new SW activates,
          // causing a flash of old Shell. Instead, tell the page to
          // trigger reg.update() so the SW lifecycle handles the reload
          // via controllerchange.
          server.ws.send({ type: 'custom', event: 'sw-updated' });
        }
      });

      server.middlewares.use((req, res, next) => {
        if (req.url === '/sw.js') {
          res.setHeader('Content-Type', 'application/javascript');
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.end(swCode);
        } else {
          next();
        }
      });
    },
  };
}
