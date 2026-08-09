import type { GameKnowledge } from './gameData.js';
import { bondRequiredMembers, pairId } from './graphUtils.js';
import type {
  BlankPosition,
  CandidateEvidence,
  HeroCompletionContext,
  HeroCompletionInput,
} from './schemas.js';

export const MAX_CANDIDATES_PER_BLANK = 10;

const estimateFields = [
  'damageEstimate',
  'healingEstimate',
  'attributeEstimate',
  'damageBoostEstimate',
  'damageReductionEstimate',
  'damageDealtReductionEstimate',
  'damageTakenIncreaseEstimate',
  'evasionEstimate',
  'lifestealEstimate',
  'critEstimate',
  'critDamageEstimate',
] as const;

export function campAttributeBonus(camps: string[]): number {
  const counts = new Map<string, number>();
  for (const camp of camps) counts.set(camp, (counts.get(camp) ?? 0) + 1);
  const largestGroup = Math.max(0, ...counts.values());
  if (largestGroup >= 3) return 0.1;
  if (largestGroup >= 2) return 0.05;
  return 0;
}

function rankingValue(ranking: 'S' | 'A' | 'B'): number {
  return ranking === 'S' ? 3 : ranking === 'A' ? 2 : 1;
}

export function candidateEvidence(
  heroName: string,
  currentHeroNames: string[],
  knowledge: GameKnowledge
): CandidateEvidence {
  const hero = knowledge.database.heroes[heroName];
  if (hero === undefined) throw new Error(`Unknown hero in candidate pool: ${heroName}`);
  const signatureSkill = knowledge.database.skills[hero.skill];
  if (signatureSkill === undefined) {
    throw new Error(`Missing signature skill ${hero.skill} for ${heroName}`);
  }

  const currentHeroes = currentHeroNames.map((name) => {
    const record = knowledge.database.heroes[name];
    if (record === undefined) throw new Error(`Unknown filled hero: ${name}`);
    return record;
  });
  const campsBefore = currentHeroes.map(({ camp }) => camp);
  const campBonusBefore = campAttributeBonus(campsBefore);
  const campBonusAfter = campAttributeBonus([...campsBefore, hero.camp]);
  const beforeSet = new Set(currentHeroNames);
  const afterSet = new Set([...currentHeroNames, heroName]);

  const activatedBonds = Object.entries(knowledge.database.bonds)
    .flatMap(([name, bond]) => {
      const required = bondRequiredMembers(bond.condition);
      const beforeCount = bond.members.filter((member) => beforeSet.has(member)).length;
      const afterCount = bond.members.filter((member) => afterSet.has(member)).length;
      return beforeCount < required && afterCount >= required
        ? [
            {
              name,
              effect: bond.content,
              condition:
                bond.condition ?? '激活条件未记录（候选检索按2名缘分武将匹配）',
            },
          ]
        : [];
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  const knownTeams = knowledge.database.team
    .flatMap((team) => {
      const members = team.members.map(({ hero: member }) => member);
      const matched = [...afterSet].filter((member) => members.includes(member));
      if (matched.length < 2 || !matched.includes(heroName)) return [];
      return [
        {
          id: team.id,
          ranking: team.ranking,
          championship: team.sources.includes('championship'),
          formation: team.formation,
          heroes: members,
        },
      ];
    })
    .sort((left, right) => {
      const exactDelta = Number(right.heroes.every((name) => afterSet.has(name))) -
        Number(left.heroes.every((name) => afterSet.has(name)));
      if (exactDelta !== 0) return exactDelta;
      const championshipDelta = Number(right.championship) - Number(left.championship);
      if (championshipDelta !== 0) return championshipDelta;
      const rankingDelta = rankingValue(right.ranking) - rankingValue(left.ranking);
      return rankingDelta !== 0 ? rankingDelta : left.id.localeCompare(right.id);
    })
    .slice(0, 3);

  const featureIds = [
    `H|${heroName}`,
    ...currentHeroNames.map((name) => pairId(name, heroName)),
  ];
  const features = featureIds
    .filter((id) => knowledge.recommendation.model.weights[id] !== undefined)
    .map((id) => ({
      id,
      weight: knowledge.recommendation.model.weights[id] ?? 0,
      support: knowledge.recommendation.model.support[id] ?? 0,
    }));
  const contribution = features.reduce((sum, feature) => sum + feature.weight, 0);
  const minimumSupport =
    features.length === 0
      ? 0
      : Math.min(...features.map(({ support }) => support));
  const estimates: Record<string, number> = {};
  for (const key of estimateFields) {
    const value = signatureSkill[key];
    if (value !== undefined) estimates[key] = value;
  }

  const exactKnownTeam = knownTeams.some((team) =>
    team.heroes.every((name) => afterSet.has(name))
  );
  const guideScore = knownTeams.reduce(
    (best, team) =>
      Math.max(
        best,
        rankingValue(team.ranking) * 3 +
          (team.championship ? 3 : 0) +
          (team.heroes.every((name) => afterSet.has(name)) ? 8 : 0)
      ),
    0
  );
  const campScore = campBonusAfter * 100 + (campBonusAfter - campBonusBefore) * 100;
  const retrievalScore =
    contribution * 10 +
    campScore +
    activatedBonds.length * 5 +
    guideScore +
    (exactKnownTeam ? 2 : 0);

  return {
    hero: heroName,
    camp: hero.camp,
    troop: hero.troop,
    stats: hero.stats,
    signatureSkill: {
      name: hero.skill,
      type: signatureSkill.type,
      probability: signatureSkill.prob,
      description: signatureSkill.desc,
      estimates,
    },
    campBonusBefore,
    campBonusAfter,
    activatedBonds,
    knownTeams,
    learnedEvidence: { contribution, minimumSupport, features },
    retrievalScore,
  };
}

export function findBlankPositions(input: HeroCompletionInput): BlankPosition[] {
  return input.teams.flatMap((team, teamIndex) =>
    team.heroes.flatMap((slot, slotIndex) =>
      slot.hero === null ? [{ teamIndex, slotIndex }] : []
    )
  );
}

export function legalCandidateNames(
  input: HeroCompletionInput,
  knowledge: GameKnowledge
): string[] {
  const used = new Set(
    input.teams.flatMap((team) =>
      team.heroes.flatMap((slot) => (slot.hero === null ? [] : [slot.hero]))
    )
  );
  return input.availableHeroes.filter((name) => {
    if (knowledge.database.heroes[name] === undefined) {
      throw new Error(`Unknown available hero: ${name}`);
    }
    return !used.has(name);
  });
}

function heroCatalogEntry(
  heroName: string,
  knowledge: GameKnowledge
): HeroCompletionContext['heroCatalog'][string] {
  const hero = knowledge.database.heroes[heroName];
  if (hero === undefined) throw new Error(`Unknown hero: ${heroName}`);
  const signatureSkill = knowledge.database.skills[hero.skill];
  if (signatureSkill === undefined) {
    throw new Error(`Missing signature skill ${hero.skill} for ${heroName}`);
  }
  const estimates: Record<string, number> = {};
  for (const key of estimateFields) {
    const value = signatureSkill[key];
    if (value !== undefined) estimates[key] = value;
  }
  return {
    camp: hero.camp,
    troop: hero.troop,
    stats: hero.stats,
    signatureSkill: {
      name: hero.skill,
      type: signatureSkill.type,
      probability: signatureSkill.prob,
      description: signatureSkill.desc,
      estimates,
    },
  };
}

export function buildHeroCompletionContext(
  input: HeroCompletionInput,
  knowledge: GameKnowledge
): HeroCompletionContext {
  const blanks = findBlankPositions(input);
  const legalCandidates = legalCandidateNames(input, knowledge);
  if (legalCandidates.length < blanks.length) {
    throw new Error(
      `Cannot fill ${blanks.length} blank hero slots with only ${legalCandidates.length} legal unused heroes`
    );
  }

  const targetTeamIndexes = [...new Set(blanks.map(({ teamIndex }) => teamIndex))];
  const heroCatalog: HeroCompletionContext['heroCatalog'] = {};
  const candidateSets: HeroCompletionContext['candidateSets'] = {};
  const candidateSetByContent = new Map<string, string>();

  const teams = targetTeamIndexes.map((teamIndex) => {
    const team = input.teams[teamIndex];
    if (team === undefined) throw new Error(`Unknown team index: ${teamIndex}`);
    const currentHeroNames = team.heroes.flatMap(({ hero }) => (hero === null ? [] : [hero]));
    for (const name of currentHeroNames) {
      heroCatalog[name] ??= heroCatalogEntry(name, knowledge);
    }
    const candidates = legalCandidates
      .map((hero) => candidateEvidence(hero, currentHeroNames, knowledge))
      .sort((left, right) =>
        right.retrievalScore !== left.retrievalScore
          ? right.retrievalScore - left.retrievalScore
          : left.hero.localeCompare(right.hero)
      )
      .slice(0, MAX_CANDIDATES_PER_BLANK);

    for (const candidate of candidates) {
      heroCatalog[candidate.hero] ??= heroCatalogEntry(candidate.hero, knowledge);
    }
    const compactCandidates = candidates.map((candidate) => ({
      hero: candidate.hero,
      campBonusBefore: candidate.campBonusBefore,
      campBonusAfter: candidate.campBonusAfter,
      activatedBonds: candidate.activatedBonds,
      knownTeams: candidate.knownTeams,
      learnedEvidence: candidate.learnedEvidence.features,
    }));
    const fingerprint = JSON.stringify(compactCandidates);
    let candidateSet = candidateSetByContent.get(fingerprint);
    if (candidateSet === undefined) {
      candidateSet = `candidateSet${candidateSetByContent.size + 1}`;
      candidateSetByContent.set(fingerprint, candidateSet);
      candidateSets[candidateSet] = compactCandidates;
    }

    return {
      teamIndex,
      blankSlots: team.heroes.flatMap((slot, slotIndex) =>
        slot.hero === null ? [{ slotIndex, row: slot.row }] : []
      ),
      formation:
        team.formation === null
          ? null
          : {
              name: team.formation,
              effect: knowledge.database.formations[team.formation] ?? null,
            },
      currentHeroes: currentHeroNames,
      candidateSet,
    };
  });

  return { heroCatalog, candidateSets, teams };
}
