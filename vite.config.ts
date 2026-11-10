import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The base path is configurable so the same build works for local hosting,
// user/organisation pages (base "/") and project pages (base "/<repo>/").
// The GitHub Actions workflow sets VITE_BASE from the repository name.
// The default "./" produces relative asset URLs that work from any sub-path.
export default defineConfig({
  base: process.env.VITE_BASE || './',
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 240000,
  },
} as any);
