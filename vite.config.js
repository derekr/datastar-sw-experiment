import { defineConfig } from 'vite';
import serviceWorkerPlugin from './vite-plugin-sw.js';

export default defineConfig({
  plugins: [serviceWorkerPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
        sw: './sw.js'
      },
      output: {
        entryFileNames: (chunkInfo) => {
          return chunkInfo.name === 'sw' ? 'sw.js' : '[name]-[hash].js';
        }
      }
    }
  }
});
