const { test, expect } = require('@playwright/test');
const database = require('../public/game-data/database.json');
const { seedGame } = require('./helpers');

// Merged database (see web/scripts/merge_database.js):
//   - heroes: orange heroes only. Each hero has a `skill` field naming its
//     signature (hero-exclusive) skill.
//   - skills: { color, desc }. Hero-exclusivity is derived from heroes[*].skill.
const orangeHeroes = Object.keys(database.heroes || {}).sort();

// Pick 4 orange heroes for initial setup
const heroesToSelect = orangeHeroes.slice(0, 4);

// Build skill lists from the real database
const HERO_SKILL_SET = new Set(
  Object.values(database.heroes || {}).map(h => h.skill).filter(Boolean)
);
const allSkillNames = Object.keys(database.skills || {});
const regularSkills = allSkillNames.filter(n => !HERO_SKILL_SET.has(n));
const heroSkills   = allSkillNames.filter(n => HERO_SKILL_SET.has(n)).sort();
const allOrangeRegularSkills = regularSkills
  .filter((s) => database.skills[s]?.color === 'orange')
  .sort();

// 4 purple regular skills
const purpleSkills = regularSkills
  .filter((s) => database.skills[s]?.color === 'purple')
  .sort()
  .slice(0, 4);

// 3 orange regular skills + 1 hero skill (hero skills are orange by nature)
const orangeRegularSkills = regularSkills
  .filter((s) => database.skills[s]?.color === 'orange')
  .sort()
  .slice(0, 3);
const oneHeroSkill = heroSkills.slice(0, 1);

const skillsToSelect = [...purpleSkills, ...orangeRegularSkills, ...oneHeroSkill];

// Pick a purple skill and an orange skill for the round test
const aPurpleSkill = regularSkills
  .filter((s) => database.skills[s]?.color === 'purple')
  .sort()[0];
const anOrangeSkill = regularSkills
  .filter(
    (s) =>
      database.skills[s]?.color === 'orange' &&
      !orangeRegularSkills.includes(s) // not already used in setup
  )
  .sort()[0];

// Additional heroes for round 1 (not used in setup)
const round1Heroes = orangeHeroes.filter((h) => !heroesToSelect.includes(h)).slice(0, 9);

test.describe('Game Rounds - Skill Selection', () => {
  test('during skill rounds, only orange skills are available (not purple)', async ({
    page,
  }) => {
    const loggedRounds = [];
    await page.route('**/api/telemetry/rounds', async route => {
      const body = route.request().postDataJSON();
      loggedRounds.push(...body.events);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, accepted: body.events.length, duplicates: 0 }),
      });
    });

    // ── Reset any saved progress and complete initial setup ──
    // Clear cookies/storage to avoid restoring previous game state
    await page.context().clearCookies();
    await page.goto('/');
    await expect(page.getByText('初始武将')).toBeVisible({ timeout: 30000 });

    // Select 4 heroes
    for (const heroName of heroesToSelect) {
      const heroInput = page.getByLabel('输入武将名或拼音...');
      await heroInput.click();
      await heroInput.fill(heroName);
      await page.getByRole('option', { name: heroName }).click();
    }

    // Select 8 skills
    for (const skillName of skillsToSelect) {
      const skillInput = page.getByLabel('输入战法名或拼音...');
      await skillInput.click();
      await skillInput.fill(skillName);
      await page.getByRole('option', { name: skillName }).click();
    }

    // Start the game
    await page.getByRole('button', { name: '开始对局' }).click();

    // ── Round 1 (hero round) - fill 3 sets of 3 heroes each ──
    await expect(
      page.getByRole('heading', { level: 1, name: '第 1 轮：选择武将' }),
    ).toHaveCount(1);
    await expect(page.getByText('第 1 / 10 轮')).toHaveCount(0);
    await expect(page.getByText('本轮候选', { exact: true })).toHaveCount(0);
    await expect(page.getByText('填写三组选项', { exact: true })).toHaveCount(0);
    await expect(page.getByText('未选择任何内容', { exact: true })).toHaveCount(0);
    await expect(
      page.getByLabel('输入武将名或拼音搜索武将'),
    ).toHaveCount(3);

    for (let set = 0; set < 3; set++) {
      for (let i = 0; i < 3; i++) {
        const hero = round1Heroes[set * 3 + i];
        // After each selection, the filled input disappears, so always target the set's input
        const input = page.getByLabel('输入武将名或拼音搜索武将').nth(set);
        await input.click();
        await input.fill(hero);
        await page.getByRole('option', { name: hero }).click();
      }
    }

    // Get recommendation, select the recommended set, and confirm round 1
    await page.getByRole('button', { name: '获取 AI 推荐' }).click();
    // Wait for recommendation to appear, then select the first set
    await expect(page.getByText('推荐：第')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: '选择本组' }).first().click();
    const confirmButton = page.getByRole('button', { name: '确认选择并进入下一轮' });
    await expect(confirmButton).toBeEnabled({ timeout: 5000 });
    await confirmButton.click();

    // The confirmed round is logged asynchronously without blocking the move
    // to round 2. It contains the complete pre-choice decision context.
    await expect.poll(() => loggedRounds.length).toBe(1);
    expect(loggedRounds[0]).toMatchObject({
      round_number: 1,
      round_type: 'hero',
      schema_version: 1,
      pool_before: { heroes: heroesToSelect, skills: skillsToSelect },
      offered_sets: [
        round1Heroes.slice(0, 3),
        round1Heroes.slice(3, 6),
        round1Heroes.slice(6, 9),
      ],
      chosen_index: 0,
      preference_model_version: null,
      preference_probabilities: null,
    });
    expect(loggedRounds[0].paired_scores).toHaveLength(3);
    expect(loggedRounds[0].recommended_index).toBeGreaterThanOrEqual(0);
    expect(loggedRounds[0].recommended_index).toBeLessThanOrEqual(2);

    // ── Round 2 (skill round) - verify only orange skills appear ──
    await expect(
      page.getByRole('heading', { level: 1, name: '第 2 轮：选择战法' }),
    ).toHaveCount(1);

    // Type a purple skill name - should show no options
    const skillInput = page.getByLabel('输入战法名或拼音搜索战法').first();
    await skillInput.click();
    await skillInput.fill(aPurpleSkill);
    // The AutocompleteInput renders this text when the typed query matches no
    // available (orange-only) options. See web/src/components/common/AutocompleteInput.js.
    await expect(page.getByText('无匹配结果')).toBeVisible({ timeout: 3000 });

    // Clear and type an orange skill name - should show the option
    await skillInput.fill('');
    await skillInput.fill(anOrangeSkill);
    const orangeOption = page.getByRole('option', { name: anOrangeSkill });
    await expect(orangeOption).toBeVisible({ timeout: 5000 });
  });

  test('rounds 9 and 10 repeat the late-game offer shapes and finish the game', async ({
    page,
  }) => {
    await page.route('**/api/telemetry/rounds', async route => {
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          accepted: body.events.length,
          duplicates: 0,
        }),
      });
    });

    const currentHeroes = orangeHeroes.slice(0, 12);
    const roundNineOffers = orangeHeroes.slice(12, 18);
    const roundTenOffers = allOrangeRegularSkills.slice(0, 9);
    const currentSkills = regularSkills
      .filter((skill) => !roundTenOffers.includes(skill))
      .slice(0, 23);

    await seedGame(
      page,
      {
        current_heroes: currentHeroes,
        current_skills: currentSkills,
        support_hero: null,
        support_skills: [],
        round_number: 9,
        round_history: [],
        round7_interstitial_dismissed: true,
        // Deliberately omit round9_interstitial_dismissed. Restored states that
        // predate the new field must stop at the round-8/9 qualification gate.
      },
      {
        set1: roundNineOffers.slice(0, 2),
        set2: roundNineOffers.slice(2, 4),
        set3: roundNineOffers.slice(4, 6),
      }
    );

    const qualificationAction = page.getByRole('button', {
      name: '我赢了，进入下一轮',
    });
    await expect(qualificationAction).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: '整军再战' })).toBeVisible();
    await qualificationAction.click();

    await expect(
      page.getByRole('heading', { level: 1, name: '第 9 轮：选择武将' })
    ).toHaveCount(1);
    await expect(page.getByText('第 9 / 10 轮')).toHaveCount(0);
    await expect(page.getByText('(2/2)')).toHaveCount(3);

    await expect.poll(async () =>
      page.evaluate(() => {
        const saved = localStorage.getItem('gameProgress');
        return saved
          ? JSON.parse(saved).gameState.round9_interstitial_dismissed
          : false;
      })
    ).toBe(true);

    await page.reload();
    await expect(qualificationAction).toHaveCount(0);
    await expect(
      page.getByRole('heading', { level: 1, name: '第 9 轮：选择武将' })
    ).toHaveCount(1);

    await page.getByRole('button', { name: '获取 AI 推荐' }).click();
    await expect(page.getByText('推荐：第')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: '选择本组' }).first().click();
    await page.getByRole('button', { name: '确认选择并进入下一轮' }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: '第 10 轮：选择战法' })
    ).toHaveCount(1);
    await expect(page.getByText('第 10 / 10 轮')).toHaveCount(0);

    for (let set = 0; set < 3; set++) {
      for (let i = 0; i < 3; i++) {
        const skill = roundTenOffers[set * 3 + i];
        const input = page.getByLabel('输入战法名或拼音搜索战法').nth(set);
        await input.click();
        await input.fill(skill);
        await page.getByRole('option', { name: skill }).click();
      }
    }

    await expect(page.getByText('(3/3)')).toHaveCount(3);
    await page.getByRole('button', { name: '获取 AI 推荐' }).click();
    await expect(page.getByText('推荐：第')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: '选择本组' }).first().click();
    await page.getByRole('button', { name: '确认选择并进入下一轮' }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: '对局完成' })
    ).toBeVisible();
    await expect(page.getByText('你已完成全部 10 轮。可查看最终队伍配置。')).toBeVisible();
    await expect(page.getByText('祝你夺冠 🏆')).toBeVisible();
  });
});
