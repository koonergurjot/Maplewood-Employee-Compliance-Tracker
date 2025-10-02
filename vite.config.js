import { defineConfig } from 'vite';
import legacy from '@vitejs/plugin-legacy';
import { resolve } from 'path';

const buildHash = process.env.BUILD_HASH || Date.now().toString(36);

export default defineConfig({
  plugins: [
    legacy({
      targets: ['defaults', 'not IE 11', 'Edge 18', 'Safari 13'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime']
    })
  ],
  define: {
    __BUILD_HASH__: JSON.stringify(buildHash)
  },
  build: {
    target: 'es2015',
    outDir: 'dist',
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        calendar: resolve(__dirname, 'calendar.html'),
        clearCache: resolve(__dirname, 'clear-cache.html'),
        convertIcons: resolve(__dirname, 'convert-icons.html'),
        timeline: resolve(__dirname, 'timeline-component.html'),
        serviceWorker: resolve(__dirname, 'sw.js')
      },
      output: {
        entryFileNames: chunkInfo =>
          chunkInfo.name === 'serviceWorker' ? 'sw.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
});
