import { defineConfig, loadEnv } from 'vite';
import { nativeApiOrigin } from './src/utils/native-api-origin.js';
import react from '@vitejs/plugin-react';

export default defineConfig(({mode}) => {
  if (mode === 'native') {
    // Fail at build time instead of shipping a native shell pointing at localhost.
    const env=loadEnv(mode, process.cwd(), 'VITE_');
    nativeApiOrigin(process.env.VITE_NATIVE_API_ORIGIN || env.VITE_NATIVE_API_ORIGIN);
  }
  return ({
  // Native WebViews load packaged assets; the hosted PWA keeps /customer/ URLs.
  base: mode === 'native' ? './' : '/customer/',
  plugins: [react()],
  // Customer app imports components from ../../../shared. When CI installs both
  // root and customer dependencies, Vite can otherwise bundle two React copies,
  // causing "Invalid hook call" and a blank native startup error screen.
  resolve: {
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
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
  });
});
