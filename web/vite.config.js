import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { NOT_FOUND_SEO, SEO_ROUTES } from './src/seo/config.ts';
import { renderSeoHtml, sitemapXml } from './src/seo/staticHtml.ts';

const DATABASE_MODULE_ID = 'virtual:game-database';
const RESOLVED_DATABASE_MODULE_ID = `\0${DATABASE_MODULE_ID}`;
const YANWU_GUIDE_MODULE_ID = 'virtual:yanwu-guide';
const RESOLVED_YANWU_GUIDE_MODULE_ID = `\0${YANWU_GUIDE_MODULE_ID}`;
const DATABASE_PATH = fileURLToPath(
  new URL('./public/game-data/database.json', import.meta.url)
);
const BUILD_PATH = fileURLToPath(new URL('./build', import.meta.url));

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
    if (id === YANWU_GUIDE_MODULE_ID) return RESOLVED_YANWU_GUIDE_MODULE_ID;
  },
  load(id) {
    if (
      id !== RESOLVED_DATABASE_MODULE_ID &&
      id !== RESOLVED_YANWU_GUIDE_MODULE_ID
    ) {
      return;
    }

    this.addWatchFile(DATABASE_PATH);
    const database = JSON.parse(readFileSync(DATABASE_PATH, 'utf8'));
    if (id === RESOLVED_YANWU_GUIDE_MODULE_ID) {
      return `export default ${JSON.stringify(database.yanwuGuide ?? {})};`;
    }

    // The matchup matrix and long-form editorial notes are only needed by the
    // lazy guide route. Keep them out of the eagerly loaded gameplay database
    // while retaining one public canonical JSON file.
    const { yanwuGuide: _guide, ...gameDatabase } = database;
    return `export default ${JSON.stringify(gameDatabase)};`;
  },
});

// Emit an HTML entry point for each public route. Crawlers and social previews
// receive route-specific metadata and meaningful content before JavaScript
// runs, while React replaces the lightweight shell for interactive visitors.
const seoStaticPages = () => ({
  name: 'seo-static-pages',
  apply: 'build',
  closeBundle() {
    const indexPath = `${BUILD_PATH}/index.html`;
    const template = readFileSync(indexPath, 'utf8');

    SEO_ROUTES.forEach((route) => {
      const outputPath =
        route.path === '/'
          ? indexPath
          : `${BUILD_PATH}${route.path}.html`;
      mkdirSync(outputPath.slice(0, outputPath.lastIndexOf('/')), {
        recursive: true,
      });
      writeFileSync(outputPath, renderSeoHtml(template, route));
    });

    writeFileSync(
      `${BUILD_PATH}/404.html`,
      renderSeoHtml(template, NOT_FOUND_SEO)
    );
    writeFileSync(`${BUILD_PATH}/sitemap.xml`, sitemapXml());
  },
});

// https://vite.dev/config/  (defineConfig from vitest/config also types the `test` block)
export default defineConfig({
  plugins: [gameDatabase(), react(), seoStaticPages()],
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
