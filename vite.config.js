import { defineConfig } from 'vite';
import serviceWorkerPlugin from './vite-plugin-sw.js';

export default defineConfig({
  plugins: [serviceWorkerPlugin()],
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'hono/jsx',
  },
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
        sw: './sw.jsx',
      },
      output: {
        entryFileNames: (chunkInfo) => {
          return chunkInfo.name === 'sw' ? 'sw.js' : '[name]-[hash].js';
        },
      },
    },
  },
});
