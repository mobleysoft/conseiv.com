import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'studio',
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': 'http://127.0.0.1:8796' } },
  build: { outDir: '../dist', emptyOutDir: true, rollupOptions: { output: { manualChunks(id) { if (id.includes('/node_modules/three/')) return 'three'; } } } },
});
