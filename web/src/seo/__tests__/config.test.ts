import {
  NOT_FOUND_SEO,
  SEO_ROUTES,
  SITE,
  buildStructuredData,
  canonicalUrl,
  findSeoRoute,
} from '../config';

describe('SEO route configuration', () => {
  test('uses the primary public domain for absolute metadata URLs', () => {
    expect(SITE.origin).toBe('https://sanmouyanwu.com');
  });

  test('uses unique route paths and titles', () => {
    expect(new Set(SEO_ROUTES.map((route) => route.path)).size).toBe(
      SEO_ROUTES.length
    );
    expect(new Set(SEO_ROUTES.map((route) => route.title)).size).toBe(
      SEO_ROUTES.length
    );
  });

  test('normalizes trailing slashes and falls back to noindex metadata', () => {
    expect(findSeoRoute('/guides/yanwu/').path).toBe('/guides/yanwu');
    expect(findSeoRoute('/missing')).toEqual(NOT_FOUND_SEO);
    expect(NOT_FOUND_SEO.index).toBe(false);
  });

  test('keeps the state-dependent team builder out of search results', () => {
    expect(findSeoRoute('/team-builder').index).toBe(false);
    expect(SEO_ROUTES.filter((route) => route.index)).not.toContainEqual(
      expect.objectContaining({ path: '/team-builder' })
    );
  });

  test('builds absolute canonical URLs and page schema', () => {
    const route = findSeoRoute('/guides/yanwu');
    const canonical = canonicalUrl(route);
    const structuredData = buildStructuredData(route);

    expect(canonical).toBe(`${SITE.origin}/guides/yanwu`);
    expect(structuredData).toEqual(
      expect.objectContaining({
        '@context': 'https://schema.org',
        '@graph': expect.arrayContaining([
          expect.objectContaining({
            '@type': 'WebPage',
            url: canonical,
          }),
          expect.objectContaining({
            '@type': 'BreadcrumbList',
          }),
        ]),
      })
    );
  });
});
