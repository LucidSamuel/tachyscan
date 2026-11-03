import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    proxy: {
      '/api/faucet': 'http://127.0.0.1:4142',
      '/api': 'http://127.0.0.1:4141',
    },
  },
});

