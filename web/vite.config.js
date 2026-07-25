import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const DATABASE_MODULE_ID = 'virtual:game-database';
const RESOLVED_DATABASE_MODULE_ID = `\0${DATABASE_MODULE_ID}`;
const DATABASE_PATH = fileURLToPath(
  new URL('./public/game-data/database.json', import.meta.url)
);

// Vite 8's dev server refuses to let JS import files under `public/`, but
// `public/game-data/database.json` must stay the single canonical, publicly
// downloadable database. This virtual module inlines that one file at build
// time (synchronous in dev, prod build, and Vitest) and watches it in dev, so
// the app can keep synchronously importing the database without a second copy.
const gameDatabase = () => ({
  name: 'game-database',
  enforce: 'pre',
  resolveId(id) {
    if (id === DATABASE_MODULE_ID) return RESOLVED_DATABASE_MODULE_ID;
  },
  load(id) {
    if (id !== RESOLVED_DATABASE_MODULE_ID) return;

    this.addWatchFile(DATABASE_PATH);
    return `export default ${readFileSync(DATABASE_PATH, 'utf8')};`;
  },
});

// https://vite.dev/config/  (defineConfig from vitest/config also types the `test` block)
export default defineConfig({
  plugins: [gameDatabase(), react()],
  // The app is served from the domain root on Cloudflare Pages.
  base: '/',
  server: {
    // Keep CRA's port so Playwright (webServer: `pnpm start` -> :3000),
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
    // `tests/` holds Playwright e2e specs — run those via `pnpm test:e2e`,
    // never Vitest (they use Playwright's test runner).
    include: [
      'src/**/*.{test,spec}.{js,jsx,ts,tsx}',
      'functions/**/*.{test,spec}.{js,ts}',
    ],
  },
});
