const { test, expect } = require('@playwright/test');
const recommendationData = require('../src/recommendation_data.json');

const panel = (page) => page.getByTestId('relationship-ranking-panel');

const GROUP_FOR_FAMILY = {
  HP: '武将搭配',
  HT: '武将搭配',
  HS: '战法搭配',
  THS: '战法搭配',
  B: '特殊加成',
  M: '特殊加成',
};
const MODE_FOR_FAMILY = {
  HP: '两人同队',
  HT: '三人同队',
  HS: '自己携带',
  THS: '队内战法',
  B: '缘分',
  M: '机制联动',
};
const RELATION_LABELS = {
  benefits_from: '受益于',
  requires: '需要',
  consumes: '消耗',
};

function rankedFeatures(family) {
  return Object.entries(recommendationData.model.weights)
    .filter(([featureId]) => featureId.startsWith(`${family}|`))
    .sort(([leftId, leftWeight], [rightId, rightWeight]) =>
      rightWeight - leftWeight || (leftId < rightId ? -1 : leftId > rightId ? 1 : 0)
    );
}

async function activateFamily(page, family) {
  const relationshipPanel = panel(page);
  const group = relationshipPanel.getByRole('button', {
    name: GROUP_FOR_FAMILY[family],
    exact: true,
  });
  await group.click();
  const mode = relationshipPanel.getByRole('button', {
    name: MODE_FOR_FAMILY[family],
    exact: true,
  });
  await mode.click();
  await expect(mode).toHaveAttribute('aria-pressed', 'true');
  await expect(
    relationshipPanel.getByRole('region', {
      name: `${MODE_FOR_FAMILY[family]}关系排名表格，可滚动`,
    })
  ).toBeVisible();
}

async function activeRows(page) {
  const rows = panel(page).getByTestId('relationship-ranking-row');
  const count = await rows.count();
  const result = [];
  for (let index = 0; index < count; index += 1) {
    const current = rows.nth(index);
    result.push({
      rank: Number((await current.locator('td').nth(0).innerText()).trim()),
      label: (await current.locator('td').nth(1).innerText()).trim(),
    });
  }
  return result;
}

async function addFilter(page, placeholder, value) {
  const input = page.getByPlaceholder(placeholder);
  await input.click();
  await input.fill(value);
  await page.getByRole('option').filter({ hasText: value }).first().click();
}

const HERO_PLACEHOLDER = '输入武将名或拼音...';
const SKILL_PLACEHOLDER = '输入战法名或拼音...';

test('unified relationship panel renders all six independent families with exact semantics', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/analytics');

  const relationshipPanel = panel(page);
  await expect(
    relationshipPanel.getByRole('heading', { name: '关系搭配排名', exact: true })
  ).toBeVisible();
  await expect(
    relationshipPanel.getByRole('button', { name: '武将搭配', exact: true })
  ).toBeVisible();
  await expect(
    relationshipPanel.getByRole('button', { name: '战法搭配', exact: true })
  ).toBeVisible();
  await expect(
    relationshipPanel.getByRole('button', { name: '特殊加成', exact: true })
  ).toBeVisible();
  await expect(page.getByText('最搭的武将组合', { exact: true })).toHaveCount(0);
  await expect(page.getByText('最搭的武将与战法', { exact: true })).toHaveCount(0);

  const exposedFamilies = new Set();
  for (const group of ['武将搭配', '战法搭配', '特殊加成']) {
    await relationshipPanel.getByRole('button', { name: group, exact: true }).click();
    const values = await relationshipPanel
      .locator('[data-relationship-family]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-relationship-family')));
    values.forEach((value) => exposedFamilies.add(value));
  }
  expect([...exposedFamilies].sort()).toEqual(['B', 'HP', 'HS', 'HT', 'M', 'THS']);
  for (const excluded of ['HC', 'SP', 'TSP', 'TS3']) {
    expect(exposedFamilies.has(excluded)).toBe(false);
  }

  await activateFamily(page, 'HP');
  const hpId = rankedFeatures('HP')[0][0];
  const hpNames = hpId.split('|').slice(1);
  let firstRow = relationshipPanel.getByTestId('relationship-ranking-row').first();
  await expect(firstRow).toContainText('同队');
  await expect(firstRow.getByTestId('relationship-hero')).toHaveText(hpNames);

  await activateFamily(page, 'HT');
  const htNames = rankedFeatures('HT')[0][0].split('|').slice(1);
  firstRow = relationshipPanel.getByTestId('relationship-ranking-row').first();
  await expect(firstRow).toContainText('三人同队');
  await expect(firstRow.getByTestId('relationship-hero')).toHaveText(htNames);

  await activateFamily(page, 'HS');
  const [, hsHero, hsSkill] = rankedFeatures('HS')[0][0].split('|');
  firstRow = relationshipPanel.getByTestId('relationship-ranking-row').first();
  await expect(firstRow).toContainText('携带');
  await expect(firstRow.getByTestId('relationship-hero')).toHaveText([hsHero]);
  await expect(firstRow.getByTestId('relationship-skill')).toHaveText([hsSkill]);

  await activateFamily(page, 'THS');
  const [, thsHero, thsSkill] = rankedFeatures('THS')[0][0].split('|');
  firstRow = relationshipPanel.getByTestId('relationship-ranking-row').first();
  await expect(firstRow).toContainText('队内存在');
  await expect(firstRow).not.toContainText('队友携带');
  await expect(firstRow.getByTestId('relationship-hero')).toHaveText([thsHero]);
  await expect(firstRow.getByTestId('relationship-skill')).toHaveText([thsSkill]);
  await expect(relationshipPanel).not.toContainText('队友携带');

  await activateFamily(page, 'B');
  const bondName = rankedFeatures('B')[0][0].split('|')[1];
  const bond = recommendationData.catalog.relationships.bonds.find(
    (candidate) => candidate.name === bondName
  );
  expect(bond).toBeTruthy();
  firstRow = relationshipPanel.getByTestId('relationship-ranking-row').first();
  await expect(firstRow).toContainText(bond.name);
  await expect(firstRow).toContainText(`需要 ${bond.required_members} 名成员激活`);
  const memberDisclosure = firstRow.locator('summary');
  await expect(memberDisclosure).toHaveAttribute(
    'aria-label',
    `查看缘分成员：${bond.members.join('、')}`
  );
  await memberDisclosure.click();
  await expect(firstRow.getByTestId('relationship-hero')).toHaveText(bond.members);

  await activateFamily(page, 'M');
  const [, mechanicId, relation, side] = rankedFeatures('M')[0][0].split('|');
  const mechanicName = recommendationData.catalog.mechanics.mechanic_names[mechanicId];
  firstRow = relationshipPanel.getByTestId('relationship-ranking-row').first();
  await expect(firstRow).toContainText(mechanicName);
  await expect(firstRow).toContainText(`联动方式：${RELATION_LABELS[relation]}`);
  await expect(firstRow).toContainText(`作用侧：${side === 'enemy' ? '敌方' : '友方'}`);
  await expect(firstRow).toContainText('汇总机制关系');
  await expect(firstRow).toContainText('该组合分不属于任何一对具体战法');
  await expect(firstRow).not.toContainText(mechanicId);
  await expect(firstRow.getByTestId('relationship-skill')).toHaveCount(0);

  const headers = await relationshipPanel.getByRole('columnheader').allInnerTexts();
  expect(headers.map((header) => header.trim())).toEqual([
    '排名',
    '搭配',
    '组合分',
    '参考场次',
  ]);
});

test('all relationship filters preserve full-list ranks and ignore inapplicable identities', async ({ page }) => {
  const cases = [
    { family: 'HP', filter: 'hero' },
    { family: 'HT', filter: 'hero' },
    { family: 'HS', filter: 'hero' },
    { family: 'THS', filter: 'skill' },
    { family: 'B', filter: 'bond-member' },
  ];

  for (const { family, filter } of cases) {
    await page.goto('/analytics');
    await activateFamily(page, family);
    const before = await activeRows(page);
    expect(before.length).toBeGreaterThan(4);
    before.forEach(({ rank }, index) => expect(rank).toBe(index + 1));
    const targetIndex = 4;
    const familyFeatures = rankedFeatures(family);
    const featureId = familyFeatures[targetIndex][0];
    const parts = featureId.split('|').slice(1);
    let filterValue;

    if (filter === 'hero') {
      filterValue = parts[0];
      await addFilter(page, HERO_PLACEHOLDER, filterValue);
    } else if (filter === 'skill') {
      filterValue = parts[1];
      await addFilter(page, SKILL_PLACEHOLDER, filterValue);
    } else {
      const bond = recommendationData.catalog.relationships.bonds.find(
        (candidate) => candidate.name === parts[0]
      );
      filterValue = bond.members[0];
      await addFilter(page, HERO_PLACEHOLDER, filterValue);
    }

    const expectedRanks = familyFeatures
      .map(([candidateId], index) => ({
        rank: index + 1,
        parts: candidateId.split('|').slice(1),
      }))
      .filter(({ parts: candidateParts }) => {
        if (filter === 'hero') {
          return family === 'HP' || family === 'HT'
            ? candidateParts.includes(filterValue)
            : candidateParts[0] === filterValue;
        }
        if (filter === 'skill') return candidateParts[1] === filterValue;
        const bond = recommendationData.catalog.relationships.bonds.find(
          (candidate) => candidate.name === candidateParts[0]
        );
        return bond.members.includes(filterValue);
      })
      .slice(0, 40)
      .map(({ rank }) => rank);
    const after = await activeRows(page);
    expect(after.map(({ rank }) => rank)).toEqual(expectedRanks);
    expect(after.some(({ rank }) => rank === targetIndex + 1)).toBe(true);
  }

  // A skill has no precise meaning for HP and must neither filter nor be described as applied.
  await page.goto('/analytics');
  await activateFamily(page, 'HP');
  const hpBefore = await activeRows(page);
  await addFilter(page, SKILL_PLACEHOLDER, '折冲御侮');
  expect(await activeRows(page)).toEqual(hpBefore);
  await expect(panel(page).getByRole('status')).toContainText('战法筛选不适用于此关系类型');
  await expect(panel(page).getByRole('status')).not.toContainText('已按');

  // M is an aggregate relationship, so both global filters leave its full ranking unchanged.
  await page.goto('/analytics');
  await activateFamily(page, 'M');
  const mechanicBefore = await activeRows(page);
  await addFilter(page, HERO_PLACEHOLDER, '祝融');
  await addFilter(page, SKILL_PLACEHOLDER, '折冲御侮');
  expect(await activeRows(page)).toEqual(mechanicBefore);
  await expect(panel(page).getByRole('status')).toContainText(
    '武将和战法筛选不适用于此榜，未应用；当前显示'
  );
});

test('relationship rows progressively disclose after filtering and reset per query', async ({ page }) => {
  await page.goto('/analytics');
  const relationshipPanel = panel(page);
  const hpCount = rankedFeatures('HP').length;

  await activateFamily(page, 'HP');
  await expect(relationshipPanel.getByTestId('relationship-ranking-row')).toHaveCount(40);
  await expect(relationshipPanel.getByRole('status')).toContainText(`当前显示 40 / ${hpCount}`);
  const more = relationshipPanel.getByRole('button', {
    name: '显示更多两人同队关系：再显示 40 条',
  });
  await expect(more).toBeVisible();
  await more.click();
  await expect(relationshipPanel.getByTestId('relationship-ranking-row')).toHaveCount(80);
  await expect(relationshipPanel.getByRole('status')).toContainText(`当前显示 80 / ${hpCount}`);

  for (const family of ['HT', 'B', 'M']) {
    await activateFamily(page, family);
    await expect(relationshipPanel.getByTestId('relationship-ranking-row')).toHaveCount(
      rankedFeatures(family).length
    );
    await expect(relationshipPanel.getByTestId('relationship-show-more')).toHaveCount(0);
  }

  await activateFamily(page, 'HP');
  await expect(relationshipPanel.getByTestId('relationship-ranking-row')).toHaveCount(40);
  await relationshipPanel.getByTestId('relationship-show-more').click();
  await expect(relationshipPanel.getByTestId('relationship-ranking-row')).toHaveCount(80);
  await addFilter(page, SKILL_PLACEHOLDER, '折冲御侮');
  await expect(relationshipPanel.getByTestId('relationship-ranking-row')).toHaveCount(40);
  await expect(relationshipPanel.getByRole('status')).toContainText(
    '战法筛选不适用于此关系类型，未应用'
  );
});

test('filtering can surface a globally lower-ranked relationship immediately', async ({ page }) => {
  const features = rankedFeatures('HP');
  let target = null;
  for (let index = 40; index < features.length && !target; index += 1) {
    const heroes = features[index][0].split('|').slice(1);
    for (const hero of heroes) {
      const priorMatches = features
        .slice(0, index)
        .filter(([featureId]) => featureId.split('|').slice(1).includes(hero)).length;
      if (priorMatches < 40) {
        target = { hero, rank: index + 1 };
        break;
      }
    }
  }
  expect(target).toBeTruthy();

  await page.goto('/analytics');
  await activateFamily(page, 'HP');
  await addFilter(page, HERO_PLACEHOLDER, target.hero);

  const matchingRanks = features
    .map(([featureId], index) => ({
      rank: index + 1,
      matches: featureId.split('|').slice(1).includes(target.hero),
    }))
    .filter(({ matches }) => matches)
    .map(({ rank }) => rank);
  const rendered = await activeRows(page);
  expect(rendered.map(({ rank }) => rank)).toEqual(matchingRanks.slice(0, 40));
  expect(rendered.some(({ rank }) => rank === target.rank)).toBe(true);
  await expect(panel(page).getByRole('status')).toContainText(
    `所选武将匹配 ${matchingRanks.length} / ${features.length} 条全榜关系`
  );
});

test('negative fitted relationships remain reachable', async ({ page }) => {
  const mechanics = rankedFeatures('M');
  const negativeIndex = mechanics.findIndex(([, weight]) => weight < 0);
  expect(negativeIndex).toBeGreaterThanOrEqual(0);

  await page.goto('/analytics');
  await activateFamily(page, 'M');
  const row = panel(page).getByTestId('relationship-ranking-row').nth(negativeIndex);
  await expect(row.locator('td').first()).toHaveText(String(negativeIndex + 1));
  await expect(row.locator('td').nth(2)).toContainText('−');
});

test('two-level selectors work by keyboard and the ranking stays compact at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/analytics');

  const relationshipPanel = panel(page);
  const skillsGroup = relationshipPanel.getByRole('button', {
    name: '战法搭配',
    exact: true,
  });
  await skillsGroup.focus();
  await page.keyboard.press('Enter');
  await expect(skillsGroup).toHaveAttribute('aria-pressed', 'true');
  await expect(
    relationshipPanel.getByRole('button', { name: '自己携带', exact: true })
  ).toBeVisible();
  await expect(
    relationshipPanel.getByRole('button', { name: '队内战法', exact: true })
  ).toBeVisible();

  const teamSkillMode = relationshipPanel.getByRole('button', {
    name: '队内战法',
    exact: true,
  });
  await teamSkillMode.focus();
  await page.keyboard.press('Space');
  await expect(teamSkillMode).toHaveAttribute('aria-pressed', 'true');
  await expect(teamSkillMode).toHaveAttribute('aria-controls', 'relationship-ranking-table');

  const tableRegion = relationshipPanel.getByRole('region', {
    name: '队内战法关系排名表格，可滚动',
  });
  await expect(tableRegion).toHaveAttribute('tabindex', '0');
  await expect(tableRegion.getByRole('columnheader')).toHaveCount(4);
  await expect(relationshipPanel.getByTestId('relationship-ranking-row')).toHaveCount(40);
  const more = relationshipPanel.getByRole('button', {
    name: '显示更多队内战法关系：再显示 40 条',
  });
  await expect(more).toBeVisible();
  await expect(more).toHaveAttribute('aria-controls', 'relationship-ranking-table');
  await expect(relationshipPanel).not.toContainText('队友携带');

  const geometry = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="relationship-ranking-panel"]');
    const region = document.querySelector('#relationship-ranking-table');
    const moreButton = document.querySelector('[data-testid="relationship-show-more"]');
    return {
      bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cardRight: card?.getBoundingClientRect().right ?? Infinity,
      regionRight: region?.getBoundingClientRect().right ?? Infinity,
      moreRight: moreButton?.getBoundingClientRect().right ?? Infinity,
      viewport: window.innerWidth,
    };
  });
  expect(geometry.bodyOverflow).toBeLessThanOrEqual(1);
  expect(geometry.cardRight).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.regionRight).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.moreRight).toBeLessThanOrEqual(geometry.viewport + 1);
});
