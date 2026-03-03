import { defineConfig } from 'vite';
import serviceWorkerPlugin from './vite-plugin-sw.js';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/datastar-sw-experiment/' : '/',
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
