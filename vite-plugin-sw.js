import { build } from 'vite';
import path from 'path';
import fs from 'fs';

export default function serviceWorkerPlugin() {
  let config;
  let swCode;

  return {
    name: 'service-worker',
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    async buildStart() {
      if (config.command === 'serve') {
        const result = await build({
          configFile: false,
          build: {
            write: false,
            rollupOptions: {
              input: path.resolve(config.root, 'sw.js'),
              output: {
                format: 'iife'
              }
            }
          }
        });
        swCode = result.output[0].code;
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/sw.js') {
          res.setHeader('Content-Type', 'application/javascript');
          res.end(swCode);
        } else {
          next();
        }
      });
    }
  };
}
