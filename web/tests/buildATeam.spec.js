const { test, expect } = require('@playwright/test');
const database = require('../src/database.json');

// Build a small, deterministic pool from the real database.
const orangeHeroes = Object.keys(database.heroes || {}).sort();
const allSkillNames = Object.keys(database.skills || {});
const HERO_SKILL_SET = new Set(
  Object.values(database.heroes || {}).map((h) => h.skill).filter(Boolean)
);
const regularSkills = allSkillNames.filter((n) => !HERO_SKILL_SET.has(n)).sort();

const poolHeroes = orangeHeroes.slice(0, 3);
const poolSkills = regularSkills.slice(0, 4);

// A support hero/skill that are distinct from the main pool, used to verify
// 支援武将 / 支援战法 also surface in the pool.
const supportHero = orangeHeroes[3];
const supportSkill = regularSkills[4];

// Cookie payload mirrors storage.saveGameProgress: { gameState, currentRoundInputs }
const gameProgress = {
  gameState: {
    current_heroes: poolHeroes,
    current_skills: poolSkills,
    support_hero: supportHero,
    support_skills: [supportSkill],
  },
  currentRoundInputs: {},
};

/**
 * Drive native HTML5 drag-and-drop between two testid elements.
 * Playwright's mouse-based dragTo does not fire native DnD events, so we
 * dispatch dragstart/dragover/drop with a shared DataTransfer instead.
 */
async function nativeDragAndDrop(page, sourceTestId, targetTestId) {
  await page.evaluate(
    ({ sourceTestId, targetTestId }) => {
      const source = document.querySelector(`[data-testid="${sourceTestId}"]`);
      const target = document.querySelector(`[data-testid="${targetTestId}"]`);
      if (!source || !target) {
        throw new Error(`Missing element: ${!source ? sourceTestId : targetTestId}`);
      }
      const dataTransfer = new DataTransfer();
      const fire = (el, type) =>
        el.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer })
        );
      fire(source, 'dragstart');
      fire(target, 'dragover');
      fire(target, 'drop');
      fire(source, 'dragend');
    },
    { sourceTestId, targetTestId }
  );
}

test.describe('Build a Team (/build-a-team)', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      {
        name: 'gameProgress',
        value: JSON.stringify(gameProgress),
        url: 'http://localhost:3000',
      },
    ]);
    // Grant clipboard access for the copy-button assertion.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('shows the current cookie pool as draggable items', async ({ page }) => {
    await page.goto('/build-a-team');
    await expect(page.getByRole('heading', { name: /Build a Team/ })).toBeVisible({
      timeout: 30000,
    });

    for (const hero of poolHeroes) {
      await expect(page.getByTestId(`pool-hero-${hero}`)).toBeVisible();
    }
    for (const skill of poolSkills) {
      await expect(page.getByTestId(`pool-skill-${skill}`)).toBeVisible();
    }

    // 支援武将 / 支援战法 also appear in the pool, marked with a 支援 badge.
    const supportHeroChip = page.getByTestId(`pool-hero-${supportHero}`);
    const supportSkillChip = page.getByTestId(`pool-skill-${supportSkill}`);
    await expect(supportHeroChip).toBeVisible();
    await expect(supportSkillChip).toBeVisible();
    await expect(supportHeroChip).toContainText('支援');
    await expect(supportSkillChip).toContainText('支援');
  });

  test('drag-drop builds a team, copies it, and persists across reload', async ({
    page,
  }) => {
    await page.goto('/build-a-team');
    await expect(page.getByRole('heading', { name: /Build a Team/ })).toBeVisible({
      timeout: 30000,
    });

    // Place hero 0 into team 1 / hero slot 0, plus its two skills.
    await nativeDragAndDrop(page, `pool-hero-${poolHeroes[0]}`, 'hero-slot-0-0');
    await nativeDragAndDrop(page, `pool-skill-${poolSkills[0]}`, 'skill-slot-0-0-0');
    await nativeDragAndDrop(page, `pool-skill-${poolSkills[1]}`, 'skill-slot-0-0-1');

    // The placed hero name should now appear inside the slot.
    await expect(
      page.getByTestId('hero-slot-0-0').getByText(new RegExp(poolHeroes[0]))
    ).toBeVisible();
    await expect(
      page.getByTestId('skill-slot-0-0-0').getByText(new RegExp(poolSkills[0]))
    ).toBeVisible();
    await expect(
      page.getByTestId('skill-slot-0-0-1').getByText(new RegExp(poolSkills[1]))
    ).toBeVisible();

    // ── Copy and verify the team-damage format on the clipboard ──
    await page.getByRole('button', { name: /复制 team-damage 配置/ }).click();
    await expect(page.getByText('已复制 team-damage 配置')).toBeVisible({
      timeout: 5000,
    });

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('team-damage');
    expect(clipboard).toContain('队伍1：');
    // Default row is 前排; the hero line includes the row marker.
    expect(clipboard).toContain(
      `- ${poolHeroes[0]}（前排）：${poolSkills[0]}、${poolSkills[1]}`
    );

    // ── Reload: the arrangement should be restored from the teamBuilder cookie ──
    await page.reload();
    await expect(page.getByRole('heading', { name: /Build a Team/ })).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.getByTestId('hero-slot-0-0').getByText(new RegExp(poolHeroes[0]))
    ).toBeVisible();
    await expect(
      page.getByTestId('skill-slot-0-0-0').getByText(new RegExp(poolSkills[0]))
    ).toBeVisible();
  });

  test('placed item leaves the pool and returns after clearing', async ({ page }) => {
    await page.goto('/build-a-team');
    await expect(page.getByRole('heading', { name: /Build a Team/ })).toBeVisible({
      timeout: 30000,
    });

    const heroChip = page.getByTestId(`pool-hero-${poolHeroes[0]}`);
    const skillChip = page.getByTestId(`pool-skill-${poolSkills[0]}`);
    await expect(heroChip).toBeVisible();
    await expect(skillChip).toBeVisible();

    // Place the hero + a skill: both should disappear from the pool.
    await nativeDragAndDrop(page, `pool-hero-${poolHeroes[0]}`, 'hero-slot-0-0');
    await nativeDragAndDrop(page, `pool-skill-${poolSkills[0]}`, 'skill-slot-0-0-0');
    await expect(heroChip).toHaveCount(0);
    await expect(skillChip).toHaveCount(0);
    // Untouched pool items remain available.
    await expect(page.getByTestId(`pool-hero-${poolHeroes[1]}`)).toBeVisible();
    await expect(page.getByTestId(`pool-skill-${poolSkills[1]}`)).toBeVisible();

    // Clearing the hero slot returns just the hero to the pool.
    await page.getByLabel(`移除武将 ${poolHeroes[0]}`).click();
    await expect(page.getByTestId(`pool-hero-${poolHeroes[0]}`)).toBeVisible();
    await expect(page.getByTestId(`pool-skill-${poolSkills[0]}`)).toHaveCount(0);

    // Clearing the skill slot returns the skill too.
    await page.getByLabel(`移除战法 ${poolSkills[0]}`).click();
    await expect(page.getByTestId(`pool-skill-${poolSkills[0]}`)).toBeVisible();
  });

  test('formation + 前排/后排 are reflected in copy and persist on reload', async ({
    page,
  }) => {
    await page.goto('/build-a-team');
    await expect(page.getByRole('heading', { name: /Build a Team/ })).toBeVisible({
      timeout: 30000,
    });

    // Place two heroes in team 1.
    await nativeDragAndDrop(page, `pool-hero-${poolHeroes[0]}`, 'hero-slot-0-0');
    await nativeDragAndDrop(page, `pool-hero-${poolHeroes[1]}`, 'hero-slot-0-1');

    // Pick a formation for team 1 (open the first 阵型 combobox).
    await page.getByRole('combobox', { name: '阵型' }).first().click();
    await page.getByRole('option', { name: '锥形阵' }).click();

    // Move the second hero to 后排.
    await page.getByRole('button', { name: `${poolHeroes[1]} 后排` }).click();

    // Copy and verify formation + rows in the output.
    await page.getByRole('button', { name: /复制 team-damage 配置/ }).click();
    await expect(page.getByText('已复制 team-damage 配置')).toBeVisible({
      timeout: 5000,
    });
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('队伍1（锥形阵）：');
    expect(clipboard).toContain(`- ${poolHeroes[0]}（前排）：`);
    expect(clipboard).toContain(`- ${poolHeroes[1]}（后排）：`);
    expect(clipboard).toContain(`前排：${poolHeroes[0]}`);
    expect(clipboard).toContain(`后排：${poolHeroes[1]}`);

    // Reload: formation + row selection should be restored.
    await page.reload();
    await expect(page.getByRole('heading', { name: /Build a Team/ })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByTestId('formation-select-0')).toHaveValue('锥形阵');
    await expect(
      page.getByRole('button', { name: `${poolHeroes[1]} 后排` })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('clear button empties all slots', async ({ page }) => {
    await page.goto('/build-a-team');
    await expect(page.getByRole('heading', { name: /Build a Team/ })).toBeVisible({
      timeout: 30000,
    });

    await nativeDragAndDrop(page, `pool-hero-${poolHeroes[0]}`, 'hero-slot-0-0');
    await expect(
      page.getByTestId('hero-slot-0-0').getByText(new RegExp(poolHeroes[0]))
    ).toBeVisible();

    await page.getByRole('button', { name: /清空/ }).click();
    await expect(page.getByText('已清空所有队伍')).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByTestId('hero-slot-0-0').getByText('拖入武将')
    ).toBeVisible();
  });
});
