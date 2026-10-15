import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? `/${process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'chessmj'}/` : '/',
  plugins: [react()],
  server: { host: '0.0.0.0' },
});
