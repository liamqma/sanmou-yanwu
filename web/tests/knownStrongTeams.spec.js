const { test, expect } = require('@playwright/test');
const {
  database,
  seedGame,
  makeGameState,
  heroesWithMeta,
  anySkills,
} = require('./helpers');

const anchorComp =
  database.team.find((team) => team.sources.includes('championship')) ||
  database.team[0];
const anchorHeroes = anchorComp.members.map((member) => member.hero);
const extraHero = heroesWithMeta.find((hero) => !anchorHeroes.includes(hero));
const team = extraHero ? [...anchorHeroes, extraHero] : anchorHeroes;
const heroCandidates = heroesWithMeta
  .filter((hero) => !team.includes(hero))
  .slice(0, 9);
const heroInputs = {
  set1: heroCandidates.slice(0, 3),
  set2: heroCandidates.slice(3, 6),
  set3: heroCandidates.slice(6, 9),
};

const anchorSkills = [
  ...new Set(
    anchorComp.members.flatMap((member) => member.skillSlots.flat())
  ),
];
const ownedAnchorSkill = anchorSkills[0];
const candidateAnchorSkill = anchorSkills.find(
  (skill) => skill !== ownedAnchorSkill
);
const nonAnchorSkills = Object.keys(database.skills).filter(
  (skill) => !anchorSkills.includes(skill)
);
const ownedSkills = [
  ownedAnchorSkill,
  ...nonAnchorSkills,
].filter(Boolean).slice(0, 8);
const candidateSkills = [
  candidateAnchorSkill,
  ...Object.keys(database.skills).filter(
    (skill) =>
      !ownedSkills.includes(skill) && skill !== candidateAnchorSkill
  ),
].filter(Boolean).slice(0, 9);
const skillInputs = {
  set1: candidateSkills.slice(0, 3),
  set2: candidateSkills.slice(3, 6),
  set3: candidateSkills.slice(6, 9),
};

const anchorCard = (page) =>
  page
    .getByTestId('known-team-card')
    .filter({ hasText: anchorHeroes[0] })
    .filter({ hasText: anchorHeroes[1] })
    .filter({ hasText: anchorHeroes[2] })
    .first();

test.describe('本轮阵容方向 panel', () => {
  test('hero round shows relevant heroes only, above AI 推荐', async ({ page }) => {
    await seedGame(
      page,
      makeGameState({
        roundNumber: 1,
        heroes: team,
        skills: anySkills(8),
      }),
      heroInputs
    );

    await page.getByRole('button', { name: '获取 AI 推荐' }).click();

    const panelHeading = page.getByRole('heading', { name: '本轮阵容方向' });
    await expect(panelHeading).toBeVisible({ timeout: 15000 });
    const cards = page.getByTestId('known-team-card');
    expect(await cards.count()).toBeLessThanOrEqual(6);
    expect(await cards.count()).toBeGreaterThan(0);
    await expect(cards.first().getByTestId('known-team-skill-slot')).toHaveCount(0);
    await expect(cards.first().getByText('本轮可获得', { exact: true }).first())
      .toBeVisible();
    await expect(page.getByRole('link', { name: '查看完整阵容库' }))
      .toHaveAttribute('href', '/guides/yanwu');
    await expect(page.getByRole('link', { name: '查看完整阵容库' }))
      .toHaveAttribute('target', '_blank');
    await expect(
      page.getByText('从本轮武将中提炼少量可衔接的成型方向。')
    ).toHaveCount(0);

    const panelBox = await panelHeading.boundingBox();
    const recBox = await page.getByRole('heading', { name: 'AI 推荐' }).boundingBox();
    expect(panelBox.y).toBeLessThan(recBox.y);
  });

  test('hero round caps the shortlist instead of rendering every matching build', async ({ page }) => {
    await seedGame(
      page,
      makeGameState({
        roundNumber: 1,
        heroes: team,
        skills: anySkills(8),
      }),
      heroInputs
    );

    await page.getByRole('button', { name: '获取 AI 推荐' }).click();
    await expect(page.getByRole('heading', { name: '本轮阵容方向' }))
      .toBeVisible({ timeout: 15000 });

    const cards = page.getByTestId('known-team-card');
    expect(await cards.count()).toBeGreaterThan(0);
    expect(await cards.count()).toBeLessThanOrEqual(6);
    await expect(page.getByText(/共 \d+ 组/)).toHaveCount(0);
  });

  test('skill round adds both skill slots and exact availability labels', async ({ page }) => {
    await seedGame(
      page,
      makeGameState({
        roundNumber: 2,
        heroes: team,
        skills: ownedSkills,
      }),
      skillInputs
    );

    await page.getByRole('button', { name: '获取 AI 推荐' }).click();
    await expect(page.getByRole('heading', { name: '本轮阵容方向' }))
      .toBeVisible({ timeout: 15000 });

    expect(await page.getByTestId('known-team-card').count()).toBeLessThanOrEqual(4);
    const card = anchorCard(page);
    await expect(card).toBeVisible();
    await expect(card.getByTestId('known-team-skill-slot')).toHaveCount(6);
    await expect(card.getByLabel(`${ownedAnchorSkill}：已获得`)).toBeVisible();
    if (candidateAnchorSkill) {
      await expect(
        card.getByLabel(`${candidateAnchorSkill}：本轮可获得`)
      ).toBeVisible();
    }
    const missingAnchorSkill = anchorSkills.find(
      (skill) =>
        !ownedSkills.includes(skill) && !candidateSkills.includes(skill)
    );
    if (missingAnchorSkill) {
      await expect(
        card.getByLabel(`${missingAnchorSkill}：尚未获得`)
      ).toBeVisible();
    }
    await expect(card.getByText('已获得', { exact: true }).first()).toBeVisible();
    await expect(card.getByText('本轮可获得', { exact: true }).first())
      .toBeVisible();
  });
});
