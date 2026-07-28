import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  SITE,
  buildStructuredData,
  canonicalUrl,
  findSeoRoute,
  socialImageUrl,
} from './config';

const MANAGED_ATTRIBUTE = 'data-seo-managed';

const upsertMeta = (
  selector: string,
  attributes: Record<string, string>
) => {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(MANAGED_ATTRIBUTE, 'true');
    document.head.appendChild(element);
  }
  Object.entries(attributes).forEach(([name, value]) => {
    element?.setAttribute(name, value);
  });
};

const upsertCanonical = (href: string) => {
  let element = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]'
  );
  if (!element) {
    element = document.createElement('link');
    element.rel = 'canonical';
    element.setAttribute(MANAGED_ATTRIBUTE, 'true');
    document.head.appendChild(element);
  }
  element.href = href;
};

const upsertStructuredData = (value: Record<string, unknown>) => {
  let element = document.head.querySelector<HTMLScriptElement>(
    'script[data-seo-structured-data]'
  );
  if (!element) {
    element = document.createElement('script');
    element.type = 'application/ld+json';
    element.setAttribute('data-seo-structured-data', 'true');
    document.head.appendChild(element);
  }
  element.textContent = JSON.stringify(value);
};

const RouteSeo = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    const route = findSeoRoute(pathname);
    const canonical = canonicalUrl(route);
    const image = socialImageUrl();
    const robots = route.index
      ? 'index,follow,max-image-preview:large'
      : 'noindex,follow';

    document.title = route.title;
    upsertMeta('meta[name="description"]', {
      name: 'description',
      content: route.description,
    });
    upsertMeta('meta[name="robots"]', { name: 'robots', content: robots });
    upsertMeta('meta[property="og:type"]', {
      property: 'og:type',
      content: route.ogType,
    });
    upsertMeta('meta[property="og:site_name"]', {
      property: 'og:site_name',
      content: SITE.name,
    });
    upsertMeta('meta[property="og:locale"]', {
      property: 'og:locale',
      content: SITE.locale,
    });
    upsertMeta('meta[property="og:title"]', {
      property: 'og:title',
      content: route.title,
    });
    upsertMeta('meta[property="og:description"]', {
      property: 'og:description',
      content: route.description,
    });
    upsertMeta('meta[property="og:url"]', {
      property: 'og:url',
      content: canonical,
    });
    upsertMeta('meta[property="og:image"]', {
      property: 'og:image',
      content: image,
    });
    upsertMeta('meta[property="og:image:alt"]', {
      property: 'og:image:alt',
      content: `${SITE.name}标志`,
    });
    upsertMeta('meta[name="twitter:card"]', {
      name: 'twitter:card',
      content: 'summary',
    });
    upsertMeta('meta[name="twitter:title"]', {
      name: 'twitter:title',
      content: route.title,
    });
    upsertMeta('meta[name="twitter:description"]', {
      name: 'twitter:description',
      content: route.description,
    });
    upsertMeta('meta[name="twitter:image"]', {
      name: 'twitter:image',
      content: image,
    });
    upsertCanonical(canonical);
    upsertStructuredData(buildStructuredData(route));
  }, [pathname]);

  return null;
};

export default RouteSeo;
