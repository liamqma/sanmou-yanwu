const { test, expect } = require('@playwright/test');

const PUBLIC_ROUTES = [
  {
    path: '/',
    title: '三国谋定天下演武配将与战法推荐｜演武参谋',
    heading: '演武配将与战法推荐',
  },
  {
    path: '/analytics',
    title: '三国谋定天下演武数据与武将战法排行｜演武参谋',
    heading: '数据洞察',
  },
  {
    path: '/guides/yanwu',
    title: '三国谋定天下演武武将排行与强队阵容攻略｜演武参谋',
    heading: '三国谋定天下演武武将与阵容指南',
  },
  {
    path: '/contributors',
    title: '三国谋定天下演武战报贡献榜｜演武参谋',
    heading: '战报贡献榜',
  },
  {
    path: '/contribute',
    title: '上传三国谋定天下演武战报｜演武参谋',
    heading: '上传战报',
  },
];

for (const route of PUBLIC_ROUTES) {
  test(`${route.path} exposes indexable route metadata`, async ({ page }) => {
    await page.goto(route.path);

    await expect(page).toHaveTitle(route.title);
    await expect(page.getByRole('heading', { level: 1, name: route.heading }))
      .toBeVisible();
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      /三国谋定天下演武/
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'index,follow,max-image-preview:large'
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `https://sanmou-yanwu.pages.dev${route.path}`
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      'content',
      route.title
    );
    await expect(page.locator('script[data-seo-structured-data]')).toHaveCount(1);
  });
}

test('primary navigation uses crawlable links', async ({ page }) => {
  await page.goto('/');

  const navigation = page.getByRole('navigation', { name: '主要导航' });
  await expect(navigation.getByRole('link', { name: '数据洞察' })).toHaveAttribute(
    'href',
    '/analytics'
  );
  await expect(navigation.getByRole('link', { name: '演武攻略' })).toHaveAttribute(
    'href',
    '/guides/yanwu'
  );
  await expect(navigation.getByRole('link', { name: '上传战报' })).toHaveAttribute(
    'href',
    '/contribute'
  );
});

test('state-dependent and missing routes are not indexable', async ({ page }) => {
  await page.goto('/team-builder');
  await expect(page).toHaveTitle('三国谋定天下演武三队编排｜演武参谋');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex,follow'
  );

  await page.goto('/not-a-page');
  await expect(page).toHaveTitle('页面未找到｜演武参谋');
  await expect(page.getByRole('heading', { level: 1, name: '页面未找到' }))
    .toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex,follow'
  );
});
