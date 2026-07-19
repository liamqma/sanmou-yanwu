const { test, expect } = require('@playwright/test');

// Evidence-producing e2e for the 排名 (rank) fix on /analytics.
//
// Bug: applying a hero/skill search filter renumbered the 排名 column starting at
// 1 for the surviving rows. Fix: rank is looked up from the *full* (unfiltered)
// ordering, so a filtered row keeps its true position. This spec exercises all
// six 排名 tables — for each it (1) records the full-list rank of every row, then
// (2) applies a filter and asserts each surviving row still shows its true rank
// (never renumbered to 1..n). It also captures screenshots for visual review.
const EVIDENCE_DIR =
  '/var/folders/3m/5ph4vvm12v98v0h7m6p0dmwm0000gn/T/no-mistakes-evidence/01KXVWZ55AJHR68TTDBNJQ4RKK';

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
  const hero = (await row.locator('td').nth(1).innerText()).trim();
  const skill = (await row.locator('td').nth(2).innerText()).trim();
  return `${hero} · ${skill}`;
};

async function addFilter(page, placeholder, typed, optionText) {
  const input = page.getByPlaceholder(placeholder);
  await input.click();
  await input.fill(typed);
  await page.getByRole('option').filter({ hasText: optionText }).first().click();
}

const HERO_PH = '输入武将名或拼音...';
const SKILL_PH = '输入战法名或拼音...';

// For a table: read the full ordering, pick a target row whose true rank > 1,
// apply the given filter, then assert every surviving row keeps its full-list
// rank (and specifically that the target's true rank is shown, not 1).
async function verifyTableKeepsTrueRank(page, { label, keyOf, filter, screenshot }) {
  await page.goto('/analytics');
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
    expect(r.rank, `row ${r.key} in ${label}`).toBe(fullRank.get(r.key));
  }
  // The target survived and shows its real rank (which is > 1) — the exact regression.
  const shown = filtered.find((r) => r.key === target.key);
  expect(shown, `target ${target.key} present after filter`).toBeTruthy();
  expect(shown.rank).toBe(target.rank);

  const card = region(page, label).locator('xpath=ancestor::*[contains(@class,"MuiCard-root")][1]');
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `${EVIDENCE_DIR}/${screenshot}` });
  return { target, filtered };
}

test('全部武将 / 全部战法 keep true 排名 under a search filter', async ({ page }) => {
  const hero = await verifyTableKeepsTrueRank(page, {
    label: '全部武将排名',
    keyOf: firstChip,
    filter: (p, t) => addFilter(p, HERO_PH, t.key, t.key),
    screenshot: 'analytics-rank-heroes.png',
  });
  // A single mid-ranked hero -> exactly one row, showing its true rank (> 1).
  expect(hero.filtered.length).toBe(1);
  expect(hero.filtered[0].rank).toBe(hero.target.rank);

  const skill = await verifyTableKeepsTrueRank(page, {
    label: '全部战法排名',
    keyOf: skillKey,
    filter: (p, t) => addFilter(p, SKILL_PH, t.key, t.key),
    screenshot: 'analytics-rank-skills.png',
  });
  expect(skill.filtered.length).toBe(1);
  expect(skill.filtered[0].rank).toBe(skill.target.rank);
});

test('武将使用排行 / 战法使用排行 keep true 排名 under a search filter', async ({ page }) => {
  await verifyTableKeepsTrueRank(page, {
    label: '武将使用排行',
    keyOf: firstChip,
    filter: (p, t) => addFilter(p, HERO_PH, t.key, t.key),
    screenshot: 'analytics-rank-hero-usage.png',
  });
  await verifyTableKeepsTrueRank(page, {
    label: '战法使用排行',
    keyOf: skillKey,
    filter: (p, t) => addFilter(p, SKILL_PH, t.key, t.key),
    screenshot: 'analytics-rank-skill-usage.png',
  });
});

test('最强武将配对 / 最强武将战法组合 keep true 排名 under a search filter', async ({ page }) => {
  // Pairs: filter by one hero of the target pair; all surviving pairs keep true rank.
  await verifyTableKeepsTrueRank(page, {
    label: '最强武将配对',
    keyOf: pairKey,
    filter: (p, t) => {
      const hero = t.key.split(' + ')[0];
      return addFilter(p, HERO_PH, hero, hero);
    },
    screenshot: 'analytics-rank-hero-pairs.png',
  });
  // Hero+skill combos: filter by the target's hero.
  await verifyTableKeepsTrueRank(page, {
    label: '最强武将战法组合',
    keyOf: heroSkillKey,
    filter: (p, t) => {
      const hero = t.key.split(' · ')[0];
      return addFilter(p, HERO_PH, hero, hero);
    },
    screenshot: 'analytics-rank-hero-skills.png',
  });
});
