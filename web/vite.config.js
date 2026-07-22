import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/  (defineConfig from vitest/config also types the `test` block)
export default defineConfig({
  plugins: [react()],
  // The app is served from the domain root on Cloudflare Pages.
  base: '/',
  server: {
    // Keep CRA's port so Playwright (webServer: `npm start` -> :3000),
    // the Makefile `web` target, and the README all keep working.
    port: 3000,
    strictPort: true,
  },
  build: {
    // Cloudflare Pages is configured with build output directory `build`
    // (Vite defaults to `dist`). Do NOT change without updating Pages.
    outDir: 'build',
  },
  test: {
    // Jest-compatible globals (test/expect/...) so existing test files run unchanged.
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    // No CSS imports in this app; skip CSS processing in tests.
    css: false,
    // Unit tests live under src/ plus the lightweight Pages Function tests.
    // `tests/` holds Playwright e2e specs — run those via `npm run test:e2e`,
    // never Vitest (they use Playwright's test runner).
    include: [
      'src/**/*.{test,spec}.{js,jsx,ts,tsx}',
      'functions/**/*.{test,spec}.{js,ts}',
    ],
  },
});
