const { test, expect } = require('@playwright/test');
const { database, makeValidUploadBattle } = require('./helpers');

const maximumSeason = Math.max(
  ...Object.values(database.heroes).map((hero) => hero.season),
  ...Object.values(database.skills).map((skill) => skill.season),
);

async function chooseSelect(page, label, option) {
  const selector = page.getByRole('combobox', { name: label });
  await selector.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(selector).toHaveText(option);
}

async function chooseCatalogItem(page, label, value) {
  const input = page.getByRole('combobox', { name: label });
  await input.fill(value);
  await page.getByRole('option', { name: value, exact: true }).click();
  await expect(input).toHaveValue(value);
}

test.describe('Public battle contribution flow', () => {
  test('validates locally, previews both teams, retries idempotently, and saves an explicit empty name', async ({
    page,
  }) => {
    const requests = [];
    await page.addInitScript(() => {
      document.cookie = `battleUploaderName=${encodeURIComponent('旧名字😀')}; path=/`;
      document.cookie = 'selectedSeason=3; path=/';
      document.cookie = 'battleUploadSeason=9; path=/';
    });
    await page.route('**/api/battles', async (route) => {
      const request = route.request();
      requests.push(JSON.parse(request.postData()));
      if (requests.length === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'battle storage unavailable' }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, accepted: 1, duplicates: 0 }),
        });
      }
    });

    await page.goto('/contribute');

    await expect(
      page.getByRole('heading', { level: 1, name: '上传战报' }),
    ).toBeVisible();
    await expect(
      page.getByText(
        '如果这个工具对你有帮助，欢迎上传至少一份战报。你的每一次分享，都能帮助大家获得更准确的阵容推荐，谢谢你🥹',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        '请不要上传：1. 平局的战报；2. 已经减员的战斗战报。模型暂时无法处理这些情况。',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole('list').filter({ hasText: '截取一张' })).toBeVisible();
    const videoTutorial = page.getByRole('link', {
      name: '观看视频教程（B站）',
    });
    await expect(videoTutorial).toHaveAttribute(
      'href',
      'https://www.bilibili.com/video/BV1Rt3M6LEdA/',
    );
    await expect(videoTutorial).toHaveAttribute('target', '_blank');
    await expect(videoTutorial).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );

    const nameInput = page.getByRole('textbox', { name: '贡献榜名字（选填）' });
    await expect(nameInput).toHaveValue('旧名字😀');
    await nameInput.fill('');

    const seasonSelector = page.getByRole('combobox', { name: '战报赛季' });
    await expect(seasonSelector).toHaveText('赛季 9');
    await chooseSelect(page, '战报赛季', `赛季 ${maximumSeason}`);

    const pasteInput = page.getByRole('textbox', {
      name: '粘贴 DeepSeek 返回的 JSON（可选）',
    });
    const submit = page.getByRole('button', { name: '提交战报' });
    await expect(submit).toBeDisabled();

    await pasteInput.fill(
      JSON.stringify({ ...makeValidUploadBattle(), season: 16 }),
    );
    await expect(
      page.getByText(/最外层只能包含 "1"、"2" 和 "winner" 三个字段。/),
    ).toBeVisible();
    await expect(
      page.getByText(/已尽量将可识别内容填入下方，请补全或修正后再提交/),
    ).toBeVisible();
    await expect(submit).toBeEnabled();

    const pastedBattle = makeValidUploadBattle();
    await pasteInput.fill(JSON.stringify(pastedBattle));
    const firstHero = page.getByRole('combobox', {
      name: '阵容 1 第 1 位武将',
    });
    await expect(firstHero).toHaveValue(pastedBattle['1'][0].name);

    await chooseSelect(page, '战报赛季', `赛季 ${maximumSeason - 1}`);
    await expect(firstHero).toHaveValue(pastedBattle['1'][0].name);
    await expect(
      page.getByText(
        `阵容 1 的武将“${pastedBattle['1'][0].name}”在赛季 ${maximumSeason - 1} 尚未开放。`,
      ),
    ).toBeVisible();
    await expect(submit).toBeDisabled();

    await chooseSelect(page, '战报赛季', `赛季 ${maximumSeason}`);
    await expect(
      page.getByText('双方阵容已填写完整，可以提交。'),
    ).toBeVisible();
    await chooseSelect(page, '本场胜方', '阵容 2');
    await expect(
      page.getByRole('heading', { level: 3, name: '阵容 1', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: '阵容 2', exact: true }),
    ).toBeVisible();
    const teamOneLineup = page.getByRole('region', {
      name: '阵容 1',
      exact: true,
    });
    const teamTwoLineup = page.getByRole('region', {
      name: '阵容 2',
      exact: true,
    });
    await expect(teamOneLineup.getByText(/评分：-?\d+\.\d/)).toBeVisible();
    await expect(teamTwoLineup.getByText(/评分：-?\d+\.\d/)).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: '模型火力值对比' }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        /阵容评分由当前版本模型根据现有战报计算，仅供参考；阵容克制、临场发挥与随机因素也会影响胜负/,
      ),
    ).toBeVisible();

    await submit.click();
    await expect(
      page.getByText('提交失败（HTTP 503），请稍后重试。'),
    ).toBeVisible();
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(
      page.getByText(/战报已收到。贡献榜每天更新一次/),
    ).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    expect(requests[0].uploader_name).toBe('');
    expect(requests[0].season).toBe(maximumSeason);
    expect(requests[0].battle).toEqual({
      ...pastedBattle,
      winner: '2',
    });
    expect(requests[0].submission_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(
      await page.evaluate(() =>
        document.cookie
          .split('; ')
          .some((cookie) => cookie === 'battleUploaderName='),
      ),
    ).toBe(true);
    expect(
      await page.evaluate((season) =>
        document.cookie
          .split('; ')
          .some((cookie) => cookie === `battleUploadSeason=${season}`),
        maximumSeason,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(() => document.cookie.includes('selectedSeason=3')),
    ).toBe(true);
  });

  test('partially prefills incomplete JSON and lets the player repair it before submitting', async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto('/contribute');

    const pasteInput = page.getByRole('textbox', {
      name: '粘贴 DeepSeek 返回的 JSON（可选）',
    });
    const submit = page.getByRole('button', { name: '提交战报' });
    const firstHeroInput = page.getByRole('combobox', {
      name: '阵容 1 第 1 位武将',
    });

    await pasteInput.fill('{"1":[');
    await expect(page.getByText(/无法解析 JSON/)).toBeVisible();
    await expect(firstHeroInput).toHaveValue('');
    await expect(submit).toBeDisabled();

    const battle = makeValidUploadBattle('2');
    const partial = JSON.parse(JSON.stringify(battle));
    partial['1'][0].skills = [
      'DeepSeek 误识别的自带战法',
      battle['1'][0].skills[1],
    ];
    partial['1'][1].name = '不存在的武将';
    partial['1'][1].skills = [
      '不存在的战法',
      battle['1'][1].skills[1],
      battle['1'][1].skills[2],
    ];

    await pasteInput.fill(JSON.stringify(partial));

    await expect(firstHeroInput).toHaveValue(battle['1'][0].name);
    await expect(
      page.getByRole('textbox', {
        name: '阵容 1 第 1 位自带战法',
      }),
    ).toHaveValue(database.heroes[battle['1'][0].name].skill);
    await expect(
      page.getByRole('combobox', {
        name: '阵容 1 第 1 位携带战法 1',
      }),
    ).toHaveValue(battle['1'][0].skills[1]);
    await expect(
      page.getByRole('combobox', {
        name: '阵容 1 第 1 位携带战法 2',
      }),
    ).toHaveValue('');

    const secondHeroInput = page.getByRole('combobox', {
      name: '阵容 1 第 2 位武将',
    });
    await expect(secondHeroInput).toHaveValue('');
    await expect(
      page.getByRole('combobox', {
        name: '阵容 1 第 2 位携带战法 1',
      }),
    ).toHaveValue(battle['1'][1].skills[1]);
    await expect(
      page.getByRole('combobox', {
        name: '阵容 1 第 2 位携带战法 2',
      }),
    ).toHaveValue(battle['1'][1].skills[2]);
    await expect(
      page.getByRole('combobox', { name: '本场胜方' }),
    ).toHaveText('阵容 2');
    await expect(submit).toBeDisabled();

    await chooseCatalogItem(
      page,
      '阵容 1 第 2 位武将',
      battle['1'][1].name,
    );
    await expect(
      page.getByRole('textbox', {
        name: '阵容 1 第 2 位自带战法',
      }),
    ).toHaveValue(database.heroes[battle['1'][1].name].skill);
    await expect(
      page.getByRole('combobox', {
        name: '阵容 1 第 2 位携带战法 1',
      }),
    ).toHaveValue(battle['1'][1].skills[1]);
    await expect(
      page.getByRole('combobox', {
        name: '阵容 1 第 2 位携带战法 2',
      }),
    ).toHaveValue(battle['1'][1].skills[2]);
    await expect(submit).toBeDisabled();

    await chooseCatalogItem(
      page,
      '阵容 1 第 1 位携带战法 2',
      battle['1'][0].skills[2],
    );
    await expect(
      page.getByText('双方阵容已填写完整，可以提交。'),
    ).toBeVisible();
    await expect(submit).toBeEnabled();
  });

  test('submits a complete manual confirmation without JSON', async ({
    page,
  }) => {
    const requests = [];
    await page.context().clearCookies();
    await page.route('**/api/battles', async (route) => {
      requests.push(JSON.parse(route.request().postData()));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, accepted: 1, duplicates: 0 }),
      });
    });

    await page.goto('/contribute');
    await expect(
      page.getByRole('combobox', { name: '战报赛季' }),
    ).toHaveText(`赛季 ${maximumSeason}`);

    const battle = makeValidUploadBattle('2');
    for (const teamKey of ['1', '2']) {
      for (let heroIndex = 0; heroIndex < 3; heroIndex += 1) {
        const position = heroIndex + 1;
        const hero = battle[teamKey][heroIndex];
        await chooseCatalogItem(
          page,
          `阵容 ${teamKey} 第 ${position} 位武将`,
          hero.name,
        );
        await expect(
          page.getByRole('textbox', {
            name: `阵容 ${teamKey} 第 ${position} 位自带战法`,
          }),
        )
          .toHaveValue(hero.skills[0]);
        await expect(
          page.getByRole('textbox', {
            name: `阵容 ${teamKey} 第 ${position} 位自带战法`,
          }),
        ).toHaveAttribute('readonly', '');

        for (const skillIndex of [1, 2]) {
          await chooseCatalogItem(
            page,
            `阵容 ${teamKey} 第 ${position} 位携带战法 ${skillIndex}`,
            hero.skills[skillIndex],
          );
        }
      }
    }
    await chooseSelect(page, '本场胜方', '阵容 2');

    await expect(
      page.getByRole('textbox', {
        name: '粘贴 DeepSeek 返回的 JSON（可选）',
      }),
    ).toHaveValue('');
    await expect(
      page.getByText('双方阵容已填写完整，可以提交。'),
    ).toBeVisible();

    await page.getByRole('button', { name: '提交战报' }).click();
    await expect(
      page.getByText(/战报已收到。贡献榜每天更新一次/),
    ).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      submission_id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
      uploader_name: '',
      season: maximumSeason,
      battle,
    });
  });

  test('the copyable prompt covers both orientations, exact positions and JSON-only output', async ({
    page,
  }) => {
    await page.goto('/contribute');
    const prompt = page.getByRole('textbox', { name: 'DeepSeek OCR 提示词' });

    await expect(prompt).toHaveValue(/原生竖屏/);
    await expect(prompt).toHaveValue(/原生横屏/);
    await expect(prompt).toHaveValue(/2×3 个武将位置/);
    await expect(prompt).toHaveValue(/只输出 JSON 对象/);
    await expect(prompt).toHaveAttribute('readonly', '');
  });
});
