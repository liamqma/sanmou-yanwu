import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RouteSeo from '../RouteSeo';
import { SITE, findSeoRoute } from '../config';

const renderRouteSeo = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <RouteSeo />
    </MemoryRouter>
  );

afterEach(() => {
  cleanup();
  document.head.innerHTML = '';
  document.title = '';
});

describe('RouteSeo', () => {
  test('writes canonical, social, robots, and structured metadata', async () => {
    const route = findSeoRoute('/guides/yanwu');
    renderRouteSeo(route.path);

    await waitFor(() => expect(document.title).toBe(route.title));
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
      'content',
      route.description
    );
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'index,follow,max-image-preview:large'
    );
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${SITE.origin}${route.path}`
    );
    expect(document.querySelector('meta[property="og:title"]')).toHaveAttribute(
      'content',
      route.title
    );
    expect(
      document.querySelector('meta[name="twitter:card"]')
    ).toHaveAttribute('content', 'summary');

    const structuredData = JSON.parse(
      document.querySelector('script[data-seo-structured-data]')
        ?.textContent ?? '{}'
    );
    expect(structuredData['@graph']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ '@type': 'WebPage' }),
        expect.objectContaining({ '@type': 'BreadcrumbList' }),
      ])
    );
  });

  test('marks state-only and unknown pages as noindex', async () => {
    renderRouteSeo('/team-builder');
    await waitFor(() =>
      expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
        'content',
        'noindex,follow'
      )
    );

    cleanup();
    renderRouteSeo('/not-a-page');
    await waitFor(() => expect(document.title).toBe('页面未找到｜演武参谋'));
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex,follow'
    );
  });
});
