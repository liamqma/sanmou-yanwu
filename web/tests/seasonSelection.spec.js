const { test, expect } = require('@playwright/test');
const database = require('../public/game-data/database.json');

const heroEntries = Object.entries(database.heroes || {});
const skillEntries = Object.entries(database.skills || {});
const HERO_SKILL_SET = new Set(
  heroEntries.map(([, hero]) => hero.skill).filter(Boolean)
);
const maxSeason = Math.max(
  ...heroEntries.map(([, hero]) => hero.season),
  ...skillEntries.map(([, skill]) => skill.season)
);
const olderSeason = maxSeason - 1;

const futureHeroes = heroEntries
  .filter(([, hero]) => hero.season > olderSeason)
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
const futureSupportSkill = futureRegularSkills.find(
  (skill) => !setupSkills.includes(skill)
);
const eligibleSupportHero = eligibleHeroes.find(
  (hero) => !setupHeroes.includes(hero)
);
const eligibleSupportSkill = eligibleOrangeSkills.find(
  (skill) => !setupSkills.includes(skill)
);

async function chooseSeason(page, season) {
  const selector = page.getByRole('combobox', { name: '当前赛季' });
  await selector.click();
  await page.getByRole('option', { name: `赛季 ${season}` }).click();
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

test.describe('Season selection', () => {
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

  test('limits only support candidates while newer items remain enterable', async ({
    page,
  }) => {
    expect(futureHeroes.length).toBeGreaterThanOrEqual(2);
    expect(futureRegularSkills.length).toBeGreaterThanOrEqual(2);
    expect(setupHeroes).toHaveLength(4);
    expect(setupSkills).toHaveLength(8);
    expect(futureRoundHero).toBeTruthy();
    expect(futureSupportSkill).toBeTruthy();
    expect(eligibleSupportHero).toBeTruthy();
    expect(eligibleSupportSkill).toBeTruthy();

    await page.context().clearCookies();
    await page.goto('/');
    await expect(
      page.getByRole('combobox', { name: '当前赛季' })
    ).toBeVisible({ timeout: 30000 });
    await chooseSeason(page, olderSeason);

    // A newer-season hero and skill remain valid initial-setup entries.
    await selectSetupItems(page);
    await page.getByRole('button', { name: '开始对局' }).click();

    await expect(page.getByText(`赛季 ${olderSeason}`, { exact: true })).toBeVisible();
    await expect(page.getByText('第 1 轮：选择武将')).toBeVisible();

    // Newer-season heroes also remain valid offered-set entries.
    const roundInput = page.getByLabel('添加武将...').first();
    await roundInput.fill(futureRoundHero);
    await expect(
      page.getByRole('option', { name: futureRoundHero })
    ).toBeVisible();
    await page.getByRole('option', { name: futureRoundHero }).click();

    // The same newer-season hero is absent from both support recommendation
    // results and manual support search, while an eligible hero remains.
    await page.getByRole('button', { name: '推荐支援武将' }).click();
    const heroDialog = page.getByRole('dialog');
    await expect(heroDialog).toContainText(eligibleSupportHero);
    await expect(
      heroDialog.getByText(futureRoundHero, { exact: true })
    ).toHaveCount(0);
    const heroSearch = heroDialog.getByLabel('搜索武将...');
    await heroSearch.fill(futureRoundHero);
    await expect(page.getByText('无匹配结果')).toBeVisible();
    await heroDialog.getByRole('button', { name: '关闭' }).click();

    // Support skills use the same season boundary.
    await page.getByRole('button', { name: '推荐支援战法' }).click();
    const skillDialog = page.getByRole('dialog');
    await expect(skillDialog).toContainText(eligibleSupportSkill);
    await expect(
      skillDialog.getByText(futureSupportSkill, { exact: true })
    ).toHaveCount(0);
    const skillSearch = skillDialog.getByLabel('搜索战法...');
    await skillSearch.fill(futureSupportSkill);
    await expect(page.getByText('无匹配结果')).toBeVisible();
  });
});
