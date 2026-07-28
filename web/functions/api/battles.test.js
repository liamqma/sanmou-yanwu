import { webcrypto } from 'node:crypto';

import carriedSignatureBattle from '../../../image_extraction/fixtures/20251222-105040-453258_f17a780d.json';
import {
  CATALOG_MAX_SEASON,
  MAX_BODY_BYTES,
  MAX_PENDING_SUBMISSIONS,
  MAX_UPLOADER_NAME_CODE_POINTS,
  canonicalBattleJson,
  canonicalCatalogJson,
  canonicalFingerprintJson,
  computeCanonicalHash,
  getCatalogVersion,
  onRequestPost,
  validateBattleSubmission,
} from './battles';

const SUBMISSION_ID = '3d594650-3436-4af3-aeef-3f7b2ecdbf70';
const BATTLE = Object.freeze({
  1: [
    {
      name: '曹仁',
      skills: ['固镇襄樊', '避其锐气', '蹈锋饮血'],
    },
    {
      name: '曹操',
      skills: ['乱世奸雄', '同舟共济', '神略制变'],
    },
    {
      name: '朱儁',
      skills: ['围师必阙', '上兵伐谋', '潜龙在渊'],
    },
  ],
  2: [
    {
      name: '张飞',
      skills: ['万人之敌', '威名显赫', '百战不殆'],
    },
    {
      name: '乐进',
      skills: ['每战先登', '疾行侧击', '三军夺气'],
    },
    {
      name: '马云禄',
      skills: ['红妆缭乱', '兵贵神速', '千里突袭'],
    },
  ],
  winner: '1',
});

const cloneBattle = () => structuredClone(BATTLE);

const submission = (overrides = {}) => ({
  submission_id: SUBMISSION_ID,
  uploader_name: '',
  season: CATALOG_MAX_SEASON,
  battle: cloneBattle(),
  ...overrides,
});

class FakeD1 {
  constructor({ fail = false } = {}) {
    this.fail = fail;
    this.rows = new Map();
    this.prepareCalls = 0;
    this.preparedSql = [];
  }

  prepare(sql) {
    this.prepareCalls += 1;
    this.preparedSql.push(sql);
    return {
      bind: (...values) => ({
        run: async () => {
          if (this.fail) throw new Error('simulated D1 failure');
          if (!sql.includes('INSERT INTO web_battle_submissions')) {
            throw new Error('run called for a non-insert statement');
          }
          const submissionId = values[0];
          const queueIsFull =
            sql.includes('SELECT COUNT(*)') &&
            this.rows.size >= MAX_PENDING_SUBMISSIONS;
          const changes =
            this.rows.has(submissionId) || queueIsFull ? 0 : 1;
          if (changes) this.rows.set(submissionId, values);
          return { meta: { changes } };
        },
        first: async () => {
          if (this.fail) throw new Error('simulated D1 failure');
          if (!sql.includes('SELECT canonical_hash')) {
            throw new Error('first called for a non-select statement');
          }
          const stored = this.rows.get(values[0]);
          return stored
            ? {
                canonical_hash: stored[3],
                uploader_name: stored[1],
                battle_json: stored[4],
              }
            : null;
        },
      }),
    };
  }
}

const requestFor = (body, headers = {}) =>
  new Request('https://example.test/api/battles', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
});

describe('battle submission validation', () => {
  test.each([
    ['empty uploader name', submission()],
    ['Chinese uploader name', submission({ uploader_name: '诸葛亮' })],
    ['simple emoji uploader name', submission({ uploader_name: '玩家🎮' })],
    ['joined emoji uploader name', submission({ uploader_name: '玩家👩‍💻' })],
    [
      'maximum-length uploader name',
      submission({ uploader_name: '名'.repeat(MAX_UPLOADER_NAME_CODE_POINTS) }),
    ],
  ])('accepts a valid battle with %s', (_label, value) => {
    expect(validateBattleSubmission(value)).toBeNull();
  });

  test.each([
    ['C0 control', '玩家\n名字'],
    ['C1 control', '玩家\u0085名字'],
    ['zero-width space', '玩家\u200b名字'],
    ['bidi override', '玩家\u202e名字'],
    ['line separator', '玩家\u2028名字'],
    ['paragraph separator', '玩家\u2029名字'],
    ['lone surrogate', '玩家\ud800名字'],
  ])('rejects a name containing an invisible %s', (_label, uploader_name) => {
    expect(validateBattleSubmission(submission({ uploader_name }))).toBe(
      'uploader_name contains invisible control characters'
    );
  });

  test('rejects an overlong uploader name by Unicode code point, not UTF-16 unit', () => {
    expect(
      validateBattleSubmission(
        submission({ uploader_name: '😀'.repeat(MAX_UPLOADER_NAME_CODE_POINTS) })
      )
    ).toBeNull();
    expect(
      validateBattleSubmission(
        submission({ uploader_name: '😀'.repeat(MAX_UPLOADER_NAME_CODE_POINTS + 1) })
      )
    ).toBe(
      `uploader_name must be at most ${MAX_UPLOADER_NAME_CODE_POINTS} characters`
    );
  });

  test.each([
    [
      'an extra request field',
      () => submission({ source: 'browser' }),
      'request body has unexpected fields',
    ],
    [
      'a missing submission ID',
      () => {
        const value = submission();
        delete value.submission_id;
        return value;
      },
      'request body is missing required fields',
    ],
    [
      'a missing season',
      () => {
        const value = submission();
        delete value.season;
        return value;
      },
      'request body is missing required fields',
    ],
    [
      'a missing uploader name',
      () => {
        const value = submission();
        delete value.uploader_name;
        return value;
      },
      'request body is missing required fields',
    ],
    [
      'a non-string uploader',
      () => submission({ uploader_name: null }),
      'uploader_name must be a string',
    ],
    [
      'a non-UUID submission ID',
      () => submission({ submission_id: 'not-a-uuid' }),
      'submission_id must be a UUID',
    ],
    [
      'a non-string submission ID',
      () =>
        submission({
          submission_id: { toString: () => SUBMISSION_ID },
        }),
      'submission_id must be a UUID',
    ],
    ...[0, CATALOG_MAX_SEASON + 1, 1.5, '16'].map((season) => [
      `invalid season ${String(season)}`,
      () => submission({ season }),
      `season must be an integer between 1 and ${CATALOG_MAX_SEASON}`,
    ]),
    [
      'a numeric winner',
      () => {
        const battle = cloneBattle();
        battle.winner = 1;
        return submission({ battle });
      },
      'battle.winner must be "1" or "2"',
    ],
    [
      'an extra battle field',
      () => {
        const battle = cloneBattle();
        battle.season = 16;
        return submission({ battle });
      },
      'battle must contain only teams 1, 2, and winner',
    ],
    [
      'a short team',
      () => {
        const battle = cloneBattle();
        battle['1'].pop();
        return submission({ battle });
      },
      'battle.1 must contain exactly three heroes',
    ],
    [
      'an extra hero field',
      () => {
        const battle = cloneBattle();
        battle['1'][0].camp = '魏';
        return submission({ battle });
      },
      'battle.1[0] must contain only name and skills',
    ],
    [
      'an unknown hero',
      () => {
        const battle = cloneBattle();
        battle['1'][0].name = '不存在的武将';
        return submission({ battle });
      },
      'battle.1[0].name is not in the hero catalog',
    ],
    [
      'the wrong skill count',
      () => {
        const battle = cloneBattle();
        battle['1'][0].skills.pop();
        return submission({ battle });
      },
      'battle.1[0].skills must contain exactly three skill names',
    ],
    [
      'an unknown skill',
      () => {
        const battle = cloneBattle();
        battle['1'][0].skills[1] = '不存在的战法';
        return submission({ battle });
      },
      'battle.1[0].skills contains a skill outside the catalog',
    ],
    [
      'a signature skill outside slot zero',
      () => {
        const battle = cloneBattle();
        [battle['1'][0].skills[0], battle['1'][0].skills[1]] = [
          battle['1'][0].skills[1],
          battle['1'][0].skills[0],
        ];
        return submission({ battle });
      },
      "battle.1[0].skills[0] must be the hero's signature skill",
    ],
    [
      'a duplicate hero within one team',
      () => {
        const battle = cloneBattle();
        battle['1'][1] = structuredClone(battle['1'][0]);
        return submission({ battle });
      },
      'battle.1 contains duplicate heroes',
    ],
    [
      'a duplicate assigned skill within one team',
      () => {
        const battle = cloneBattle();
        battle['1'][1].skills[1] = battle['1'][0].skills[1];
        return submission({ battle });
      },
      'battle.1 contains duplicate skills',
    ],
  ])('rejects %s', (_label, makeValue, expectedError) => {
    expect(validateBattleSubmission(makeValue())).toBe(expectedError);
  });

  test("allows another hero's signature as a carried skill", () => {
    expect(
      validateBattleSubmission(
        submission({ battle: structuredClone(carriedSignatureBattle) })
      )
    ).toBeNull();
  });

  test('rejects heroes and skills introduced after the selected season', () => {
    const lateHero = cloneBattle();
    lateHero['1'][0] = {
      name: '刘禅',
      skills: ['释权御下', '避其锐气', '百战不殆'],
    };
    expect(
      validateBattleSubmission(
        submission({ battle: lateHero, season: CATALOG_MAX_SEASON - 1 })
      )
    ).toBe(
      `battle.1[0].name is not available in season ${CATALOG_MAX_SEASON - 1}`
    );

    expect(validateBattleSubmission(submission({ season: 9 }))).toBe(
      'battle.1[0].skills contains a skill unavailable in season 9'
    );
  });

  test('allows the opposing side to reuse heroes and skills', () => {
    const battle = cloneBattle();
    battle['2'] = structuredClone(battle['1']);
    expect(validateBattleSubmission(submission({ battle }))).toBeNull();
  });
});

describe('canonical battle fingerprints', () => {
  test('matches the catalog version generated by the Python data pipeline', async () => {
    await expect(getCatalogVersion()).resolves.toBe('6327a2e0643c');
  });

  test('versions availability metadata in compact sorted catalog JSON', () => {
    const base = {
      heroes: {
        甲: { skill: '甲法', season: 1 },
        乙: { skill: '乙法', season: 2 },
      },
      skills: {
        甲法: { color: 'orange', season: 1 },
        乙法: { color: 'purple', season: 2, shadow: true },
      },
    };
    const changedSeason = structuredClone(base);
    changedSeason.heroes.甲.season = 2;
    const changedShadow = structuredClone(base);
    changedShadow.skills.甲法.shadow = true;

    expect(canonicalCatalogJson(base)).toBe(
      '{"heroes":[{"default_skill":"乙法","name":"乙","season":2},{"default_skill":"甲法","name":"甲","season":1}],"skills":[{"color":"purple","name":"乙法","season":2,"shadow":true},{"color":"orange","name":"甲法","season":1,"shadow":false}]}'
    );
    expect(canonicalCatalogJson(changedSeason)).not.toBe(
      canonicalCatalogJson(base)
    );
    expect(canonicalCatalogJson(changedShadow)).not.toBe(
      canonicalCatalogJson(base)
    );
  });

  test('pins the cross-language fingerprint domain and compact encoding', async () => {
    await expect(
      computeCanonicalHash(submission({ uploader_name: '贡献者👩‍💻' }))
    ).resolves.toBe(
      'efc53a9795d0e5a82c735981549391601e23fb34eb5f13c1f54fee3d4bc78705'
    );
  });

  test('normalizes a team-side swap and its corresponding winner', async () => {
    const original = submission({ uploader_name: '贡献者👩‍💻' });
    const swappedBattle = cloneBattle();
    swappedBattle['1'] = structuredClone(BATTLE['2']);
    swappedBattle['2'] = structuredClone(BATTLE['1']);
    swappedBattle.winner = '2';
    const swapped = submission({
      uploader_name: '贡献者👩‍💻',
      battle: swappedBattle,
    });

    expect(canonicalFingerprintJson(swapped)).toBe(
      canonicalFingerprintJson(original)
    );
    await expect(computeCanonicalHash(swapped)).resolves.toBe(
      await computeCanonicalHash(original)
    );
  });

  test('uses a deterministic winner when both ordered team JSON values are identical', async () => {
    const winnerOneBattle = cloneBattle();
    winnerOneBattle['2'] = structuredClone(winnerOneBattle['1']);
    winnerOneBattle.winner = '1';
    const winnerTwoBattle = structuredClone(winnerOneBattle);
    winnerTwoBattle.winner = '2';
    const winnerOne = submission({ battle: winnerOneBattle });
    const winnerTwo = submission({ battle: winnerTwoBattle });

    expect(JSON.parse(canonicalFingerprintJson(winnerOne)).winner).toBe('1');
    expect(canonicalFingerprintJson(winnerTwo)).toBe(
      canonicalFingerprintJson(winnerOne)
    );
    await expect(computeCanonicalHash(winnerTwo)).resolves.toBe(
      await computeCanonicalHash(winnerOne)
    );
  });

  test('keeps winner, exact uploader, and omitted-versus-empty uploader significant', async () => {
    const base = submission({ uploader_name: '贡献者' });
    const otherWinner = submission({
      uploader_name: '贡献者',
      battle: { ...cloneBattle(), winner: '2' },
    });

    const omittedUploader = submission();
    delete omittedUploader.uploader_name;
    const hashes = await Promise.all([
      computeCanonicalHash(base),
      computeCanonicalHash(otherWinner),
      computeCanonicalHash(submission({ uploader_name: '另一位贡献者' })),
      computeCanonicalHash(omittedUploader),
      computeCanonicalHash(submission({ uploader_name: '' })),
    ]);
    expect(new Set(hashes)).toHaveLength(hashes.length);
    expect(hashes.every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
  });

  test('excludes season from the semantic duplicate fingerprint', async () => {
    await expect(
      computeCanonicalHash(submission({ season: CATALOG_MAX_SEASON - 1 }))
    ).resolves.toBe(await computeCanonicalHash(submission()));
  });

  test('keeps ordered hero and skill positions significant', async () => {
    const heroReordered = cloneBattle();
    [heroReordered['1'][0], heroReordered['1'][1]] = [
      heroReordered['1'][1],
      heroReordered['1'][0],
    ];
    const skillReordered = cloneBattle();
    [skillReordered['1'][0].skills[1], skillReordered['1'][0].skills[2]] = [
      skillReordered['1'][0].skills[2],
      skillReordered['1'][0].skills[1],
    ];

    const hashes = await Promise.all([
      computeCanonicalHash(submission()),
      computeCanonicalHash(submission({ battle: heroReordered })),
      computeCanonicalHash(submission({ battle: skillReordered })),
    ]);
    expect(new Set(hashes)).toHaveLength(hashes.length);
  });

  test('serializes only the exact compact battle contract in stable key order', () => {
    expect(JSON.parse(canonicalBattleJson(BATTLE, CATALOG_MAX_SEASON))).toEqual({
      ...BATTLE,
      season: CATALOG_MAX_SEASON,
    });
    expect(canonicalBattleJson(BATTLE, CATALOG_MAX_SEASON)).toMatch(
      /^\{"1":\[.*\],"2":\[.*\],"winner":"1","season":16\}$/
    );
  });
});

describe('POST /api/battles', () => {
  test('stores the exact uploader and treats a duplicate submission ID as idempotent', async () => {
    const database = new FakeD1();
    const body = submission({ uploader_name: ' 贡献者👩‍💻 ' });

    const first = await onRequestPost({
      request: requestFor(body),
      env: { TELEMETRY_DB: database },
    });
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(first.headers.get('x-content-type-options')).toBe('nosniff');
    await expect(first.json()).resolves.toEqual({
      ok: true,
      accepted: 1,
      duplicates: 0,
    });

    const retry = await onRequestPost({
      request: requestFor(body),
      env: { TELEMETRY_DB: database },
    });
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toEqual({
      ok: true,
      accepted: 0,
      duplicates: 1,
    });

    expect(database.prepareCalls).toBe(3);
    expect(database.rows.size).toBe(1);
    expect(database.preparedSql[0]).toContain(
      'INSERT INTO web_battle_submissions'
    );
    expect(database.preparedSql[2]).toContain('SELECT canonical_hash');
    const stored = database.rows.get(SUBMISSION_ID);
    expect(stored[1]).toBe(' 贡献者👩‍💻 ');
    expect(stored[2]).toBe('6327a2e0643c');
    expect(stored[3]).toMatch(/^[0-9a-f]{64}$/);
    expect(stored[4]).toBe(canonicalBattleJson(BATTLE, CATALOG_MAX_SEASON));
  });

  test('returns 409 when the same submission ID is retried with a different season', async () => {
    const database = new FakeD1();
    const first = submission({ season: CATALOG_MAX_SEASON - 1 });
    const retry = submission({ season: CATALOG_MAX_SEASON });

    expect(
      (
        await onRequestPost({
          request: requestFor(first),
          env: { TELEMETRY_DB: database },
        })
      ).status
    ).toBe(200);
    const response = await onRequestPost({
      request: requestFor(retry),
      env: { TELEMETRY_DB: database },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'submission_id was already used for different content',
    });
    expect(JSON.parse(database.rows.get(SUBMISSION_ID)[4]).season).toBe(
      CATALOG_MAX_SEASON - 1
    );
  });

  test('returns 409 when an existing submission ID has different semantic content', async () => {
    const database = new FakeD1();
    const original = submission({ uploader_name: '原贡献者' });
    const collision = submission({ uploader_name: '不同贡献者' });

    const first = await onRequestPost({
      request: requestFor(original),
      env: { TELEMETRY_DB: database },
    });
    const response = await onRequestPost({
      request: requestFor(collision),
      env: { TELEMETRY_DB: database },
    });

    expect(first.status).toBe(200);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'submission_id was already used for different content',
    });
    expect(database.rows.size).toBe(1);
    expect(database.rows.get(SUBMISSION_ID)[1]).toBe('原贡献者');
    expect(database.preparedSql.at(-1)).toContain('SELECT canonical_hash');
  });

  test('requires uploader_name and stores an explicit empty string', async () => {
    const database = new FakeD1();
    const missingUploader = submission();
    delete missingUploader.uploader_name;
    const rejected = await onRequestPost({
      request: requestFor(missingUploader),
      env: { TELEMETRY_DB: database },
    });
    const accepted = await onRequestPost({
      request: requestFor(submission()),
      env: { TELEMETRY_DB: database },
    });

    expect(rejected.status).toBe(400);
    expect(accepted.status).toBe(200);
    expect(database.prepareCalls).toBe(1);
    expect(database.rows.get(SUBMISSION_ID)[1]).toBe('');
  });

  test('rejects unsupported media types and cross-origin requests before D1', async () => {
    const database = new FakeD1();
    const missingMediaType = await onRequestPost({
      request: new Request('https://example.test/api/battles', {
        method: 'POST',
        body: new TextEncoder().encode(JSON.stringify(submission())),
      }),
      env: { TELEMETRY_DB: database },
    });
    const wrongMediaType = await onRequestPost({
      request: requestFor(submission(), { 'content-type': 'text/plain' }),
      env: { TELEMETRY_DB: database },
    });
    const crossOrigin = await onRequestPost({
      request: requestFor(submission(), {
        origin: 'https://attacker.example',
      }),
      env: { TELEMETRY_DB: database },
    });

    expect(missingMediaType.status).toBe(415);
    expect(wrongMediaType.status).toBe(415);
    expect(crossOrigin.status).toBe(403);
    expect(database.prepareCalls).toBe(0);
  });

  test('allows JSON parameters, same-origin requests, and a missing Origin', async () => {
    const database = new FakeD1();
    const sameOrigin = await onRequestPost({
      request: requestFor(submission(), {
        'content-type': 'Application/JSON; charset=UTF-8',
        origin: 'https://example.test',
      }),
      env: { TELEMETRY_DB: database },
    });
    const missingOrigin = await onRequestPost({
      request: requestFor(
        submission({
          submission_id: 'be64bd87-50f8-48ff-bbe0-c6313723815e',
        })
      ),
      env: { TELEMETRY_DB: database },
    });

    expect(sameOrigin.status).toBe(200);
    expect(missingOrigin.status).toBe(200);
    expect(database.rows.size).toBe(2);
  });

  test('caps the pending queue while preserving retries and UUID conflicts', async () => {
    const database = new FakeD1();
    const original = submission({ uploader_name: '原贡献者' });
    expect(
      (
        await onRequestPost({
          request: requestFor(original),
          env: { TELEMETRY_DB: database },
        })
      ).status
    ).toBe(200);
    for (let index = 1; index < MAX_PENDING_SUBMISSIONS; index += 1) {
      database.rows.set(`queued-${index}`, []);
    }

    const fresh = submission({
      submission_id: 'be64bd87-50f8-48ff-bbe0-c6313723815e',
    });
    const full = await onRequestPost({
      request: requestFor(fresh),
      env: { TELEMETRY_DB: database },
    });
    const retry = await onRequestPost({
      request: requestFor(original),
      env: { TELEMETRY_DB: database },
    });
    const collision = await onRequestPost({
      request: requestFor(
        submission({ uploader_name: '不同贡献者' })
      ),
      env: { TELEMETRY_DB: database },
    });

    expect(full.status).toBe(429);
    expect(full.headers.get('retry-after')).toBe('86400');
    await expect(full.json()).resolves.toEqual({
      ok: false,
      error: '今日待处理战报已满，请在每日更新后重试。',
    });
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toEqual({
      ok: true,
      accepted: 0,
      duplicates: 1,
    });
    expect(collision.status).toBe(409);
    expect(database.rows.size).toBe(MAX_PENDING_SUBMISSIONS);
    expect(database.rows.has(fresh.submission_id)).toBe(false);
  });

  test('rejects an invalid battle before preparing a D1 statement', async () => {
    const database = new FakeD1();
    const battle = cloneBattle();
    battle['1'][0].name = '不存在的武将';
    const response = await onRequestPost({
      request: requestFor(submission({ battle })),
      env: { TELEMETRY_DB: database },
    });

    expect(response.status).toBe(400);
    expect(database.prepareCalls).toBe(0);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  test('rejects invalid JSON and streamed or declared oversized bodies', async () => {
    const database = new FakeD1();
    const invalidJson = await onRequestPost({
      request: requestFor('{'),
      env: { TELEMETRY_DB: database },
    });
    const streamedOversize = await onRequestPost({
      request: requestFor('x'.repeat(MAX_BODY_BYTES + 1)),
      env: { TELEMETRY_DB: database },
    });
    const declaredOversize = await onRequestPost({
      request: requestFor('{}', {
        'content-length': String(MAX_BODY_BYTES + 1),
      }),
      env: { TELEMETRY_DB: database },
    });

    expect(invalidJson.status).toBe(400);
    expect(streamedOversize.status).toBe(413);
    expect(declaredOversize.status).toBe(413);
    expect(database.prepareCalls).toBe(0);
  });

  test('fails safely when the shared D1 binding is absent or errors', async () => {
    const missing = await onRequestPost({
      request: requestFor(submission()),
      env: {},
    });
    expect(missing.status).toBe(503);
    await expect(missing.json()).resolves.toEqual({
      ok: false,
      error: 'battle storage unavailable',
    });

    const failing = await onRequestPost({
      request: requestFor(submission()),
      env: { TELEMETRY_DB: new FakeD1({ fail: true }) },
    });
    expect(failing.status).toBe(503);
    await expect(failing.json()).resolves.toEqual({
      ok: false,
      error: 'battle storage unavailable',
    });
  });
});
