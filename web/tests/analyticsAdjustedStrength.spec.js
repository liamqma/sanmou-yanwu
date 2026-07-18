const { test, expect } = require('@playwright/test');
const recData = require('../src/recommendation_data.json');

// Evidence-producing e2e for the season-aware "综合强度" (adjusted strength) column
// on the /analytics page. It asserts the new column header exists on both the
// hero and skill ranking tables, that the tables are ordered by that column
// (the top row matches the artifact's top-ranked, penalty-adjusted item), and
// captures screenshots of the ranking cards + the explanatory copy for review.
const EVIDENCE_DIR =
  '/var/folders/3m/5ph4vvm12v98v0h7m6p0dmwm0000gn/T/no-mistakes-evidence/01KXTA83V69NX6805J21N4HNDV';

const fmtStrength = (x, dp = 3) => {
  const s = x.toFixed(dp);
  return x > 0 ? `+${s}` : s;
};

test('全部武将/战法 rank by season-aware 综合强度 with a new column', async ({ page }) => {
  await page.goto('/analytics');

  // Explanatory copy now leads with 综合强度 rather than 胜率参考.
  await expect(page.getByText('综合强度', { exact: true }).first()).toBeVisible();

  // ── Hero ranking card ──────────────────────────────────────────────────
  const heroHeading = page.getByRole('heading', { name: /全部武将（按综合强度排序）/ });
  await expect(heroHeading).toBeVisible();
  const heroCard = page.locator('.MuiCard-root', { has: heroHeading });
  const heroTable = heroCard.getByRole('table');
  await expect(heroTable.getByRole('columnheader', { name: '综合强度' })).toBeVisible();

  // Top hero row must be the artifact's top adjusted-strength hero.
  const topHero = recData.analytics.heroes[0];
  const heroFirstRow = heroTable.locator('tbody tr').first();
  await expect(heroFirstRow).toContainText(topHero.name);
  await expect(heroFirstRow).toContainText(fmtStrength(topHero.adjusted_strength));

  await heroCard.scrollIntoViewIfNeeded();
  await heroCard.screenshot({ path: `${EVIDENCE_DIR}/analytics-hero-adjusted-strength.png` });

  // ── Skill ranking card ─────────────────────────────────────────────────
  const skillHeading = page.getByRole('heading', { name: /全部战法（按综合强度排序）/ });
  await expect(skillHeading).toBeVisible();
  const skillCard = page.locator('.MuiCard-root', { has: skillHeading });
  const skillTable = skillCard.getByRole('table');
  await expect(skillTable.getByRole('columnheader', { name: '综合强度' })).toBeVisible();

  const topSkill = recData.analytics.skills[0];
  const skillFirstRow = skillTable.locator('tbody tr').first();
  await expect(skillFirstRow).toContainText(topSkill.name);
  await expect(skillFirstRow).toContainText(fmtStrength(topSkill.adjusted_strength));

  await skillCard.scrollIntoViewIfNeeded();
  await skillCard.screenshot({ path: `${EVIDENCE_DIR}/analytics-skill-adjusted-strength.png` });

  // Capture the "三步看懂这些数字" explainer that now describes 综合强度.
  const explainer = page.getByText('三步看懂这些数字').locator('xpath=ancestor::*[contains(@class,"MuiPaper-root")][1]');
  if (await explainer.count()) {
    await explainer.first().scrollIntoViewIfNeeded();
    await explainer.first().screenshot({ path: `${EVIDENCE_DIR}/analytics-explainer-copy.png` });
  }
});
