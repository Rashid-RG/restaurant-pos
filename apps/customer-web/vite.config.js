import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({mode}) => ({
  // Native WebViews load packaged assets; the hosted PWA keeps /customer/ URLs.
  base: mode === 'native' ? './' : '/customer/',
  plugins: [react()],
  server: {
    host: true,
    port: 3001,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  }
}));
