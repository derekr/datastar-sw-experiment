import { build } from 'vite';
import path from 'path';

export default function serviceWorkerPlugin() {
  let config;
  let swCode = '';

  async function buildSW() {
    const result = await build({
      configFile: false,
      build: {
        write: false,
        rollupOptions: {
          input: path.resolve(config.root, 'sw.js'),
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
      // Rebuild sw.js on any file change
      server.watcher.on('change', async (filePath) => {
        if (filePath.endsWith('sw.js') || filePath.includes('node_modules')) return;
        // Don't rebuild for non-SW related changes handled by Vite HMR
      });

      // Watch sw.js specifically and rebuild
      const swPath = path.resolve(config.root, 'sw.js');
      server.watcher.on('change', async (filePath) => {
        if (filePath === swPath) {
          console.log('[sw-plugin] sw.js changed, rebuilding...');
          await buildSW();
          // Notify connected clients to update the SW
          server.ws.send({ type: 'full-reload' });
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
