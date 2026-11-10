import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import path from 'path';
import { devAiMode } from './scripts/dev-ai-mode';

export default defineConfig({
  plugins: [
    react(),
    // Remote bindings (Workers AI) need a Cloudflare login and spend neurons, so
    // they open only when real AI is explicitly enabled; otherwise the mock runs offline.
    cloudflare({ remoteBindings: devAiMode(process.cwd()) === 'real' }),
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
