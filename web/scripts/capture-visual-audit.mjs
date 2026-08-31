import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.VISUAL_AUDIT_BASE_URL || 'http://localhost:3000';
const outputDir = path.resolve(process.argv[2] || '/tmp/sanmou-visual-audit');
const database = JSON.parse(
  await readFile(new URL('../public/game-data/database.json', import.meta.url), 'utf8'),
);
const assetManifest = JSON.parse(
  await readFile(new URL('../public/game-assets/manifest.json', import.meta.url), 'utf8'),
);

const routes = [
  ['advisor', '/'],
  ['analytics', '/analytics'],
  ['contribute', '/contribute'],
  ['contributors', '/contributors'],
  ['guide', '/guides/yanwu'],
  ['not-found', '/route-that-does-not-exist'],
];

const viewports = {
  desktop: { width: 1440, height: 1000 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};

const heroes = Object.keys(database.heroes);
const skills = Object.keys(assetManifest.tactics).filter((name) => database.skills[name]);
const report = [];

const progress = (gameState, currentRoundInputs = { set1: [], set2: [], set3: [] }) =>
  JSON.stringify({ version: 1, gameState, currentRoundInputs });

const addProgress = async (context, value) => {
  await context.addInitScript((stored) => {
    localStorage.setItem('gameProgress', stored);
  }, value);
};

const addTeamBuilderLayout = async (context, { heroes, skills, layout }) => {
  await context.addInitScript(
    ({ poolKey, storedLayout }) => {
      localStorage.setItem(
        'teamBuilder',
        JSON.stringify({ version: 2, poolKey, layout: storedLayout }),
      );
    },
    {
      poolKey: JSON.stringify({
        heroes: [...heroes].sort(),
        skills: [...skills].sort(),
      }),
      storedLayout: layout,
    },
  );
};

const inspectPage = async (page, name, errors) => {
  const diagnostics = await page.evaluate(() => {
    const root = document.documentElement;
    const darkSurfaces = [...document.querySelectorAll('body *')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width < 80 || rect.height < 32) return false;
        if (element.closest('[data-testid^="game-card-"]')) return false;
        if (element.closest('.MuiTouchRipple-root')) return false;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const match = style.backgroundColor.match(
          /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/,
        );
        if (!match || Number(match[4] ?? 1) < 0.9) return false;
        return [match[1], match[2], match[3]].every((channel) => Number(channel) < 55);
      })
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName,
        className: String(element.className).slice(0, 100),
        background: getComputedStyle(element).backgroundColor,
        text: element.textContent?.trim().slice(0, 60),
      }));
    return {
      title: document.title,
      headings: [...document.querySelectorAll('h1, h2, h3')]
        .filter((heading) => {
          const style = getComputedStyle(heading);
          return style.display !== 'none' && style.visibility !== 'hidden';
        })
        .map((heading) => `${heading.tagName}:${heading.textContent?.trim()}`),
      horizontalOverflow: root.scrollWidth - root.clientWidth,
      darkSurfaces,
    };
  });
  report.push({ name, errors, ...diagnostics });
};

const openAuditedPage = async (context) => {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  return { page, errors };
};

const capture = async (
  browser,
  { name, route, viewport, seed, teamBuilderLayout, prepare },
) => {
  console.log(`Capturing ${name}`);
  const context = await browser.newContext({ viewport, colorScheme: 'light' });
  if (seed) await addProgress(context, seed);
  if (teamBuilderLayout) await addTeamBuilderLayout(context, teamBuilderLayout);
  const { page, errors } = await openAuditedPage(context);
  await page.goto(`${baseURL}${route}`, { waitUntil: 'networkidle' });
  try {
    await page.locator('main').waitFor({ state: 'visible', timeout: 15000 });
  } catch (error) {
    console.error(JSON.stringify({ name, errors, body: await page.locator('body').innerText() }, null, 2));
    await page.screenshot({ path: path.join(outputDir, `failed--${name}.png`), fullPage: true });
    throw error;
  }
  if (prepare) await prepare(page);
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });
  await inspectPage(page, name, errors);
  await context.close();
};

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch();

try {
  for (const [viewportName, viewport] of Object.entries(viewports)) {
    for (const [routeName, route] of routes) {
      await capture(browser, {
        name: `${viewportName}--${routeName}`,
        route,
        viewport,
      });
    }
  }

  const roundOneState = {
    current_heroes: heroes.slice(0, 4),
    current_skills: skills.slice(0, 8),
    support_hero: null,
    support_skills: [],
    round_number: 1,
    round_history: [],
  };
  const roundOneInputs = {
    set1: heroes.slice(4, 7),
    set2: heroes.slice(7, 10),
    set3: heroes.slice(10, 13),
  };
  for (const [viewportName, viewport] of Object.entries({ desktop: viewports.desktop, mobile: viewports.mobile })) {
    await capture(browser, {
      name: `${viewportName}--round-recommendation`,
      route: '/',
      viewport,
      seed: progress(roundOneState, roundOneInputs),
      prepare: async (page) => {
        await page.getByRole('button', { name: '获取 AI 推荐' }).click();
        await page.getByTestId('three-option-grid').waitFor();
      },
    });
  }

  await capture(browser, {
    name: 'mobile--round-roster-expanded',
    route: '/',
    viewport: viewports.mobile,
    seed: progress(roundOneState, roundOneInputs),
    prepare: async (page) => {
      await page.getByRole('button', { name: '获取 AI 推荐' }).click();
      await page.getByTestId('three-option-grid').waitFor();
      await page.getByRole('button', { name: '展开当前阵容与仓库' }).click();
      await page.getByRole('region', { name: '当前阵容' }).waitFor({ state: 'visible' });
      await page.waitForTimeout(500);
    },
  });

  const lateState = {
    current_heroes: heroes.slice(0, 9),
    current_skills: skills.slice(0, 18),
    support_hero: null,
    support_skills: [],
    round_number: 7,
    round_history: [],
    round7_interstitial_dismissed: false,
  };
  await capture(browser, {
    name: 'mobile--qualification-interstitial',
    route: '/',
    viewport: viewports.mobile,
    seed: progress(lateState),
  });

  await capture(browser, {
    name: 'desktop--team-builder-populated',
    route: '/',
    viewport: viewports.desktop,
    seed: progress({ ...lateState, round7_interstitial_dismissed: true }),
    prepare: async (page) => {
      await page.getByRole('heading', { name: '我的比赛阵容' }).waitFor({ timeout: 30000 });
    },
  });

  const qualityHero = '皇甫嵩2';
  const qualitySkills = ['忘私相助', '如沐春风'];
  const qualityLayout = Array.from({ length: 3 }, () => ({
    formation: '',
    heroes: Array.from({ length: 3 }, () => ({
      hero: null,
      row: '前排',
      skills: [null, null],
    })),
  }));
  qualityLayout[0].heroes[0].hero = qualityHero;
  qualityLayout[0].heroes[0].skills = [...qualitySkills];
  await capture(browser, {
    name: 'desktop--team-builder-tactic-quality',
    route: '/',
    viewport: viewports.desktop,
    seed: progress({
      ...lateState,
      current_heroes: [qualityHero],
      current_skills: qualitySkills,
      round7_interstitial_dismissed: true,
    }),
    teamBuilderLayout: {
      heroes: [qualityHero],
      skills: qualitySkills,
      layout: qualityLayout,
    },
    prepare: async (page) => {
      await page.getByTestId('skill-slot-0-0-0').waitFor({ timeout: 30000 });
      await page.getByTestId('skill-slot-0-0-1').waitFor({ timeout: 30000 });
    },
  });

  await capture(browser, {
    name: 'desktop--team-builder-relationship-detail',
    route: '/',
    viewport: viewports.desktop,
    seed: progress({
      ...lateState,
      current_heroes: [qualityHero],
      current_skills: qualitySkills,
      round7_interstitial_dismissed: true,
    }),
    teamBuilderLayout: {
      heroes: [qualityHero],
      skills: qualitySkills,
      layout: qualityLayout,
    },
    prepare: async (page) => {
      await page.getByTestId('skill-slot-0-0-0').hover({ position: { x: 12, y: 22 } });
      const relationshipScore = page
        .getByTestId('skill-slot-0-0-1')
        .locator('..')
        .getByTestId('relationship-score');
      await relationshipScore.waitFor();
      await page.waitForTimeout(260);
      await relationshipScore.click();
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(250);
    },
  });

  await capture(browser, {
    name: 'mobile-320--team-builder-tactic-swap',
    route: '/',
    viewport: { width: 320, height: 844 },
    seed: progress({
      ...lateState,
      current_heroes: [qualityHero],
      current_skills: qualitySkills,
      round7_interstitial_dismissed: true,
    }),
    teamBuilderLayout: {
      heroes: [qualityHero],
      skills: qualitySkills,
      layout: qualityLayout,
    },
    prepare: async (page) => {
      const orange = page.locator('[data-testid="skill-slot-0-0-0"]');
      const purpleSurface = page
        .locator('[data-testid="skill-slot-0-0-1"]')
        .locator('..');
      await orange.waitFor();
      await orange.click();
      await purpleSurface.scrollIntoViewIfNeeded();
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid="skill-slot-0-0-1"]')
          ?.parentElement?.matches(
            '[data-team-builder-drop-highlighted="true"]',
          ),
      );
    },
  });

  const teamLoadingContext = await browser.newContext({ viewport: viewports.desktop, colorScheme: 'light' });
  await addProgress(
    teamLoadingContext,
    progress({ ...lateState, round7_interstitial_dismissed: true }),
  );
  const { page: teamLoadingPage, errors: teamLoadingErrors } = await openAuditedPage(teamLoadingContext);
  let releaseTeamWorker;
  const teamWorkerGate = new Promise((resolve) => { releaseTeamWorker = resolve; });
  await teamLoadingPage.route(/teamFormation\.worker\.ts/, async (route) => {
    await teamWorkerGate;
    await route.continue();
  });
  const teamNavigation = teamLoadingPage.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded' });
  await teamLoadingPage.getByTestId('game-loading-panel').waitFor();
  await teamLoadingPage.screenshot({ path: path.join(outputDir, 'desktop--team-builder-loading.png'), fullPage: true });
  await inspectPage(teamLoadingPage, 'desktop--team-builder-loading', teamLoadingErrors);
  releaseTeamWorker();
  await teamNavigation;
  await teamLoadingContext.close();

  await capture(browser, {
    name: 'desktop--completed-game',
    route: '/',
    viewport: viewports.desktop,
    seed: progress({
      ...lateState,
      support_hero: heroes[9],
      support_skills: skills.slice(18, 20),
      round_number: 11,
      round7_interstitial_dismissed: true,
      round9_interstitial_dismissed: true,
    }),
  });

  await capture(browser, {
    name: 'mobile--discussion-dialog',
    route: '/',
    viewport: viewports.mobile,
    prepare: async (page) => {
      await page.getByRole('button', { name: '菜单' }).click();
      await page.getByRole('menuitem', { name: '讨论群' }).click();
      await page.getByRole('dialog', { name: '加演武讨论群' }).waitFor();
      await page.getByRole('menu').waitFor({ state: 'hidden' });
      await page.waitForTimeout(250);
    },
  });

  await capture(browser, {
    name: 'desktop--support-hero-dialog',
    route: '/',
    viewport: viewports.desktop,
    seed: progress(roundOneState, roundOneInputs),
    prepare: async (page) => {
      await page.getByRole('button', { name: '推荐支援武将' }).click();
      await page.getByRole('dialog', { name: '推荐支援武将' }).waitFor();
      await page.waitForTimeout(250);
    },
  });

  const loadingContext = await browser.newContext({ viewport: viewports.desktop, colorScheme: 'light' });
  const { page: loadingPage, errors: leaderboardLoadingErrors } = await openAuditedPage(loadingContext);
  let releaseLeaderboard;
  const leaderboardGate = new Promise((resolve) => { releaseLeaderboard = resolve; });
  await loadingPage.route(/\/game-data\/web_upload_data\.json/, async (route) => {
    await leaderboardGate;
    await route.continue();
  });
  const navigation = loadingPage.goto(`${baseURL}/contributors`, { waitUntil: 'domcontentloaded' });
  await loadingPage.getByTestId('game-loading-panel').waitFor();
  await loadingPage.screenshot({ path: path.join(outputDir, 'desktop--leaderboard-loading.png'), fullPage: true });
  await inspectPage(loadingPage, 'desktop--leaderboard-loading', leaderboardLoadingErrors);
  releaseLeaderboard();
  await navigation;
  await loadingContext.close();

  const routeContext = await browser.newContext({ viewport: viewports.desktop, colorScheme: 'light' });
  const { page: routePage, errors: routeLoadingErrors } = await openAuditedPage(routeContext);
  let releaseRoute;
  const routeGate = new Promise((resolve) => { releaseRoute = resolve; });
  await routePage.route(/\/src\/pages\/Analytics\.tsx/, async (route) => {
    await routeGate;
    await route.continue();
  });
  const routeNavigation = routePage.goto(`${baseURL}/analytics`, { waitUntil: 'domcontentloaded' });
  await routePage.getByTestId('game-loading-panel').waitFor();
  await routePage.screenshot({ path: path.join(outputDir, 'desktop--route-loading.png'), fullPage: true });
  await inspectPage(routePage, 'desktop--route-loading', routeLoadingErrors);
  releaseRoute();
  await routeNavigation;
  await routeContext.close();
} finally {
  await browser.close();
}

await writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const failures = report.filter(
  (entry) => entry.errors.length || entry.horizontalOverflow > 1 || entry.darkSurfaces.length,
);
console.log(`Captured ${report.length} visual states in ${outputDir}`);
console.log(`Diagnostic failures: ${failures.length}`);
if (failures.length) {
  console.log(JSON.stringify(failures, null, 2));
  process.exitCode = 1;
}
