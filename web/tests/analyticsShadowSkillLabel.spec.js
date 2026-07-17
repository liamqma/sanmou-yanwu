const { test, expect } = require('@playwright/test');

// Evidence-producing e2e for the 全部战法 '影' (transferred/split skill) labelling.
//
// A skill row is tagged `影 · <name>` when the skill is a 影战法 — either an
// orange hero's innate (自带) skill, OR a skill absent from database.skills
// (uncatalogued → belongs to a non-orange hero, so it can only appear here as a
// transfer). This test filters the ranking to a representative mix and both
// asserts the rendered chip labels and captures a screenshot for review.
const EVIDENCE_DIR =
  '/var/folders/3m/5ph4vvm12v98v0h7m6p0dmwm0000gn/T/no-mistakes-evidence/01KXS48D0MPF4P8BGG6F2JG4PP';

// Two NON-orange (not-in-catalog) skills — the new behaviour under test.
const NOT_IN_CATALOG = ['曲辞谄媚', '猿臂善射'];
// An orange hero's innate skill — already tagged by prior work.
const INNATE_ORANGE = '十二奇策';
// A normal draftable skill (in catalog, not innate) — must stay unlabelled.
const CONTROL_PLAIN = '折冲御侮';

async function addSkillFilter(page, name) {
  const input = page.getByPlaceholder('输入战法名或拼音...');
  await input.click();
  await input.fill(name);
  // MUI Autocomplete: pick the matching option from the popup listbox.
  await page.getByRole('option').filter({ hasText: name }).first().click();
}

test('全部战法 tags 影 (shadow) skills and leaves normal skills unlabelled', async ({ page }) => {
  await page.goto('/analytics');

  // The skill-ranking card. On desktop the disclosure is expanded by default.
  const heading = page.getByRole('heading', { name: /全部战法/ });
  await expect(heading).toBeVisible();

  // Narrow the ranking to a clean, representative set so the contrast is legible.
  for (const name of [CONTROL_PLAIN, INNATE_ORANGE, ...NOT_IN_CATALOG]) {
    await addSkillFilter(page, name);
  }

  const card = page.locator('.MuiCard-root', { has: heading });
  const table = card.getByRole('table');

  // The two newly-covered non-catalog skills render with the 影 prefix.
  for (const name of NOT_IN_CATALOG) {
    await expect(table.getByText(`影 · ${name}`, { exact: true })).toBeVisible();
  }
  // The innate-orange skill (prior behaviour) is still tagged.
  await expect(table.getByText(`影 · ${INNATE_ORANGE}`, { exact: true })).toBeVisible();

  // A normal draftable skill keeps its bare name — no false positive.
  await expect(table.getByText(CONTROL_PLAIN, { exact: true })).toBeVisible();
  await expect(table.getByText(`影 · ${CONTROL_PLAIN}`, { exact: true })).toHaveCount(0);

  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `${EVIDENCE_DIR}/analytics-shadow-skill-labels.png` });
});
