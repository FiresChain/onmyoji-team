import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  base: './',
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      '/r2': {
        target: 'https://onmyoji-assets.fireschain.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/r2/, ''),
      },
    },
  },
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['@paddleocr/paddleocr-js'],
    // The SDK is ESM but these nested dependencies are CommonJS. Prebundle
    // them so development-mode imports have a real browser default export.
    include: [
      '@paddleocr/paddleocr-js > clipper-lib',
      '@paddleocr/paddleocr-js > @techstark/opencv-js',
    ],
  },
});
