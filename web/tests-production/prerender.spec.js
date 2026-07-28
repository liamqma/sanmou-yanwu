const { test, expect } = require('@playwright/test');

const PRERENDERED_ROUTES = [
  ['/', '演武配将与战法推荐'],
  ['/analytics', '数据洞察'],
  ['/guides/yanwu', '三国谋定天下演武武将与阵容指南'],
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
    expect(html).toContain('https://sanmouyanwu.com');
    expect(html).not.toContain('sanmou-yanwu.pages.dev');
    expect(html).not.toContain('data-static-seo-shell');
    expect(html).not.toContain('aria-label="正在载入页面"');
  }
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
    await expect(page.getByText(/已记录的 2819 场对局/)).toBeVisible();

    await page.goto('/guides/yanwu');
    await expect(page.getByRole('heading', { name: '强队阵容' })).toBeVisible();
    await expect(page.getByText(/三谋吕布/)).toBeVisible();
  });
});

test('the real homepage is visible before the client bundle loads', async ({
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
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: '演武配将与战法推荐',
      })
    ).toBeVisible();
    await expect(page.getByRole('combobox', { name: '当前赛季' })).toBeVisible();
  } finally {
    releaseBundle();
  }

  await page.waitForLoadState('domcontentloaded');
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
      name: '三国谋定天下演武武将与阵容指南',
    })
  ).toBeVisible();

  expect(
    errors.filter((message) => /hydration|did not match|server rendered/i.test(message))
  ).toEqual([]);
});
