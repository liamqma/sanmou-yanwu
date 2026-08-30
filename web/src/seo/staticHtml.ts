import {
  SEO_ROUTES,
  SITE,
  buildStructuredData,
  canonicalUrl,
  socialImageUrl,
  type SeoRoute,
} from './config';

export const escapeHtml = (value: unknown): string =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

// The static rewrites below anchor on markup that Vite emits into the built
// index.html. If a future Vite/template change moves or reshapes any of these
// anchors, a silent `.replace()` no-op would ship route HTML with a missing
// React tree or an unreplaced title/description while every test stays green.
// Failing closed turns that regression into a loud build error instead.
const replaceOrThrow = (
  source: string,
  pattern: RegExp | string,
  replacement: string,
  label: string
): string => {
  const found =
    typeof pattern === 'string' ? source.includes(pattern) : pattern.test(source);
  if (!found) {
    throw new Error(
      `SEO static HTML generation could not find the ${label} anchor in the built index.html; the build template changed.`
    );
  }
  return source.replace(pattern, () => replacement);
};

// Keep the prerendered React tree rendered for crawlers while this fixed
// sibling masks the short client-side state reconciliation. The inline
// bootstrap runs in <head>, before the first paint. If the client bundle never
// becomes ready, the timeout fails open and exposes the static page.
const hydrationCurtainHead = `
    <style data-hydration-curtain-styles="true">
      [data-hydration-curtain="true"] {
        display: none;
      }
      html[data-app-hydration="pending"],
      html[data-app-hydration="pending"] body {
        overflow: hidden;
      }
      html[data-app-hydration="pending"] [data-hydration-curtain="true"] {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: grid;
        place-items: center;
        padding: 24px;
        cursor: wait;
        color: #d2b474;
        background-color: #080d0c;
        background-image:
          radial-gradient(circle at 50% 112%, rgba(184, 91, 42, 0.24), transparent 46%),
          repeating-linear-gradient(0deg, rgba(224, 191, 115, 0.018) 0 1px, transparent 1px 5px);
      }
      .hydration-curtain__panel {
        display: grid;
        justify-items: center;
        gap: 12px;
        width: min(320px, 100%);
        padding: 30px 24px;
        text-align: center;
        border-block: 1px solid #5e5138;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      .hydration-curtain__mark {
        display: grid;
        place-items: center;
        width: 56px;
        height: 56px;
        border: 1px solid #d2b474;
        outline: 1px solid rgba(180, 149, 89, 0.46);
        outline-offset: -6px;
        color: #d2b474;
        font-family: "Songti SC", STSong, Georgia, serif;
        font-size: 33px;
        font-weight: 800;
        text-shadow: 0 0 16px rgba(220, 135, 61, 0.36);
      }
      .hydration-curtain__panel strong {
        color: #d2b474;
        font-family: "Songti SC", STSong, Georgia, serif;
        font-size: 22px;
        letter-spacing: 0.16em;
      }
      .hydration-curtain__panel span {
        color: #a8a69d;
        font-size: 13px;
        letter-spacing: 0.08em;
      }
      .hydration-curtain__progress {
        position: relative;
        width: 184px;
        height: 8px;
        background: linear-gradient(transparent 3px, rgba(180, 149, 89, 0.34) 3px 4px, transparent 4px);
      }
      .hydration-curtain__progress i {
        position: absolute;
        top: 1px;
        width: 6px;
        height: 6px;
        background: #dc873d;
        box-shadow: 0 0 10px rgba(220, 135, 61, 0.85);
        transform: rotate(45deg);
        animation: hydration-curtain-pulse 1.35s ease-in-out infinite;
      }
      .hydration-curtain__progress i:nth-child(1) { left: 0; }
      .hydration-curtain__progress i:nth-child(2) { left: 50%; animation-delay: 180ms; }
      .hydration-curtain__progress i:nth-child(3) { right: 0; animation-delay: 360ms; }
      @keyframes hydration-curtain-pulse {
        0%, 100% { opacity: 0.28; transform: rotate(45deg) scale(0.72); }
        50% { opacity: 1; transform: rotate(45deg) scale(1); }
      }
      @media (prefers-reduced-motion: reduce) {
        .hydration-curtain__progress i { animation: none; opacity: 0.72; }
      }
    </style>
    <script data-hydration-curtain-bootstrap="true">
      (function () {
        var page = document.documentElement;
        page.setAttribute('data-app-hydration', 'pending');
        window.setTimeout(function () {
          if (page.getAttribute('data-app-hydration') === 'pending') {
            page.removeAttribute('data-app-hydration');
            var root = document.getElementById('root');
            if (root) {
              root.removeAttribute('inert');
              root.removeAttribute('aria-busy');
            }
          }
        }, 5000);
      })();
    </script>`;

const hydrationCurtain = `<div data-hydration-curtain="true" role="status" aria-live="polite" aria-label="正在准备页面">
      <div class="hydration-curtain__panel">
        <div class="hydration-curtain__mark" aria-hidden="true">谋</div>
        <strong>演武参谋</strong>
        <div class="hydration-curtain__progress" aria-hidden="true"><i></i><i></i><i></i></div>
        <span>正在准备页面…</span>
      </div>
    </div>`;

const hydrationRootGuard = `<script data-hydration-root-guard="true">
      (function () {
        if (document.documentElement.getAttribute('data-app-hydration') === 'pending') {
          var root = document.getElementById('root');
          root.setAttribute('inert', '');
          root.setAttribute('aria-busy', 'true');
        }
      })();
    </script>`;

export const renderSeoHtml = (
  template: string,
  route: SeoRoute,
  appHtml: string,
  emotionCss: string
): string => {
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
    ${emotionCss}${hydrationCurtainHead}`;
  const prerenderedRoot = `${hydrationCurtain}
    <div id="root" data-prerendered="true">${appHtml}</div>
    ${hydrationRootGuard}`;

  const withTitle = replaceOrThrow(
    template,
    /<title>[\s\S]*?<\/title>/,
    `<title>${escapeHtml(route.title)}</title>`,
    'title'
  );
  const withDescription = replaceOrThrow(
    withTitle,
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${escapeHtml(route.description)}" data-seo-managed="true" />`,
    'description meta'
  );
  const withHead = replaceOrThrow(
    withDescription,
    '</head>',
    `${seoHead}\n  </head>`,
    'head close'
  );
  return replaceOrThrow(
    withHead,
    '<div id="root"></div>',
    prerenderedRoot,
    'root'
  );
};

export const sitemapXml = (): string => {
  const urls = SEO_ROUTES.filter((route) => route.index)
    .map(
      (route) =>
        `  <url>\n    <loc>${escapeHtml(canonicalUrl(route))}</loc>\n  </url>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
};
