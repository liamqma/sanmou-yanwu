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

const staticNavigation = SEO_ROUTES.filter((route) => route.index)
  .map(
    (route) =>
      `<li><a href="${escapeHtml(route.path)}">${escapeHtml(route.navLabel)}</a></li>`
  )
  .join('');

// The static rewrites below anchor on markup that Vite emits into the built
// index.html. If a future Vite/template change moves or reshapes any of these
// anchors, a silent `.replace()` no-op would ship route HTML with a missing
// static shell or an unreplaced title/description while every test stays green.
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
  return source.replace(pattern, replacement);
};

export const renderSeoHtml = (template: string, route: SeoRoute): string => {
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
  return replaceOrThrow(withHead, '<div id="root"></div>', staticShell, 'root shell');
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
