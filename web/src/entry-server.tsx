import { CacheProvider } from '@emotion/react';
import createEmotionServer from '@emotion/server/create-instance';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import App from './App';
import createEmotionCache from './createEmotionCache';
import Analytics from './pages/Analytics';
import Contribute from './pages/Contribute';
import Contributors from './pages/Contributors';
import NotFound from './pages/NotFound';
import YanwuGuide from './pages/YanwuGuide';
import type { RouteComponents } from './routeComponents';
import { api } from './services/api';
import {
  NOT_FOUND_SEO,
  SEO_ROUTES,
  type SeoRoute,
} from './seo/config';
export { renderSeoHtml, sitemapXml } from './seo/staticHtml';

export const routesToPrerender: readonly SeoRoute[] = [
  ...SEO_ROUTES,
  NOT_FOUND_SEO,
];

export interface PrerenderedRoute {
  route: SeoRoute;
  appHtml: string;
  emotionCss: string;
}

const routeComponents: RouteComponents = {
  Analytics,
  Contribute,
  Contributors,
  YanwuGuide,
  NotFound,
};

export const renderRoute = async (
  route: SeoRoute
): Promise<PrerenderedRoute> => {
  const databaseItems = await api.getDatabaseItems();
  const cache = createEmotionCache();
  const { extractCriticalToChunks, constructStyleTagsFromChunks } =
    createEmotionServer(cache);
  const appHtml = renderToString(
    <CacheProvider value={cache}>
      <StaticRouter location={route.path}>
        <App
          databaseItems={databaseItems}
          routeComponents={routeComponents}
        />
      </StaticRouter>
    </CacheProvider>
  );
  const emotionCss = constructStyleTagsFromChunks(
    extractCriticalToChunks(appHtml)
  );

  return {
    route,
    appHtml,
    emotionCss,
  };
};
