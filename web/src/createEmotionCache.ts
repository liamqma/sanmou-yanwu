import createCache from '@emotion/cache';

// The server and browser must use the same Emotion cache key so React can
// hydrate MUI's critical styles without briefly showing an unstyled page.
const createEmotionCache = () =>
  createCache({
    key: 'mui',
    prepend: true,
  });

export default createEmotionCache;
