import { CacheProvider } from '@emotion/react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import createEmotionCache from './createEmotionCache';
import reportWebVitals from './reportWebVitals';
import { clientRouteComponents } from './routeComponents';
import { api } from './services/api';

const container = document.getElementById('root') as HTMLElement;

// Load database items before rendering
api.getDatabaseItems()
  .then(databaseItems => {
    const app = (
      <CacheProvider value={createEmotionCache()}>
        <BrowserRouter>
          <App
            databaseItems={databaseItems}
            routeComponents={clientRouteComponents}
          />
        </BrowserRouter>
      </CacheProvider>
    );

    if (container.dataset.prerendered === 'true') {
      hydrateRoot(container, app);
    } else {
      createRoot(container).render(app);
    }
  })
  .catch((error: unknown) => {
    console.error('Unable to load the game database', error);
  });

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
