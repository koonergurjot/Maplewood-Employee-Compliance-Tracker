import { defineConfig } from 'vite';
import legacy from '@vitejs/plugin-legacy';
import { resolve } from 'path';

const buildHash = process.env.BUILD_HASH || Date.now().toString(36);
// The legacy plugin relies on `new Function` which is blocked when the site is
// served with a strict Content Security Policy (no `unsafe-eval`). Allow
// enabling it explicitly when older browser support is required.
const enableLegacy = String(process.env.ENABLE_LEGACY_BUILD).toLowerCase() === 'true';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  plugins: [
    enableLegacy &&
      legacy({
        targets: ['defaults', 'not IE 11', 'Edge 18', 'Safari 13'],
        additionalLegacyPolyfills: ['regenerator-runtime/runtime']
      })
  ].filter(Boolean),
  define: {
    __SW_BUILD_HASH__: JSON.stringify(buildHash),
    __BUILD_HASH__: JSON.stringify(buildHash),
    'import.meta.env.VITE_BUILD_HASH': JSON.stringify(buildHash)
  },
  build: {
    target: 'es2015',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
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
