const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const database = require('../public/game-data/database.json');

const PRERENDERED_ROUTES = [
  ['/', '演武配将与战法推荐'],
  ['/analytics', '数据洞察'],
  ['/guides/yanwu', '三国谋定天下演武武将、战法与阵容指南'],
  ['/contributors', '战报贡献榜'],
  ['/contribute', '上传战报'],
  ['/team-builder', '队伍策案'],
  ['/404.html', '页面未找到'],
];

test('production HTML contains the real route content and critical styles', async ({
  request,
}) => {
  for (const [path, heading] of PRERENDERED_ROUTES) {
    const response = await request.get(path);
    expect(response.ok(), `${path} should return HTML`).toBe(true);
    const html = await response.text();

    expect(html).toContain('<div id="root" data-prerendered="true">');
    expect(html).toContain('<h1');
    expect(html).toContain(heading);
    expect(html).toContain('data-emotion=');
    expect(html).toContain('data-hydration-curtain-styles="true"');
    expect(html).toContain('data-hydration-curtain-bootstrap="true"');
    expect(html).toContain('data-hydration-root-guard="true"');
    expect(html).toContain('<meta name="theme-color" content="#f3efe3"');
    expect(html).toContain(
      '<div data-hydration-curtain="true" role="status"'
    );
    expect(html).toContain('https://sanmouyanwu.com');
    expect(html).not.toContain('sanmou-yanwu.pages.dev');
    expect(html).not.toContain('data-static-seo-shell');
    expect(html).not.toContain('aria-label="正在载入页面"');
  }
});

test('installable startup shell uses the same light palette', async ({ request }) => {
  const response = await request.get('/manifest.json');
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.theme_color).toBe('#f3efe3');
  expect(manifest.background_color).toBe('#f3efe3');
});

test('robots.txt advertises the primary-domain sitemap', async ({
  request,
}) => {
  const response = await request.get('/robots.txt');
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain(
    'Sitemap: https://sanmouyanwu.com/sitemap.xml'
  );
});

test.describe('with JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false });

  for (const [path, heading] of PRERENDERED_ROUTES) {
    test(`${path} keeps its page content visible`, async ({ page }) => {
      await page.goto(path);

      await expect(
        page.getByRole('heading', { level: 1, name: heading })
      ).toBeVisible();
      await expect(page.locator('#root[data-prerendered="true"]')).toBeVisible();
      await expect(page.locator('[data-hydration-curtain="true"]')).toBeHidden();
      await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
      await expect(page.locator('#root')).not.toHaveAttribute(
        'aria-busy',
        'true'
      );
      await expect(page.locator('html')).not.toHaveAttribute(
        'data-app-hydration',
        'pending'
      );
      await expect(page.getByLabel('正在载入页面')).toHaveCount(0);
    });
  }

  test('content-rich routes expose more than a heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('combobox', { name: '当前赛季' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '初始武将 (0/4)' }))
      .toBeVisible();

    await page.goto('/analytics');
    await expect(
      page.getByRole('heading', { name: '历史战报分析' })
    ).toBeVisible();
    await expect(page.getByText(/已记录的 \d+ 场对局/)).toBeVisible();

    await page.goto('/guides/yanwu');
    await expect(page.getByRole('heading', { name: '强队阵容' })).toBeVisible();
    await expect(page.getByText(/飞将吕布/)).toBeVisible();
  });
});

test('the curtain masks hydration without hiding the prerendered root', async ({
  page,
}) => {
  let releaseBundle;
  const bundleGate = new Promise((resolve) => {
    releaseBundle = resolve;
  });
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    await bundleGate;
    await route.continue();
  });

  await page.goto('/', { waitUntil: 'commit' });
  try {
    await expect(page.locator('html')).toHaveAttribute(
      'data-app-hydration',
      'pending'
    );
    await expect(page.locator('[data-hydration-curtain="true"]')).toBeVisible();
    await expect(page.locator('.hydration-curtain__mark')).toHaveText('谋');
    await expect(page.locator('#root')).toHaveAttribute('inert', '');
    await expect(page.locator('#root')).toHaveAttribute('aria-busy', 'true');
    await expect(
      page.locator('#root h1').filter({ hasText: '演武配将与战法推荐' })
    ).toBeVisible();
    const rootPresentation = await page.locator('#root').evaluate((root) => {
      const style = window.getComputedStyle(root);
      return {
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
      };
    });
    expect(rootPresentation.display).not.toBe('none');
    expect(rootPresentation.visibility).toBe('visible');
    expect(rootPresentation.opacity).toBe('1');
    const curtainPresentation = await page
      .locator('[data-hydration-curtain="true"]')
      .evaluate((curtain) => {
        const style = window.getComputedStyle(curtain);
        return {
          backgroundColor: style.backgroundColor,
          color: style.color,
        };
      });
    expect(curtainPresentation).toEqual({
      backgroundColor: 'rgb(243, 239, 227)',
      color: 'rgb(29, 36, 33)',
    });
    if (process.env.VISUAL_AUDIT_OUTPUT) {
      mkdirSync(process.env.VISUAL_AUDIT_OUTPUT, { recursive: true });
      await page.screenshot({
        path: path.join(
          process.env.VISUAL_AUDIT_OUTPUT,
          'desktop--hydration-loading.png'
        ),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: path.join(
          process.env.VISUAL_AUDIT_OUTPUT,
          'mobile--hydration-loading.png'
        ),
        fullPage: true,
      });
    }
  } finally {
    releaseBundle();
  }

  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('html')).toHaveAttribute(
    'data-app-hydration',
    'ready'
  );
  await expect(page.locator('[data-hydration-curtain="true"]')).toBeHidden();
  await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', 'true');
});

test('the curtain waits for a directly loaded lazy route', async ({ page }) => {
  let releaseRouteChunk;
  const routeChunkGate = new Promise((resolve) => {
    releaseRouteChunk = resolve;
  });
  await page.route(/\/assets\/Analytics-[^/]+\.js$/, async (route) => {
    await routeChunkGate;
    await route.continue();
  });

  await page.goto('/analytics', { waitUntil: 'commit' });
  try {
    await expect(page.locator('html')).toHaveAttribute(
      'data-app-hydration',
      'pending'
    );
    await expect(page.locator('[data-hydration-curtain="true"]')).toBeVisible();
    await expect(page.locator('#root')).toHaveAttribute('inert', '');
    await expect(
      page.locator('#root h1').filter({ hasText: '数据洞察' })
    ).toBeVisible();
  } finally {
    releaseRouteChunk();
  }

  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('html')).toHaveAttribute(
    'data-app-hydration',
    'ready'
  );
  await expect(page.locator('[data-hydration-curtain="true"]')).toBeHidden();
  await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
});

test('the curtain clears only after saved progress is restored', async ({
  page,
}) => {
  const storedProgress = JSON.stringify({
    version: 1,
    gameState: {
      current_heroes: Object.keys(database.heroes).slice(0, 4),
      current_skills: Object.keys(database.skills).slice(0, 8),
      support_hero: null,
      support_skills: [],
      round_number: 1,
      round_history: [],
    },
    currentRoundInputs: {
      set1: [],
      set2: [],
      set3: [],
    },
  });
  await page.addInitScript((progress) => {
    localStorage.setItem('gameProgress', progress);
    window.__hydrationReadySnapshot = null;
    const observer = new MutationObserver(() => {
      if (
        window.__hydrationReadySnapshot !== null ||
        document.documentElement.getAttribute('data-app-hydration') !== 'ready'
      ) {
        return;
      }
      window.__hydrationReadySnapshot = {
        restoredRoundVisible: document.body.textContent.includes(
          '第 1 轮：选择武将'
        ),
        defaultSetupVisible: document.body.textContent.includes(
          '初始武将 (0/4)'
        ),
        rootInert: document.getElementById('root').hasAttribute('inert'),
      };
      observer.disconnect();
    });
    observer.observe(document, {
      attributes: true,
      childList: true,
      subtree: true,
    });
  }, storedProgress);

  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute(
    'data-app-hydration',
    'ready'
  );
  expect(await page.evaluate(() => window.__hydrationReadySnapshot)).toEqual({
    restoredRoundVisible: true,
    defaultSetupVisible: false,
    rootInert: false,
  });
  await expect(
    page.getByRole('heading', { level: 1, name: '第 1 轮：选择武将' })
  ).toBeVisible();
});

test('the curtain fails open when the client bundle cannot start', async ({
  page,
}) => {
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    await route.abort();
  });

  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute(
    'data-app-hydration',
    'pending'
  );
  await expect(page.locator('[data-hydration-curtain="true"]')).toBeVisible();

  await expect(page.locator('html')).not.toHaveAttribute(
    'data-app-hydration',
    'pending',
    { timeout: 7000 }
  );
  await expect(page.locator('[data-hydration-curtain="true"]')).toBeHidden();
  await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', 'true');
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: '演武配将与战法推荐',
    })
  ).toBeVisible();
});

test('hydrates without replacing content and client navigation still works', async ({
  page,
}) => {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute(
    'data-app-hydration',
    'ready'
  );
  await expect(page.locator('[data-hydration-curtain="true"]')).toBeHidden();
  await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', 'true');
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: '演武配将与战法推荐',
    })
  ).toBeVisible();

  await page.getByRole('link', { name: '演武攻略' }).click();
  await expect(page).toHaveURL(/\/guides\/yanwu$/);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: '三国谋定天下演武武将、战法与阵容指南',
    })
  ).toBeVisible();

  expect(
    errors.filter((message) => /hydration|did not match|server rendered/i.test(message))
  ).toEqual([]);
});
