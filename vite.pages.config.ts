import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: { outDir: 'dist-pages' },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
