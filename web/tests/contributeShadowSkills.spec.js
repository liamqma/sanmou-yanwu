const { test, expect } = require('@playwright/test');

async function selectAutocomplete(page, label, optionName) {
  const input = page.getByLabel(label);
  await input.fill(optionName);
  const option = page.getByRole('option', { name: optionName, exact: true });
  await expect(option).toBeVisible();
  await option.click();
  await expect(input).toHaveValue(optionName);
}

test('allows a hero signature skill to be carried by a teammate', async ({
  page,
}) => {
  await page.goto('/contribute');
  await expect(
    page.getByRole('heading', { level: 1, name: '上传战报' })
  ).toBeVisible({ timeout: 30000 });

  await selectAutocomplete(page, '阵容 1 第 1 位武将', '袁绍');
  await selectAutocomplete(page, '阵容 1 第 2 位武将', '曹操');
  await selectAutocomplete(
    page,
    '阵容 1 第 2 位携带战法 1',
    '合聚群雄'
  );
});

test('allows a hero to carry its own signature skill', async ({ page }) => {
  await page.goto('/contribute');
  await expect(
    page.getByRole('heading', { level: 1, name: '上传战报' })
  ).toBeVisible({ timeout: 30000 });

  await selectAutocomplete(page, '阵容 1 第 1 位武将', '袁绍');
  await selectAutocomplete(
    page,
    '阵容 1 第 1 位携带战法 1',
    '合聚群雄'
  );
});
