// vitest.config.ts — Track 8a
// loadEnv is bundled with vitest/config (re-exported from Vite) — no extra
// packages needed.  It reads .env, .env.local, and .env.test from cwd and
// makes every variable available via process.env inside test files.
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import path from 'path';

export default defineConfig(() => {
  // Load .env (and .env.test / .env.local if they exist) with no prefix
  // filter so ALL variables are exposed, not just VITE_-prefixed ones.
  const env = loadEnv('test', process.cwd(), '');

  return {
    test: {
      environment: 'node',   // layout + CSV helpers don't need a DOM
      globals: true,
      include: ['src/__tests__/**/*.test.ts'],
      // Inject the loaded vars so process.env is populated for every test file
      env,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  };
});
