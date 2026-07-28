import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clientOutDir = resolve(webRoot, 'build');
const serverOutDir = resolve(webRoot, '.ssr-build');
const serverEntry = resolve(webRoot, 'src/entry-server.tsx');
const serverBundle = resolve(serverOutDir, 'entry-server.mjs');
const viteConfig = resolve(webRoot, 'vite.config.js');

const outputPathFor = (route) => {
  if (route.path === '/') return resolve(clientOutDir, 'index.html');
  if (route.path === '/404') return resolve(clientOutDir, '404.html');
  return resolve(clientOutDir, `${route.path.slice(1)}.html`);
};

try {
  await build({
    root: webRoot,
    configFile: viteConfig,
  });

  await build({
    root: webRoot,
    configFile: viteConfig,
    build: {
      ssr: serverEntry,
      outDir: serverOutDir,
      emptyOutDir: true,
      copyPublicDir: false,
      rollupOptions: {
        output: {
          entryFileNames: 'entry-server.mjs',
          chunkFileNames: 'chunks/[name]-[hash].mjs',
        },
      },
    },
  });

  const server = await import(pathToFileURL(serverBundle).href);
  const template = await readFile(
    resolve(clientOutDir, 'index.html'),
    'utf8'
  );

  for (const route of server.routesToPrerender) {
    const prerendered = await server.renderRoute(route);
    const outputPath = outputPathFor(route);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      server.renderSeoHtml(
        template,
        prerendered.route,
        prerendered.appHtml,
        prerendered.emotionCss
      )
    );
  }

  await writeFile(
    resolve(clientOutDir, 'sitemap.xml'),
    server.sitemapXml()
  );
} finally {
  await rm(serverOutDir, { recursive: true, force: true });
}
