import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@packs': path.resolve(__dirname, 'src/packs'),
      '@lib': path.resolve(__dirname, 'src/lib'),
      '@worker': path.resolve(__dirname, 'src/worker'),
      '@frontend': path.resolve(__dirname, 'src/frontend'),
    },
  },
});
