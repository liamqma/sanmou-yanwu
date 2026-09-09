const { test, expect } = require('@playwright/test');
const database = require('../public/game-data/database.json');

const heroEntries = Object.entries(database.heroes || {});
const skillEntries = Object.entries(database.skills || {});
const HERO_SKILL_SET = new Set(
  [
    ...heroEntries.map(([, hero]) => hero.skill).filter(Boolean),
    ...skillEntries
      .filter(([, skill]) => skill.shadow === true)
      .map(([name]) => name),
  ]
);
const maxSeason = Math.max(
  ...heroEntries.map(([, hero]) => hero.season),
  ...skillEntries.map(([, skill]) => skill.season)
);
const olderSeason = 3;

const futureHeroes = heroEntries
  .filter(([, hero]) => hero.season > olderSeason)
  // Keep the latest-season heroes independent of setup and active offers.
  .sort(([, a], [, b]) => a.season - b.season)
  .map(([name]) => name);
const eligibleHeroes = heroEntries
  .filter(([, hero]) => hero.season <= olderSeason)
  .map(([name]) => name);
const regularSkillEntries = skillEntries.filter(
  ([name]) => !HERO_SKILL_SET.has(name)
);
const futureRegularSkills = regularSkillEntries
  .filter(([, skill]) => skill.season > olderSeason)
  .map(([name]) => name);
const eligiblePurpleSkills = regularSkillEntries
  .filter(
    ([, skill]) =>
      skill.season <= olderSeason && skill.color === 'purple'
  )
  .map(([name]) => name);
const eligibleOrangeSkills = regularSkillEntries
  .filter(
    ([, skill]) =>
      skill.season <= olderSeason && skill.color === 'orange'
  )
  .map(([name]) => name);

const setupHeroes = [futureHeroes[0], ...eligibleHeroes.slice(0, 3)];
const setupSkills = [
  ...eligiblePurpleSkills.slice(0, 4),
  ...eligibleOrangeSkills.slice(0, 3),
  futureRegularSkills[0],
];
const futureRoundHero = futureHeroes.find(
  (hero) => !setupHeroes.includes(hero)
);
const futureSupportHero = futureHeroes.find(
  (hero) => !setupHeroes.includes(hero) && hero !== futureRoundHero
);

async function chooseSeason(page, season) {
  const selector = page.getByRole('combobox', { name: '当前赛季' });
  await selector.click();
  await page.getByRole('option', { name: `赛季 ${season}`, exact: true }).click();
  await expect(selector).toHaveText(`赛季 ${season}`);
}

async function selectSetupItems(page) {
  for (const hero of setupHeroes) {
    const input = page.getByLabel('输入武将名或拼音...');
    await input.fill(hero);
    await page.getByRole('option', { name: hero }).click();
  }

  for (const skill of setupSkills) {
    const input = page.getByLabel('输入战法名或拼音...');
    await input.fill(skill);
    await page.getByRole('option', { name: skill }).click();
  }
}

async function capture(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function expectCandidateNames(dialog, expected) {
  // Read the actual scored recommendation rows, not just the top suggestion.
  const names = dialog.getByRole('list').locator('.MuiChip-label');
  await expect(names).toHaveCount(expected.length);
  expect((await names.allTextContents()).sort()).toEqual([...expected].sort());
}

async function checkSupportSkills(page, season, testInfo) {
  const futureSkill = regularSkillEntries.find(
    ([name, skill]) => skill.season > season && !setupSkills.includes(name)
  )?.[0];
  expect(futureSkill).toBeTruthy();
  await page.getByRole('button', { name: '推荐支援战法' }).first().click();
  const dialog = page.getByRole('dialog', { name: '推荐支援战法' });
  await expectCandidateNames(dialog, regularSkillEntries
    .filter(([name, skill]) => skill.season <= season && !setupSkills.includes(name))
    .map(([name]) => name));
  await dialog.getByLabel('搜索战法...').fill(futureSkill);
  await expect(page.getByText('无匹配结果')).toBeVisible();
  await capture(page, testInfo, `S${season}-blocks-S${database.skills[futureSkill].season}-tactic-${futureSkill}`);
  await dialog.getByRole('button', { name: '关闭' }).click();
}

test.describe('Season selection', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  test('defaults to the latest database season and remembers changes', async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto('/');

    const selector = page.getByRole('combobox', { name: '当前赛季' });
    await expect(selector).toBeVisible({ timeout: 30000 });
    await expect(selector).toHaveText(`赛季 ${maxSeason}`);

    await chooseSeason(page, olderSeason);
    await page.reload();
    await expect(
      page.getByRole('combobox', { name: '当前赛季' })
    ).toHaveText(`赛季 ${olderSeason}`);
  });

  for (const season of [1, 2, 3]) {
    test(`S${season} unlocks heroes cumulatively without limiting setup or round inputs`, async ({ page }, testInfo) => {
      expect(setupHeroes).toHaveLength(4);
      expect(setupSkills).toHaveLength(8);
      expect(futureRoundHero).toBeTruthy();
      expect(futureSupportHero).toBeTruthy();

      await page.goto('/');
      await chooseSeason(page, season);
      // Newer heroes and tactics remain valid initial-setup entries.
      await selectSetupItems(page);
      await page.getByRole('button', { name: '开始对局' }).click();
      await expect(page.getByText(`赛季 ${season}`, { exact: true })).toBeVisible();

      const roundInput = page.getByLabel('输入武将名或拼音搜索武将').first();
      await roundInput.fill(futureRoundHero);
      await page.getByRole('option', { name: futureRoundHero }).click();

      await page.getByRole('button', { name: '推荐支援武将' }).click();
      const dialog = page.getByRole('dialog', { name: '推荐支援武将' });
      await expectCandidateNames(dialog, heroEntries
        .filter(([name, hero]) => hero.season <= season && !setupHeroes.includes(name))
        .map(([name]) => name));
      const search = dialog.getByLabel('搜索武将...');
      // This independent future hero is neither owned nor in an active offer.
      await search.fill(futureSupportHero);
      await expect(page.getByText('无匹配结果')).toBeVisible();
      await capture(page, testInfo, `S${season}-blocks-future-hero-${futureSupportHero}`);

      const recommendedHero = await dialog.getByRole('list').locator('.MuiChip-label').first().innerText();
      // Check every cumulative boundary in manual search, not only S1.
      for (let introduction = 1; introduction <= season + 1; introduction++) {
        const witness = heroEntries.find(([name, hero]) =>
          hero.season === introduction && !setupHeroes.includes(name) &&
          name !== futureRoundHero && name !== recommendedHero)?.[0];
        expect(witness).toBeTruthy();
        await search.fill(witness);
        if (introduction <= season) {
          await expect(page.getByRole('option').filter({ has: page.getByText(witness, { exact: true }) })).toBeVisible();
          if (introduction === season) await capture(page, testInfo, `S${season}-allows-boundary-hero-${witness}`);
        } else {
          await expect(page.getByText('无匹配结果')).toBeVisible();
        }
      }
      await dialog.getByRole('button', { name: '关闭' }).click();
      await checkSupportSkills(page, season, testInfo);

      // CurrentTeam's ordinary editor deliberately shares the support pool.
      await page.getByRole('button', { name: '编辑队伍' }).click();
      await page.getByLabel('添加武将...').fill(futureSupportHero);
      await expect(page.getByText('无匹配结果')).toBeVisible();
      await page.getByRole('button', { name: '取消', exact: true }).click();

      // Complete only the first draft round to also exercise unrestricted
      // future-season tactic entry through the real round-2 UI.
      const offered = [futureRoundHero, ...heroEntries
        .map(([name]) => name)
        .filter(name => !setupHeroes.includes(name) && name !== futureRoundHero)
        .slice(0, 8)];
      for (let index = 1; index < offered.length; index++) {
        await page.getByLabel('输入武将名或拼音搜索武将').nth(Math.floor(index / 3)).fill(offered[index]);
        await page.getByRole('option').filter({ has: page.getByText(offered[index], { exact: true }) }).click();
      }
      await page.getByRole('button', { name: '获取 AI 推荐' }).click();
      await expect(page.getByText('推荐：第')).toBeVisible();
      await page.getByRole('button', { name: '选择本组' }).first().click();
      await page.getByRole('button', { name: '确认选择并进入下一轮' }).click();
      const futureSkill = futureRegularSkills.find(name => !setupSkills.includes(name));
      await page.getByLabel('输入战法名或拼音搜索战法').first().fill(futureSkill);
      await page.getByRole('option').filter({ has: page.getByText(futureSkill, { exact: true }) }).click();
      await expect(page.getByRole('heading', { level: 1, name: '第 2 轮：选择战法' })).toBeVisible();
      await expect(page.getByTestId(`game-card-tactic-${futureSkill}`).first()).toBeVisible();
      await capture(page, testInfo, `S${season}-future-tactic-in-normal-round`);
    });
  }

  for (const season of [4, 5, 7]) {
    test(`S${season} allows later-season support heroes but still excludes owned and offered heroes`, async ({ page }, testInfo) => {
      // Use the latest hero season to prove that "all" is not capped at S4/S7.
      const latestHeroSeason = Math.max(...heroEntries.map(([, hero]) => hero.season));
      const laterHeroes = heroEntries.filter(([name, hero]) =>
        hero.season === latestHeroSeason && !setupHeroes.includes(name) && name !== futureRoundHero
      ).map(([name]) => name);
      expect(latestHeroSeason).toBeGreaterThan(season);
      expect(laterHeroes.length).toBeGreaterThanOrEqual(2);
      const [laterHero, editorHero] = laterHeroes;

      await page.goto('/');
      await chooseSeason(page, season);
      await selectSetupItems(page);
      await page.getByRole('button', { name: '开始对局' }).click();
      const roundInput = page.getByLabel('输入武将名或拼音搜索武将').first();
      await roundInput.fill(futureRoundHero);
      await page.getByRole('option', { name: futureRoundHero }).click();

      await page.getByRole('button', { name: '推荐支援武将' }).click();
      const dialog = page.getByRole('dialog', { name: '推荐支援武将' });
      await expectCandidateNames(dialog, heroEntries
        .filter(([name]) => !setupHeroes.includes(name) && name !== futureRoundHero)
        .map(([name]) => name));
      // Accept the actual engine suggestion before exercising manual search.
      const recommendedHero = await dialog.getByRole('alert').locator('strong').innerText();
      await dialog.getByRole('button', { name: '设为支援武将' }).click();
      await expect(page.getByTestId(`game-card-hero-${recommendedHero}`).locator('..')).toContainText('★ 支援');
      await capture(page, testInfo, `S${season}-auto-recommended-S${database.heroes[recommendedHero].season}-${recommendedHero}`);
      await page.getByRole('button', { name: `移除${recommendedHero}`, exact: true }).click();
      await page.getByRole('button', { name: '推荐支援武将' }).click();
      const search = dialog.getByLabel('搜索武将...');
      for (const excludedHero of [setupHeroes[0], futureRoundHero]) {
        await search.fill(excludedHero);
        await expect(page.getByText('无匹配结果')).toBeVisible();
      }
      await capture(page, testInfo, `S${season}-excludes-offered-hero-${futureRoundHero}`);
      await search.fill(laterHero);
      const laterHeroOption = page.getByRole('option').filter({ has: page.getByText(laterHero, { exact: true }) });
      await expect(laterHeroOption).toBeVisible();
      await capture(page, testInfo, `S${season}-allows-S${latestHeroSeason}-hero-${laterHero}`);
      await laterHeroOption.click();
      await dialog.getByRole('button', { name: '设为支援武将' }).click();

      const supportCard = page.getByTestId(`game-card-hero-${laterHero}`);
      await expect(supportCard).toBeVisible();
      await expect(supportCard.locator('..')).toContainText('★ 支援');
      await checkSupportSkills(page, season, testInfo);

      await page.getByRole('button', { name: '编辑队伍' }).click();
      await page.getByLabel('添加武将...').fill(editorHero);
      await page.getByRole('option').filter({ has: page.getByText(editorHero, { exact: true }) }).click();
      await page.getByRole('button', { name: '保存修改' }).click();
      await expect(page.getByTestId(`game-card-hero-${editorHero}`)).toBeVisible();

      // Reload observes the application's writes, rather than injecting state.
      await page.reload();
      await expect(supportCard).toBeVisible();
      await expect(supportCard.locator('..')).toContainText('★ 支援');
      await expect(page.getByTestId(`game-card-hero-${editorHero}`)).toBeVisible();
      await expect(page.getByTestId(`game-card-hero-${futureRoundHero}`).first()).toBeVisible();
      await capture(page, testInfo, `S${season}-confirmed-S${latestHeroSeason}-support-after-reload`);
    });
  }
});
