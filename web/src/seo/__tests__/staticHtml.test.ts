import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NOT_FOUND_SEO,
  SEO_ROUTES,
  SITE,
  canonicalUrl,
  findSeoRoute,
} from '../config';
import { escapeHtml, renderSeoHtml, sitemapXml } from '../staticHtml';

// The real Vite entry template the build-time plugin rewrites. Reading the
// committed source keeps this coverage honest: if the template's anchors move,
// renderSeoHtml now throws and these tests fail instead of shipping broken HTML.
const INDEX_TEMPLATE = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

describe('renderSeoHtml', () => {
  const home = findSeoRoute('/');

  test('rewrites title and description from the route', () => {
    const html = renderSeoHtml(INDEX_TEMPLATE, home);
    expect(html).toContain(`<title>${escapeHtml(home.title)}</title>`);
    expect(html).toContain(
      `<meta name="description" content="${escapeHtml(home.description)}" data-seo-managed="true" />`
    );
    // The original template title/description must not survive when they differ.
    const analytics = findSeoRoute('/analytics');
    const analyticsHtml = renderSeoHtml(INDEX_TEMPLATE, analytics);
    expect(analyticsHtml).toContain(
      `<title>${escapeHtml(analytics.title)}</title>`
    );
    expect(analyticsHtml).not.toContain(`<title>${escapeHtml(home.title)}</title>`);
  });

  test('injects canonical, robots, and social metadata before </head>', () => {
    const guide = findSeoRoute('/guides/yanwu');
    const html = renderSeoHtml(INDEX_TEMPLATE, guide);
    expect(html).toContain(
      `<link rel="canonical" href="${escapeHtml(canonicalUrl(guide))}" data-seo-managed="true" />`
    );
    expect(html).toContain(
      '<meta name="robots" content="index,follow,max-image-preview:large" data-seo-managed="true" />'
    );
    expect(html).toContain(
      `<meta property="og:title" content="${escapeHtml(guide.title)}" data-seo-managed="true" />`
    );
    // Head injection must land inside <head>, not after </head>.
    expect(html.indexOf('data-seo-managed="true"')).toBeLessThan(
      html.indexOf('</head>')
    );
  });

  test('marks non-index routes noindex', () => {
    const html = renderSeoHtml(INDEX_TEMPLATE, findSeoRoute('/team-builder'));
    expect(html).toContain(
      '<meta name="robots" content="noindex,follow" data-seo-managed="true" />'
    );
  });

  test('replaces the empty root div with a static SEO shell', () => {
    const html = renderSeoHtml(INDEX_TEMPLATE, home);
    expect(html).not.toContain('<div id="root"></div>');
    expect(html).toContain('data-static-seo-shell="true"');
    expect(html).toContain(`<h1>${escapeHtml(home.heading)}</h1>`);
    // Crawlable navigation covers every indexable route.
    SEO_ROUTES.filter((route) => route.index).forEach((route) => {
      expect(html).toContain(
        `<a href="${escapeHtml(route.path)}">${escapeHtml(route.navLabel)}</a>`
      );
    });
  });

  test('emits embeddable, escaped JSON-LD structured data', () => {
    const html = renderSeoHtml(INDEX_TEMPLATE, home);
    const match = html.match(
      /<script type="application\/ld\+json" data-seo-structured-data="true">([\s\S]*?)<\/script>/
    );
    expect(match).not.toBeNull();
    const raw = match![1];
    // Raw `<` inside the script body would prematurely close the tag for a
    // naive HTML parser; the builder escapes it to <.
    expect(raw).not.toContain('<');
    const parsed = JSON.parse(raw.replaceAll('\\u003c', '<'));
    expect(parsed['@context']).toBe('https://schema.org');
  });

  test('renders every configured route and the 404 shell without throwing', () => {
    [...SEO_ROUTES, NOT_FOUND_SEO].forEach((route) => {
      const html = renderSeoHtml(INDEX_TEMPLATE, route);
      expect(html).toContain(`<title>${escapeHtml(route.title)}</title>`);
      expect(html).toContain(`<h1>${escapeHtml(route.heading)}</h1>`);
    });
  });

  test('fails closed when the template is missing an expected anchor', () => {
    const noTitle = INDEX_TEMPLATE.replace(/<title>[\s\S]*?<\/title>/, '');
    expect(() => renderSeoHtml(noTitle, home)).toThrow(/title/);

    const noDescription = INDEX_TEMPLATE.replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
      ''
    );
    expect(() => renderSeoHtml(noDescription, home)).toThrow(/description/);

    const noHead = INDEX_TEMPLATE.replace('</head>', '');
    expect(() => renderSeoHtml(noHead, home)).toThrow(/head/);

    // A reshaped root div (e.g. Vite adds attributes) must abort, not no-op.
    const reshapedRoot = INDEX_TEMPLATE.replace(
      '<div id="root"></div>',
      '<div id="root" data-x></div>'
    );
    expect(() => renderSeoHtml(reshapedRoot, home)).toThrow(/root shell/);
  });
});

describe('sitemapXml', () => {
  test('lists exactly the indexable canonical URLs', () => {
    const xml = sitemapXml();
    const indexed = SEO_ROUTES.filter((route) => route.index);
    indexed.forEach((route) => {
      expect(xml).toContain(`<loc>${escapeHtml(canonicalUrl(route))}</loc>`);
    });
    SEO_ROUTES.filter((route) => !route.index).forEach((route) => {
      expect(xml).not.toContain(`<loc>${escapeHtml(canonicalUrl(route))}</loc>`);
    });
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xml).toContain(SITE.origin);
    expect((xml.match(/<url>/g) ?? []).length).toBe(indexed.length);
  });
});
