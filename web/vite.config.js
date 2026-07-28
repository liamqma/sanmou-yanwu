import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import {
  NOT_FOUND_SEO,
  SEO_ROUTES,
  SITE,
  buildStructuredData,
  canonicalUrl,
  socialImageUrl,
} from './src/seo/config.ts';

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

const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const staticNavigation = SEO_ROUTES
  .filter((route) => route.index)
  .map(
    (route) =>
      `<li><a href="${escapeHtml(route.path)}">${escapeHtml(route.navLabel)}</a></li>`
  )
  .join('');

const renderSeoHtml = (template, route) => {
  const canonical = canonicalUrl(route);
  const image = socialImageUrl();
  const robots = route.index
    ? 'index,follow,max-image-preview:large'
    : 'noindex,follow';
  const structuredData = JSON.stringify(buildStructuredData(route)).replaceAll(
    '<',
    '\\u003c'
  );
  const seoHead = `
    <meta name="robots" content="${robots}" data-seo-managed="true" />
    <link rel="canonical" href="${escapeHtml(canonical)}" data-seo-managed="true" />
    <meta property="og:type" content="${route.ogType}" data-seo-managed="true" />
    <meta property="og:site_name" content="${escapeHtml(SITE.name)}" data-seo-managed="true" />
    <meta property="og:locale" content="${SITE.locale}" data-seo-managed="true" />
    <meta property="og:title" content="${escapeHtml(route.title)}" data-seo-managed="true" />
    <meta property="og:description" content="${escapeHtml(route.description)}" data-seo-managed="true" />
    <meta property="og:url" content="${escapeHtml(canonical)}" data-seo-managed="true" />
    <meta property="og:image" content="${escapeHtml(image)}" data-seo-managed="true" />
    <meta property="og:image:alt" content="${escapeHtml(`${SITE.name}标志`)}" data-seo-managed="true" />
    <meta name="twitter:card" content="summary" data-seo-managed="true" />
    <meta name="twitter:title" content="${escapeHtml(route.title)}" data-seo-managed="true" />
    <meta name="twitter:description" content="${escapeHtml(route.description)}" data-seo-managed="true" />
    <meta name="twitter:image" content="${escapeHtml(image)}" data-seo-managed="true" />
    <script type="application/ld+json" data-seo-structured-data="true">${structuredData}</script>
    <style data-static-seo="true">
      [data-static-seo-shell]{box-sizing:border-box;max-width:72rem;margin:0 auto;padding:3rem 1.5rem;color:#17221e;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      [data-static-seo-shell] h1{font-size:clamp(1.8rem,5vw,3rem);line-height:1.18;margin:.4rem 0 1rem}
      [data-static-seo-shell] p{max-width:48rem;color:#4b5752;line-height:1.7}
      [data-static-seo-shell] nav ul{display:flex;flex-wrap:wrap;gap:.75rem 1.25rem;padding:0;list-style:none}
      [data-static-seo-shell] a{color:#31584b}
    </style>`;
  const staticShell = `<div id="root"><main data-static-seo-shell="true"><small>三国谋定天下 · 演武参谋</small><h1>${escapeHtml(route.heading)}</h1><p>${escapeHtml(route.description)}</p><nav aria-label="主要导航"><ul>${staticNavigation}</ul></nav></main></div>`;

  return template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(route.title)}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
      `<meta name="description" content="${escapeHtml(route.description)}" data-seo-managed="true" />`
    )
    .replace('</head>', `${seoHead}\n  </head>`)
    .replace('<div id="root"></div>', staticShell);
};

const sitemapXml = () => {
  const urls = SEO_ROUTES
    .filter((route) => route.index)
    .map(
      (route) =>
        `  <url>\n    <loc>${escapeHtml(canonicalUrl(route))}</loc>\n  </url>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
};

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
