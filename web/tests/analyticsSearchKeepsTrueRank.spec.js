const { test, expect } = require('@playwright/test');
const recommendationData = require('../src/recommendation_data.json');
const database = require('../public/game-data/database.json');

// Evidence-producing e2e for the 排名 (rank) fix on /analytics.
//
// Bug: applying a hero/skill search filter renumbered the 排名 column starting at
// 1 for the surviving rows. Fix: rank is looked up from the *full* (unfiltered)
// ordering, so a filtered row keeps its true position. This spec exercises all
// six 排名 tables — for each it (1) records the full-list rank of every row, then
// (2) applies a filter and asserts each surviving row still shows its true rank
// (never renumbered to 1..n). The individual and usage tables retain their
// original contract; the unified relationship panel is checked in representative
// HP and HS modes here and all six modes in analyticsRelationships.spec.js.
// Screenshots remain in Playwright's per-test output directory for visual review.

// Locate a ranking table by its ScrollableAnalyticsTable aria-label region.
const region = (page, label) =>
  page.getByRole('region', { name: `${label}表格，可滚动` });

// Read [{ rank, key }] for every body row, with a table-specific key extractor.
async function readRows(page, label, keyOf) {
  const rows = region(page, label).locator('tbody tr');
  const n = await rows.count();
  const out = [];
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const rankText = (await row.locator('td').first().innerText()).trim();
    out.push({ rank: Number(rankText), key: await keyOf(row) });
  }
  return out;
}

// Key extractors per table.
const firstChip = async (row) => (await row.locator('td').nth(1).innerText()).trim();
const stripShadow = (s) => s.replace(/^影 · /, '');
const skillKey = async (row) => stripShadow(await firstChip(row));
const pairKey = async (row) => {
  const chips = row.locator('td').nth(1).locator('.MuiChip-label');
  const names = await chips.allInnerTexts();
  return names.map((s) => s.trim()).join(' + ');
};
const heroSkillKey = async (row) => {
  const chips = row.locator('td').nth(1).locator('.MuiChip-label');
  const [hero, skill] = await chips.allInnerTexts();
  return `${hero.trim()} · ${skill.trim()}`;
};

async function addFilter(page, placeholder, typed, optionText) {
  const input = page.getByPlaceholder(placeholder);
  await input.click();
  await input.fill(typed);
  await page.getByRole('option').filter({ hasText: optionText }).first().click();
}

const HERO_PH = '输入武将名或拼音...';
const SKILL_PH = '输入战法名或拼音...';

function relationshipRankMap(family, keyOfFeature) {
  return new Map(
    Object.entries(recommendationData.model.weights)
      .filter(([featureId]) => featureId.startsWith(`${family}|`))
      .sort(([leftId, leftWeight], [rightId, rightWeight]) =>
        rightWeight - leftWeight || (leftId < rightId ? -1 : leftId > rightId ? 1 : 0)
      )
      .map(([featureId], index) => [keyOfFeature(featureId.split('|').slice(1)), index + 1])
  );
}

const heroPairRanks = relationshipRankMap('HP', (parts) => parts.join(' + '));
const heroSkillRanks = relationshipRankMap(
  'HS',
  ([hero, skill]) => `${hero} · ${skill}`
);

function expectedModelRanking(family, prefix) {
  return recommendationData.analytics[family]
    .map((row) => ({
      name: row.name,
      total: row.total,
      shadowTotal: row.shadow_total ?? 0,
      weight: recommendationData.model.weights[`${prefix}|${row.name}`] ?? 0,
    }))
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        b.total - a.total ||
        a.name.localeCompare(b.name, 'zh-Hans-CN')
    );
}

async function expectDescendingModelWeights(
  page,
  label,
  expectedRows,
  normalizeName = (name) => name
) {
  const tableRegion = region(page, label);
  await expect(tableRegion).toBeVisible();
  await expect(
    tableRegion.getByRole('columnheader', { name: '模型权重', exact: true })
  ).toBeVisible();
  await expect(
    tableRegion.getByRole('columnheader', { name: '胜率参考', exact: true })
  ).toHaveCount(0);
  await expect(
    tableRegion.getByRole('columnheader', { name: '参考场次', exact: true })
  ).toBeVisible();

  const rows = tableRegion.locator('tbody tr');
  const names = (await rows.locator('td:nth-child(2)').allInnerTexts()).map((name) =>
    normalizeName(name.trim())
  );
  const displayedWeights = (
    await rows.locator('td:nth-child(3)').allInnerTexts()
  ).map((text) => {
    expect(text.trim()).toMatch(/^[+-]?\d+\.\d{4}$/);
    return Number(text.trim());
  });
  const displayedTotals = (await rows.locator('td:nth-child(4)').allInnerTexts()).map(
    (text) => Number(text.trim())
  );

  expect(names).toEqual(expectedRows.map((row) => row.name));
  expect(displayedWeights).toEqual(expectedRows.map((row) => Number(row.weight.toFixed(4))));
  expect(displayedTotals).toEqual(expectedRows.map((row) => row.total));
  expect(
    expectedRows.every(
      (row, index) => index === 0 || expectedRows[index - 1].weight >= row.weight
    )
  ).toBe(true);
}

test('全部武将 / 全部战法 show model weights from high to low without win rates', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 1200 });
  await page.goto('/analytics');

  await expect(
    page.getByRole('heading', { name: '全部武将（按模型权重排序）', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '全部战法（按模型权重排序）', exact: true })
  ).toBeVisible();
  await expect(page.locator('body')).not.toContainText('胜率');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /模型权重/);
  await expect(page.locator('meta[name="description"]')).not.toHaveAttribute('content', /胜率/);

  const expectedHeroes = expectedModelRanking('heroes', 'H');
  const expectedSkills = expectedModelRanking('skills', 'S');
  await expectDescendingModelWeights(page, '全部武将排名', expectedHeroes);
  await expectDescendingModelWeights(
    page,
    '全部战法排名',
    expectedSkills,
    stripShadow
  );

  const skillLabels = await region(page, '全部战法排名')
    .locator('tbody tr td:nth-child(2)')
    .allInnerTexts();
  expect(skillLabels).toEqual(
    expectedSkills.map((row) =>
      row.shadowTotal > 0 || database.skills[row.name]?.shadow === true
        ? `影 · ${row.name}`
        : row.name
    )
  );

  const cardFor = (heading) =>
    heading.locator('xpath=ancestor::*[contains(@class,"MuiCard-root")][1]');
  await cardFor(
    page.getByRole('heading', { name: '全部武将（按模型权重排序）', exact: true })
  ).screenshot({ path: testInfo.outputPath('analytics-model-weight-heroes.png') });
  await cardFor(
    page.getByRole('heading', { name: '全部战法（按模型权重排序）', exact: true })
  ).screenshot({ path: testInfo.outputPath('analytics-model-weight-skills.png') });
});

// For a table: read the full ordering, pick a target row whose true rank > 1,
// apply the given filter, then assert every surviving row keeps its full-list
// rank (and specifically that the target's true rank is shown, not 1).
async function verifyTableKeepsTrueRank(page, testInfo, {
  label,
  keyOf,
  filter,
  screenshot,
  prepare,
  rankOf,
}) {
  await page.goto('/analytics');
  if (prepare) await prepare(page);
  await expect(region(page, label)).toBeVisible();

  const full = await readRows(page, label, keyOf);
  expect(full.length).toBeGreaterThan(3);
  const fullRank = new Map(full.map((r) => [r.key, r.rank]));
  // Full ordering must be a clean 1..n so "restart at 1" is the only failure mode.
  full.forEach((r, i) => expect(r.rank).toBe(i + 1));

  // Pick a mid-list target (rank clearly > 1) to filter down to.
  const target = full[Math.min(4, full.length - 1)];
  expect(target.rank).toBeGreaterThan(1);

  await filter(page, target);

  const filtered = await readRows(page, label, keyOf);
  expect(filtered.length).toBeGreaterThan(0);
  // The fix: each surviving row shows its true (full-list) rank, not a 1..n restart.
  for (const r of filtered) {
    const expectedRank = fullRank.get(r.key) ?? rankOf?.(r.key);
    expect(r.rank, `row ${r.key} in ${label}`).toBe(expectedRank);
  }
  // The target survived and shows its real rank (which is > 1) — the exact regression.
  const shown = filtered.find((r) => r.key === target.key);
  expect(shown, `target ${target.key} present after filter`).toBeTruthy();
  expect(shown.rank).toBe(target.rank);

  const card = region(page, label).locator('xpath=ancestor::*[contains(@class,"MuiCard-root")][1]');
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: testInfo.outputPath(screenshot) });
  return { target, filtered };
}

test('全部武将 / 全部战法 keep true 排名 under a search filter', async ({ page }, testInfo) => {
  const hero = await verifyTableKeepsTrueRank(page, testInfo, {
    label: '全部武将排名',
    keyOf: firstChip,
    filter: (p, t) => addFilter(p, HERO_PH, t.key, t.key),
    screenshot: 'analytics-rank-heroes.png',
  });
  // A single mid-ranked hero -> exactly one row, showing its true rank (> 1).
  expect(hero.filtered.length).toBe(1);
  expect(hero.filtered[0].rank).toBe(hero.target.rank);

  const skill = await verifyTableKeepsTrueRank(page, testInfo, {
    label: '全部战法排名',
    keyOf: skillKey,
    filter: (p, t) => addFilter(p, SKILL_PH, t.key, t.key),
    screenshot: 'analytics-rank-skills.png',
  });
  expect(skill.filtered.length).toBe(1);
  expect(skill.filtered[0].rank).toBe(skill.target.rank);
});

test('武将使用排行 / 战法使用排行 keep true 排名 under a search filter', async ({ page }, testInfo) => {
  await verifyTableKeepsTrueRank(page, testInfo, {
    label: '武将使用排行',
    keyOf: firstChip,
    filter: (p, t) => addFilter(p, HERO_PH, t.key, t.key),
    screenshot: 'analytics-rank-hero-usage.png',
  });
  await verifyTableKeepsTrueRank(page, testInfo, {
    label: '战法使用排行',
    keyOf: skillKey,
    filter: (p, t) => addFilter(p, SKILL_PH, t.key, t.key),
    screenshot: 'analytics-rank-skill-usage.png',
  });
});

test('unified HP / HS relationship modes keep true 排名 under a search filter', async ({ page }, testInfo) => {
  // HP: filter by one hero of the target pair; surviving rows retain full-list ranks.
  await verifyTableKeepsTrueRank(page, testInfo, {
    label: '两人同队关系排名',
    keyOf: pairKey,
    filter: (p, t) => {
      const hero = t.key.split(' + ')[0];
      return addFilter(p, HERO_PH, hero, hero);
    },
    rankOf: (key) => heroPairRanks.get(key),
    screenshot: 'analytics-rank-hero-pairs.png',
  });
  // HS: enter 战法搭配, then filter by the target's encoded hero.
  await verifyTableKeepsTrueRank(page, testInfo, {
    label: '自己携带关系排名',
    keyOf: heroSkillKey,
    prepare: (p) => p
      .getByTestId('relationship-ranking-panel')
      .getByRole('button', { name: '战法搭配', exact: true })
      .click(),
    filter: (p, t) => {
      const hero = t.key.split(' · ')[0];
      return addFilter(p, HERO_PH, hero, hero);
    },
    rankOf: (key) => heroSkillRanks.get(key),
    screenshot: 'analytics-rank-hero-skills.png',
  });
});
