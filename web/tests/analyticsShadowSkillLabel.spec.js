const { test, expect } = require('@playwright/test');
const database = require('../public/game-data/database.json');

// Evidence-producing e2e for the 全部战法 '影' (transferred/split skill) labelling.
//
// A skill row is tagged `影 · <name>` only with explicit source provenance or
// a database.skills entry marked `shadow: true`. An innate (自带) skill is not
// automatically an 影战法. This test filters a representative mix, asserts the
// metadata and rendered chip labels, and captures a screenshot.
const EVIDENCE_DIR =
  '/var/folders/3m/5ph4vvm12v98v0h7m6p0dmwm0000gn/T/no-mistakes-evidence/01KXS48D0MPF4P8BGG6F2JG4PP';

const EXPLICIT_SHADOW = ['曲辞谄媚', '猿臂善射'];
const INNATE_NOT_SHADOW = ['星罗棋布', '十二奇策'];
const CONTROL_PLAIN = '折冲御侮';

async function addSkillFilter(page, name) {
  const input = page.getByPlaceholder('输入战法名或拼音...');
  await input.click();
  await input.fill(name);
  // MUI Autocomplete: pick the matching option from the popup listbox.
  await page.getByRole('option').filter({ hasText: name }).first().click();
}

test('全部战法 tags 影 (shadow) skills and leaves normal skills unlabelled', async ({ page }) => {
  for (const name of EXPLICIT_SHADOW) {
    expect(database.skills[name]?.shadow).toBe(true);
  }
  for (const name of INNATE_NOT_SHADOW) {
    expect(database.skills[name]?.shadow).not.toBe(true);
  }

  await page.goto('/analytics');

  // The skill-ranking card. On desktop the disclosure is expanded by default.
  const heading = page.getByRole('heading', { name: /全部战法/ });
  await expect(heading).toBeVisible();

  // Narrow the ranking to a clean, representative set so the contrast is legible.
  for (const name of [CONTROL_PLAIN, ...INNATE_NOT_SHADOW, ...EXPLICIT_SHADOW]) {
    await addSkillFilter(page, name);
  }

  const card = page.locator('.MuiCard-root', { has: heading });
  const table = card.getByRole('table');

  // The two explicitly marked skills render with the 影 prefix.
  for (const name of EXPLICIT_SHADOW) {
    await expect(table.getByText(`影 · ${name}`, { exact: true })).toBeVisible();
  }
  // Innate skills without explicit shadow evidence keep their bare names.
  for (const name of INNATE_NOT_SHADOW) {
    await expect(table.getByText(name, { exact: true })).toBeVisible();
    await expect(table.getByText(`影 · ${name}`, { exact: true })).toHaveCount(0);
  }

  // A normal draftable skill also stays unlabelled.
  await expect(table.getByText(CONTROL_PLAIN, { exact: true })).toBeVisible();
  await expect(table.getByText(`影 · ${CONTROL_PLAIN}`, { exact: true })).toHaveCount(0);

  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `${EVIDENCE_DIR}/analytics-shadow-skill-labels.png` });
});
