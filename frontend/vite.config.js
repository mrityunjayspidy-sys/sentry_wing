import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    basicSsl() // Generates local HTTPS certificate so mobile phone browser allows getUserMedia camera access!
  ],
  server: {
    host: '0.0.0.0', // Listen on all network interfaces for LAN mobile testing
    port: 5173,
    https: true, // Enable HTTPS for camera permissions on phone
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
        changeOrigin: true
      }
    }
  }
});
