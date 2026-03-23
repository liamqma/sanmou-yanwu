import { defineConfig } from 'vite';
import path from 'path';
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
    // Serve /data/* from local web/src/ for fast H5 dev
    proxy: {
      '/data': {
        target: 'http://localhost:__unused__',
        bypass(req, res) {
          const fileName = req.url.replace('/data/', '');
          const filePath = path.resolve(__dirname, '..', 'web', 'src', fileName);
          const fs = require('fs');
          if (fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'application/json');
            res.end(fs.readFileSync(filePath));
            return;
          }
        },
      },
    },
  },
});
