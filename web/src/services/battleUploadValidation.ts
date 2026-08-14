import type { GameplayDatabase } from '../types/domain';
import type {
  BattleConfirmation,
  UploadedBattle,
  UploadedHero,
  UploadedTeam,
} from '../types/battleUpload';
import { maxCatalogSeason } from '../utils/contributionSeason';
import { emptyBattleConfirmation } from './battleConfirmation';

const ROOT_KEYS = ['1', '2', 'winner'] as const;
const HERO_KEYS = ['name', 'skills'] as const;
export const MAX_BATTLE_PASTE_CHARS = 50_000;

export type BattleValidationResult =
  | { valid: true; battle: UploadedBattle }
  | { valid: false; error: string };

export type BattlePrefillResult =
  | { parsed: false }
  | {
      parsed: true;
      confirmation: BattleConfirmation;
      recognizedFields: number;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (
  value: unknown,
  expected: readonly string[]
): value is Record<string, unknown> =>
  isRecord(value) &&
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));

const invalid = (error: string): BattleValidationResult => ({
  valid: false,
  error,
});

function validateTeam(
  value: unknown,
  teamKey: '1' | '2',
  database: GameplayDatabase
): { valid: true; team: UploadedTeam } | { valid: false; error: string } {
  if (!Array.isArray(value) || value.length !== 3) {
    return { valid: false, error: `阵容 ${teamKey} 必须恰好包含 3 名按位置排列的武将。` };
  }

  const heroes: UploadedHero[] = [];
  const seenHeroes = new Set<string>();
  const seenCarriedSkills = new Set<string>();

  for (let heroIndex = 0; heroIndex < value.length; heroIndex += 1) {
    const rawHero = value[heroIndex];
    const position = heroIndex + 1;
    if (!hasExactKeys(rawHero, HERO_KEYS)) {
      return {
        valid: false,
        error: `阵容 ${teamKey} 第 ${position} 名武将只能包含 name 和 skills 两个字段。`,
      };
    }

    const name = rawHero.name;
    if (typeof name !== 'string' || !Object.hasOwn(database.heroes, name)) {
      return {
        valid: false,
        error: `阵容 ${teamKey} 第 ${position} 名武将“${String(name)}”不在当前武将目录中。`,
      };
    }
    if (seenHeroes.has(name)) {
      return { valid: false, error: `阵容 ${teamKey} 中武将“${name}”重复。` };
    }
    seenHeroes.add(name);

    const rawSkills = rawHero.skills;
    if (!Array.isArray(rawSkills) || rawSkills.length !== 3) {
      return {
        valid: false,
        error: `阵容 ${teamKey} 的“${name}”必须恰好包含 3 个按位置排列的战法。`,
      };
    }

    const skills: string[] = [];
    const signature = database.heroes[name].skill;
    for (let skillIndex = 0; skillIndex < rawSkills.length; skillIndex += 1) {
      const skill = rawSkills[skillIndex];
      if (typeof skill !== 'string' || !Object.hasOwn(database.skills, skill)) {
        return {
          valid: false,
          error: `阵容 ${teamKey} 的“${name}”第 ${skillIndex + 1} 个战法“${String(skill)}”不在当前战法目录中。`,
        };
      }
      if (skillIndex === 0 && skill !== signature) {
        return {
          valid: false,
          error: `阵容 ${teamKey} 的“${name}”第 1 个战法必须是自带战法“${signature}”。`,
        };
      }
      if (skillIndex > 0 && skill === signature) {
        return {
          valid: false,
          error: `阵容 ${teamKey} 的“${name}”不能重复携带自己的自带战法“${signature}”。`,
        };
      }
      if (skillIndex > 0 && seenCarriedSkills.has(skill)) {
        return {
          valid: false,
          error: `阵容 ${teamKey} 中携带战法“${skill}”重复。`,
        };
      }
      if (skillIndex > 0) seenCarriedSkills.add(skill);
      skills.push(skill);
    }

    heroes.push({
      name,
      skills: skills as [string, string, string],
    });
  }

  return { valid: true, team: heroes as UploadedTeam };
}

/**
 * Parse a paste without requiring a complete battle and copy every exact
 * catalog match into editable confirmation state.
 *
 * Unknown or missing values become empty form slots. A known hero always gets
 * its catalog signature skill, even when OCR omitted or misread that skill. If
 * the hero name is missing but the first skill uniquely identifies a hero, use
 * that signature to recover the hero. Submission still uses the strict
 * validation path below.
 */
export function prefillBattleConfirmation(
  text: string,
  database: GameplayDatabase
): BattlePrefillResult {
  if (text.length === 0 || text.length > MAX_BATTLE_PASTE_CHARS) {
    return { parsed: false };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { parsed: false };
  }

  const confirmation = emptyBattleConfirmation();
  if (!isRecord(raw)) {
    return { parsed: true, confirmation, recognizedFields: 0 };
  }

  const signatureOwners = new Map<string, string[]>();
  for (const [heroName, hero] of Object.entries(database.heroes)) {
    const owners = signatureOwners.get(hero.skill) ?? [];
    owners.push(heroName);
    signatureOwners.set(hero.skill, owners);
  }

  let recognizedFields = 0;
  for (const teamKey of ['1', '2'] as const) {
    const rawTeam = raw[teamKey];
    if (!Array.isArray(rawTeam)) continue;

    for (
      let heroIndex = 0;
      heroIndex < Math.min(rawTeam.length, 3);
      heroIndex += 1
    ) {
      const rawHero = rawTeam[heroIndex];
      if (!isRecord(rawHero)) continue;

      const rawSkills = Array.isArray(rawHero.skills)
        ? rawHero.skills
        : [];
      const exactName =
        typeof rawHero.name === 'string' &&
        Object.hasOwn(database.heroes, rawHero.name)
          ? rawHero.name
          : '';
      const signatureName =
        typeof rawSkills[0] === 'string'
          ? (signatureOwners.get(rawSkills[0]) ?? [])
          : [];
      const heroName =
        exactName || (signatureName.length === 1 ? signatureName[0] : '');
      const targetHero = confirmation[teamKey][heroIndex];

      if (heroName) {
        targetHero.name = heroName;
        targetHero.skills[0] = database.heroes[heroName].skill;
        recognizedFields += 2;
      }

      for (const skillIndex of [1, 2] as const) {
        const skill = rawSkills[skillIndex];
        if (typeof skill === 'string' && Object.hasOwn(database.skills, skill)) {
          targetHero.skills[skillIndex] = skill;
          recognizedFields += 1;
        }
      }
    }
  }

  if (raw.winner === '1' || raw.winner === '2') {
    confirmation.winner = raw.winner;
    recognizedFields += 1;
  }

  return { parsed: true, confirmation, recognizedFields };
}

/**
 * Parse and fully validate DeepSeek output against the bundled catalog.
 *
 * Validation is intentionally exact: extra fields are rejected, array order is
 * preserved, and no normalization or fuzzy matching is performed.
 */
export function validateBattlePaste(
  text: string,
  database: GameplayDatabase
): BattleValidationResult {
  if (text.length === 0) return invalid('请先粘贴 DeepSeek 返回的 JSON。');
  if (text.length > MAX_BATTLE_PASTE_CHARS) {
    return invalid('粘贴内容过长，请只保留一场战报的 JSON。');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return invalid('无法解析 JSON。请确认没有 Markdown 代码围栏、注释或多余文字。');
  }

  if (!hasExactKeys(raw, ROOT_KEYS)) {
    return invalid('最外层只能包含 "1"、"2" 和 "winner" 三个字段。');
  }
  if (raw.winner !== '1' && raw.winner !== '2') {
    return invalid('winner 必须是字符串 "1" 或 "2"，平局不能上传。');
  }

  const team1 = validateTeam(raw['1'], '1', database);
  if (!team1.valid) return invalid(team1.error);
  const team2 = validateTeam(raw['2'], '2', database);
  if (!team2.valid) return invalid(team2.error);

  return {
    valid: true,
    battle: {
      '1': team1.team,
      '2': team2.team,
      winner: raw.winner,
    },
  };
}

/**
 * Validate the manually confirmed form, then ensure every selected catalog item
 * was available in the contribution's declared season.
 */
export function validateBattleConfirmation(
  confirmation: BattleConfirmation,
  database: GameplayDatabase,
  season: number
): BattleValidationResult {
  const maximumSeason = maxCatalogSeason(database);
  if (!Number.isInteger(season) || season < 1 || season > maximumSeason) {
    return invalid(`战报赛季无效，请选择 1 至 ${maximumSeason}。`);
  }

  const structural = validateBattlePaste(JSON.stringify(confirmation), database);
  if (!structural.valid) return structural;

  for (const teamKey of ['1', '2'] as const) {
    for (const hero of structural.battle[teamKey]) {
      const heroSeason = database.heroes[hero.name].season;
      if (heroSeason !== undefined && heroSeason > season) {
        return invalid(
          `阵容 ${teamKey} 的武将“${hero.name}”在赛季 ${season} 尚未开放。`
        );
      }
      for (const skill of hero.skills) {
        const skillSeason = database.skills[skill].season;
        if (skillSeason !== undefined && skillSeason > season) {
          return invalid(
            `阵容 ${teamKey} 的战法“${skill}”在赛季 ${season} 尚未开放。`
          );
        }
      }
    }
  }
  return structural;
}
