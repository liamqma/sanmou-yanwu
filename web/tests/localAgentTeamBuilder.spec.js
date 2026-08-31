const { test, expect } = require('@playwright/test');
const database = require('../public/game-data/database.json');
const { seedStoredProgress } = require('./helpers');

const signatureSkills = new Set(
  Object.values(database.heroes).map((hero) => hero.skill)
);
const heroes = Object.keys(database.heroes).sort().slice(0, 4);
const skills = Object.keys(database.skills)
  .filter((skill) => !signatureSkills.has(skill))
  .sort()
  .slice(0, 5);
const fullHeroes = Object.keys(database.heroes).sort().slice(0, 9);
const fullSkills = Object.keys(database.skills)
  .filter((skill) => !signatureSkills.has(skill))
  .sort()
  .slice(0, 18);
const formations = Object.keys(database.formations).slice(0, 3);

const progress = {
  gameState: {
    current_heroes: heroes,
    current_skills: skills,
    support_hero: null,
    support_skills: [],
    round_number: 1,
    round_history: [],
  },
  currentRoundInputs: { set1: [], set2: [], set3: [] },
};

const fullProgress = {
  ...progress,
  gameState: {
    ...progress.gameState,
    current_heroes: fullHeroes,
    current_skills: fullSkills,
  },
};

const fullLayout = Array.from({ length: 3 }, (_, teamIndex) => ({
  formation: formations[teamIndex],
  heroes: Array.from({ length: 3 }, (_, slotIndex) => {
    const resourceIndex = teamIndex * 3 + slotIndex;
    return {
      hero: fullHeroes[resourceIndex],
      row: slotIndex === 0 ? '前排' : '后排',
      skills: [
        fullSkills[resourceIndex * 2],
        fullSkills[resourceIndex * 2 + 1],
      ],
    };
  }),
}));

const emptyTeams = () =>
  Array.from({ length: 3 }, () => ({
    formation: null,
    heroes: Array.from({ length: 3 }, () => ({
      hero: null,
      row: null,
      skills: [null, null],
    })),
  }));

async function openBuilder(page, query = '') {
  await page.goto(`/${query}`);
  await expect(
    page.getByRole('heading', { level: 2, name: '队伍策案' })
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole('heading', { name: '我的比赛阵容' })
  ).toBeVisible({ timeout: 30000 });
}

async function mockLocalAgent(
  page,
  result,
  onRequest = () => {},
  beforeResponse = async () => {}
) {
  await page.route('http://127.0.0.1:8790/**', async (route) => {
    const request = route.request();
    const corsHeaders = {
      'access-control-allow-origin': 'http://localhost:3000',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    if (request.url().endsWith('/health/ready')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ status: 'ready', model: 'test-model' }),
      });
      return;
    }
    onRequest(request.postDataJSON());
    await beforeResponse();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify(result),
    });
  });
}

test.describe('private local Team Agent experiment', () => {
  test.beforeEach(async ({ page }) => {
    await seedStoredProgress(page, progress);
    const layout = emptyTeams().map((team) => ({
      formation: team.formation ?? '',
      heroes: team.heroes.map((hero) => ({
        hero: hero.hero,
        row: hero.row ?? '前排',
        skills: hero.skills,
      })),
    }));
    layout[0].formation = formations[0];
    await page.addInitScript(
      ({ storedLayout, poolKey }) => {
        localStorage.setItem(
          'teamBuilder',
          JSON.stringify({
            version: 3,
            poolKey,
            recommendationPoolKey: poolKey,
            layout: storedLayout,
          })
        );
      },
      {
        storedLayout: layout,
        poolKey: JSON.stringify({
          heroes: [...heroes].sort(),
          skills: [...skills].sort(),
        }),
      }
    );
  });

  test('is hidden by default and only contacts localhost after an explicit click', async ({
    page,
  }) => {
    let localRequests = 0;
    page.on('request', (request) => {
      if (request.url().startsWith('http://127.0.0.1:8790')) {
        localRequests += 1;
      }
    });

    await openBuilder(page);

    await expect(
      page.getByRole('button', { name: /智能(?:补全|复盘)阵容/ })
    ).toHaveCount(0);
    expect(localRequests).toBe(0);
  });

  test('applies validated partial progress and can undo it', async ({ page }) => {
    const agentTeams = emptyTeams();
    agentTeams[0].heroes[0] = {
      hero: heroes[0],
      row: null,
      skills: [null, null],
    };
    const response = {
      teams: agentTeams,
      status: 'incomplete',
      stoppedAt: 'heroes',
      attempts: { heroes: 3, formations: 0, skills: 0, review: 0 },
      heroAssignments: [],
      formationDecisions: [],
      skillAssignments: [],
      review: null,
      warnings: ['没有足够的通过校验候选武将，未猜测剩余位置。'],
    };
    let postedBody;
    await mockLocalAgent(page, response, (body) => {
      postedBody = body;
    });
    await openBuilder(page, '?local-agent=1');

    await page.getByRole('button', { name: '智能补全阵容' }).click();

    await expect(page.getByTestId('local-agent-result')).toBeVisible();
    await expect(page.getByTestId('hero-slot-0-0')).toContainText(heroes[0]);
    await expect(page.getByText(/“武将补全”阶段/)).toBeVisible();
    await expect(
      page.getByText('没有足够的通过校验候选武将，未猜测剩余位置。')
    ).toBeVisible();
    expect(postedBody.availableHeroes).toEqual(heroes);
    expect(postedBody.availableSkills).toEqual(skills);
    expect(postedBody.teams[0].heroes[0].row).toBeNull();
    expect(Number.isInteger(postedBody.season)).toBe(true);

    await page.getByRole('button', { name: '撤销智能补全' }).click();
    // The confirmation is intentionally transient, so observe it before
    // assertions that may be delayed by a loaded parallel CI worker.
    await expect(page.getByText('已撤销本次智能补全')).toBeVisible();
    await expect(page.getByTestId('local-agent-result')).toHaveCount(0);
    await expect(page.getByTestId(`pool-hero-${heroes[0]}`)).toBeVisible();
  });

  test('reviews a complete lineup without replacing it', async ({ page }) => {
    await seedStoredProgress(page, fullProgress);
    await page.addInitScript(
      ({ layout, poolKey }) => {
        localStorage.setItem(
          'teamBuilder',
          JSON.stringify({ version: 2, poolKey, layout })
        );
      },
      {
        layout: fullLayout,
        poolKey: JSON.stringify({
          heroes: [...fullHeroes].sort(),
          skills: [...fullSkills].sort(),
        }),
      }
    );

    const response = {
      teams: fullLayout,
      status: 'complete',
      stoppedAt: null,
      attempts: { heroes: 0, formations: 0, skills: 0, review: 1 },
      heroAssignments: [],
      formationDecisions: [],
      skillAssignments: [],
      review: {
        status: 'complete',
        verdict: 'workable',
        teams: [
          {
            teamIndex: 0,
            verdict: 'workable',
            strengths: [],
            warnings: [
              {
                severity: 'warning',
                category: 'position',
                message: '第一队后排保护不足',
                suggestedAction: '优先检查前排承伤能力',
                evidence: [{ source: 'formation', id: formations[0] }],
              },
            ],
          },
        ],
        crossTeamWarnings: [],
        deterministicRuleWarnings: [],
        attempts: 1,
        warnings: [],
      },
      warnings: [],
    };
    let postedBody;
    await mockLocalAgent(page, response, (body) => {
      postedBody = body;
    });
    await openBuilder(page, '?local-agent=1');
    const firstSlot = page.getByTestId('hero-slot-0-0');
    await expect(firstSlot).toContainText(fullHeroes[0]);

    await page.getByRole('button', { name: '智能复盘阵容' }).click();

    await expect(
      page.getByRole('region', { name: '智能复盘结果' })
    ).toBeVisible();
    await expect(page.getByText('总体结论：可用但可改进')).toBeVisible();
    await expect(page.getByText('第一队后排保护不足')).toBeVisible();
    await expect(
      page.getByRole('button', { name: '撤销智能补全' })
    ).toHaveCount(0);
    await expect(firstSlot).toContainText(fullHeroes[0]);
    expect(postedBody.availableHeroes).toEqual([]);
    expect(postedBody.availableSkills).toEqual([]);
  });

  test('ignores a response when the lineup changes while the Agent is running', async ({
    page,
  }) => {
    const agentTeams = emptyTeams();
    agentTeams[0].heroes[0] = {
      hero: heroes[0],
      row: null,
      skills: [null, null],
    };
    const response = {
      teams: agentTeams,
      status: 'incomplete',
      stoppedAt: 'heroes',
      attempts: { heroes: 1, formations: 0, skills: 0, review: 0 },
      heroAssignments: [],
      formationDecisions: [],
      skillAssignments: [],
      review: null,
      warnings: [],
    };
    let releaseResponse;
    let posted = false;
    const responseGate = new Promise((resolve) => {
      releaseResponse = resolve;
    });
    await mockLocalAgent(
      page,
      response,
      () => {
        posted = true;
      },
      () => responseGate
    );
    await openBuilder(page, '?local-agent=1');

    await page.getByRole('button', { name: '智能补全阵容' }).click();
    await expect.poll(() => posted).toBe(true);
    await page.getByTestId(`pool-hero-${heroes[1]}`).click();
    await page.getByTestId('hero-slot-0-0').click();
    await expect(page.getByTestId('hero-slot-0-0')).toContainText(heroes[1]);
    releaseResponse();

    await expect(
      page.getByText('等待期间阵容已修改，本次 Agent 结果已忽略')
    ).toBeVisible();
    await expect(page.getByTestId('hero-slot-0-0')).toContainText(heroes[1]);
    await expect(page.getByTestId('local-agent-result')).toHaveCount(0);
  });
});
