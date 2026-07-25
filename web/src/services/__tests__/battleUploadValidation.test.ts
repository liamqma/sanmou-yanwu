import { database } from '../../data';
import type { UploadedBattle, UploadedTeam } from '../../types/battleUpload';
import { battleToConfirmation } from '../battleConfirmation';
import {
  prefillBattleConfirmation,
  validateBattleConfirmation,
  validateBattlePaste,
} from '../battleUploadValidation';
import carriedSignatureBattleRaw from '../../../../image_extraction/fixtures/20251222-105040-453258_f17a780d.json';

const makeTeam = (heroNames: string[]): UploadedTeam => {
  const allSignatures = new Set(
    Object.values(database.heroes).map((hero) => hero.skill)
  );
  const used = new Set(
    heroNames.map((name) => database.heroes[name].skill)
  );
  const regularSkills = Object.keys(database.skills).filter(
    (skill) => !allSignatures.has(skill)
  );
  return heroNames.map((name) => {
    const signature = database.heroes[name].skill;
    const equipped = regularSkills
      .filter((skill) => skill !== signature && !used.has(skill))
      .slice(0, 2);
    equipped.forEach((skill) => used.add(skill));
    return { name, skills: [signature, equipped[0], equipped[1]] };
  }) as UploadedTeam;
};

const validBattle = (): UploadedBattle => {
  const heroNames = Object.keys(database.heroes);
  return {
    '1': makeTeam(heroNames.slice(0, 3)),
    '2': makeTeam(heroNames.slice(3, 6)),
    winner: '1',
  };
};

const validate = (battle: unknown) =>
  validateBattlePaste(JSON.stringify(battle), database);

const maximumSeason = Math.max(
  ...Object.values(database.heroes).map((hero) => hero.season),
  ...Object.values(database.skills).map((skill) => skill.season)
);

describe('validateBattlePaste', () => {
  test('preserves the ordered strict battle structure', () => {
    const battle = validBattle();
    const result = validate(battle);

    expect(result).toEqual({ valid: true, battle });
    if (result.valid) {
      expect(result.battle['1'].map((hero) => hero.name)).toEqual(
        battle['1'].map((hero) => hero.name)
      );
    }
  });

  test.each([
    [{ ...validBattle(), season: 16 }, '最外层只能包含'],
    [{ ...validBattle(), winner: 1 }, 'winner 必须是字符串'],
    [{ ...validBattle(), winner: 'draw' }, '平局不能上传'],
  ])('rejects an invalid root contract', (battle, message) => {
    expect(validate(battle)).toEqual(
      expect.objectContaining({ valid: false, error: expect.stringContaining(message) })
    );
  });

  test('rejects markdown-wrapped and malformed JSON', () => {
    expect(validateBattlePaste('```json\n{}\n```', database)).toEqual(
      expect.objectContaining({ valid: false, error: expect.stringContaining('无法解析') })
    );
  });

  test('requires exactly three ordered heroes and exact hero keys', () => {
    const short = validBattle();
    short['1'] = short['1'].slice(0, 2) as unknown as UploadedTeam;
    expect(validate(short)).toEqual(
      expect.objectContaining({ valid: false, error: expect.stringContaining('恰好包含 3 名') })
    );

    const extra = validBattle() as unknown as {
      '1': Array<Record<string, unknown>>;
    };
    extra['1'][0].rank = 1;
    expect(validate(extra)).toEqual(
      expect.objectContaining({ valid: false, error: expect.stringContaining('只能包含 name 和 skills') })
    );
  });

  test('requires exact catalog names and the positional signature skill', () => {
    const unknownHero = validBattle();
    unknownHero['1'][0].name = '不存在的武将';
    expect(validate(unknownHero)).toEqual(
      expect.objectContaining({ valid: false, error: expect.stringContaining('不在当前武将目录') })
    );

    const unknownSkill = validBattle();
    unknownSkill['1'][0].skills[1] = '不存在的战法';
    expect(validate(unknownSkill)).toEqual(
      expect.objectContaining({ valid: false, error: expect.stringContaining('不在当前战法目录') })
    );

    const wrongSignature = validBattle();
    const [signature, equipped] = wrongSignature['1'][0].skills;
    wrongSignature['1'][0].skills[0] = equipped;
    wrongSignature['1'][0].skills[1] = signature;
    expect(validate(wrongSignature)).toEqual(
      expect.objectContaining({ valid: false, error: expect.stringContaining('第 1 个战法必须是自带战法') })
    );

  });

  test('allows a different hero signature as a carried catalog skill', () => {
    const historicalBattle =
      carriedSignatureBattleRaw as unknown as UploadedBattle;

    expect(database.heroes['黄盖'].skill).toBe('苦肉计');
    expect(historicalBattle['1'][1]).toEqual({
      name: '田丰',
      skills: ['荐计阻敌', '苦肉计', '知人善任'],
    });
    expect(validate(historicalBattle)).toEqual({
      valid: true,
      battle: historicalBattle,
    });
  });

  test('rejects duplicate heroes and skills within one team', () => {
    const duplicateHero = validBattle();
    duplicateHero['1'][1] = { ...duplicateHero['1'][0] };
    expect(validate(duplicateHero)).toEqual(
      expect.objectContaining({ valid: false, error: expect.stringContaining('武将') })
    );

    const duplicateSkill = validBattle();
    duplicateSkill['1'][1].skills[1] = duplicateSkill['1'][0].skills[1];
    expect(validate(duplicateSkill)).toEqual(
      expect.objectContaining({ valid: false, error: expect.stringContaining('战法') })
    );
  });

  test('allows the opposing teams to reuse the same heroes and skills', () => {
    const battle = validBattle();
    battle['2'] = structuredClone(battle['1']);
    expect(validate(battle)).toEqual({ valid: true, battle });
  });
});

describe('prefillBattleConfirmation', () => {
  test('keeps recognizable fields from incomplete OCR output and derives signature skills', () => {
    const battle = validBattle();
    const partial = structuredClone(battle) as unknown as {
      '1': Array<{ name?: string; skills?: unknown[] }>;
      '2': Array<{ name?: string; skills?: unknown[] }>;
      winner?: unknown;
    };
    const firstHero = battle['1'][0];
    const secondHero = battle['1'][1];

    partial['1'][0].skills = [
      'DeepSeek 误识别的自带战法',
      firstHero.skills[1],
    ];
    partial['1'][1].name = '不存在的武将';
    partial['1'][1].skills = [
      '不存在的战法',
      secondHero.skills[1],
      secondHero.skills[2],
    ];
    partial.winner = '2';

    const result = prefillBattleConfirmation(
      JSON.stringify(partial),
      database
    );

    expect(result.parsed).toBe(true);
    if (!result.parsed) return;

    expect(result.recognizedFields).toBeGreaterThan(0);
    expect(result.confirmation['1'][0]).toEqual({
      name: firstHero.name,
      skills: [
        database.heroes[firstHero.name].skill,
        firstHero.skills[1],
        '',
      ],
    });
    expect(result.confirmation['1'][1]).toEqual({
      name: '',
      skills: ['', secondHero.skills[1], secondHero.skills[2]],
    });
    expect(result.confirmation['2']).toEqual(battle['2']);
    expect(result.confirmation.winner).toBe('2');
    expect(
      validateBattleConfirmation(result.confirmation, database, maximumSeason)
    ).toEqual(expect.objectContaining({ valid: false }));
  });

  test('does not prefill anything when the JSON syntax is malformed', () => {
    expect(
      prefillBattleConfirmation('{"1":[', database)
    ).toEqual({ parsed: false });
  });
});

describe('validateBattleConfirmation', () => {
  test('accepts a complete confirmation in the latest catalog season', () => {
    const battle = validBattle();

    expect(
      validateBattleConfirmation(
        battleToConfirmation(battle),
        database,
        maximumSeason
      )
    ).toEqual({ valid: true, battle });
  });

  test('keeps an out-of-season selected hero visible as a clear error', () => {
    const battle = validBattle();
    const futureHero = battle['1'][0].name;
    const futureSeason = database.heroes[futureHero].season;

    expect(futureSeason).toBeGreaterThan(1);
    expect(
      validateBattleConfirmation(
        battleToConfirmation(battle),
        database,
        futureSeason - 1
      )
    ).toEqual(
      expect.objectContaining({
        valid: false,
        error: expect.stringContaining(`武将“${futureHero}”`),
      })
    );
  });

  test('rejects a carried skill that was not available in the selected season', () => {
    const selectedSeason = maximumSeason - 1;
    const eligibleHeroes = Object.keys(database.heroes).filter(
      (name) => database.heroes[name].season <= selectedSeason
    );
    const battle = {
      '1': makeTeam(eligibleHeroes.slice(0, 3)),
      '2': makeTeam(eligibleHeroes.slice(3, 6)),
      winner: '1',
    } as UploadedBattle;
    const futureSkill = battle['1']
      .flatMap((hero) => hero.skills)
      .find((skill) => database.skills[skill].season > selectedSeason);

    expect(futureSkill).toBeTruthy();
    expect(
      validateBattleConfirmation(
        battleToConfirmation(battle),
        database,
        selectedSeason
      )
    ).toEqual(
      expect.objectContaining({
        valid: false,
        error: expect.stringContaining(`战法“${futureSkill}”`),
      })
    );
  });

  test.each([0, maximumSeason + 1])(
    'rejects an out-of-range season %s before submission',
    (season) => {
    expect(
      validateBattleConfirmation(
        battleToConfirmation(validBattle()),
        database,
        season
      )
    ).toEqual(
      expect.objectContaining({
        valid: false,
        error: expect.stringContaining(`1 至 ${maximumSeason}`),
      })
    );
    }
  );
});
