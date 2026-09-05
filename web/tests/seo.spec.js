const { test, expect } = require('@playwright/test');

const PUBLIC_ROUTES = [
  {
    path: '/',
    title: '三国谋定天下演武配将与战法推荐｜演武参谋',
    heading: '演武配将与战法推荐',
  },
  {
    path: '/daily-yanwu',
    title: '三国谋定天下每天演武｜演武参谋',
    heading: '每天演武',
  },
  {
    path: '/analytics',
    title: '三国谋定天下演武数据与武将战法排行｜演武参谋',
    heading: '数据洞察',
  },
  {
    path: '/guides/yanwu',
    title: '三国谋定天下演武武将战法排行与强队攻略｜演武参谋',
    heading: '三国谋定天下演武武将、战法与阵容指南',
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
      `https://sanmouyanwu.com${route.path}`
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
  await expect(navigation.getByRole('link', { name: '每天演武' })).toHaveCount(0);
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

test('current roster relationships keep the team builder URL and are not indexable', async ({ page }) => {
  await page.goto('/team-builder');
  await expect(page).toHaveURL(/\/team-builder$/);
  await expect(page).toHaveTitle('当前阵容武将战法关系｜演武参谋');
  await expect(page.getByRole('heading', { level: 1, name: '当前阵容关系' }))
    .toBeVisible();
  await expect(page.getByText('旧版队伍推荐已暂停')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex,follow'
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://sanmouyanwu.com/team-builder'
  );
});

test('missing routes are not indexable', async ({ page }) => {
  await page.goto('/not-a-page');
  await expect(page).toHaveTitle('页面未找到｜演武参谋');
  await expect(page.getByRole('heading', { level: 1, name: '页面未找到' }))
    .toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex,follow'
  );
});
