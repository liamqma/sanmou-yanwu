import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';

export default defineConfig({
  plugins: [uni()],
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
        silenceDeprecations: ['import', 'legacy-js-api'],
      },
    },
  },
  server: {
    proxy: {
      '/data': {
        target: 'https://gitee.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/data/, '/liamqma/sanmou/raw/master/web/src'),
        headers: {
          Referer: 'https://gitee.com/',
        },
      },
    },
  },
});
