import { defineConfig } from 'vite';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
  plugins: [
    legacy({
      targets: ['defaults', 'not IE 11', 'Edge 18', 'Safari 13'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime']
    })
  ],
  build: {
    target: 'es2015',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'index.html',
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  }
});
