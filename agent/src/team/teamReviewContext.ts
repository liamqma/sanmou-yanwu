import { campAttributeBonus } from './candidates.js';
import type { GameKnowledge } from './gameData.js';
import { bondRequiredMembers, pairId } from './graphUtils.js';
import type {
  TeamReviewContext,
  TeamReviewInput,
} from './teamReviewSchemas.js';

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

function skillPairId(hero: string, first: string, second: string): string {
  const [left, right] = first <= second ? [first, second] : [second, first];
  return `SP|${hero}|${left}|${right}`;
}

function learnedFeature(
  id: string,
  knowledge: GameKnowledge
): TeamReviewContext['teams'][number]['pairEvidence'][number] | null {
  const weight = knowledge.recommendation.model.weights[id];
  return weight === undefined
    ? null
    : {
        id,
        weight,
        support: knowledge.recommendation.model.support[id] ?? 0,
      };
}

function addSkillToCatalog(
  name: string,
  context: TeamReviewContext,
  knowledge: GameKnowledge
): void {
  if (context.skillCatalog[name] !== undefined) return;
  const skill = knowledge.database.skills[name];
  if (skill === undefined) throw new Error(`Unknown assigned skill: ${name}`);
  const estimates: Record<string, number> = {};
  for (const key of estimateFields) {
    const value = skill[key];
    if (value !== undefined) estimates[key] = value;
  }
  context.skillCatalog[name] = {
    type: skill.type,
    probability: skill.prob,
    description: skill.desc,
    estimates,
    generalEvidence: learnedFeature(`S|${name}`, knowledge),
  };
}

export function buildTeamReviewContext(
  input: TeamReviewInput,
  knowledge: GameKnowledge
): TeamReviewContext {
  const context: TeamReviewContext = {
    heroCatalog: {},
    skillCatalog: {},
    teams: [],
    deterministicRuleWarnings: [],
  };
  const skillPositions = new Map<string, Array<{ teamIndex: number; hero: string }>>();

  context.teams = input.teams.map((team, teamIndex) => {
    if (team.formation === null) {
      throw new Error(`Missing formation on team ${teamIndex}`);
    }
    const formationEffect = knowledge.database.formations[team.formation];
    if (formationEffect === undefined) throw new Error(`Unknown formation: ${team.formation}`);

    const heroNames = team.heroes.map((slot, slotIndex) => {
      if (slot.hero === null || slot.row === null || slot.skills.some((skill) => skill === null)) {
        throw new Error(`Incomplete team layout at team ${teamIndex} slot ${slotIndex}`);
      }
      return slot.hero;
    });
    const heroSet = new Set(heroNames);
    const camps = heroNames.map((name) => {
      const hero = knowledge.database.heroes[name];
      if (hero === undefined) throw new Error(`Unknown filled hero: ${name}`);
      return hero.camp;
    });

    const activeBonds = Object.entries(knowledge.database.bonds)
      .flatMap(([name, bond]) => {
        const matched = bond.members.filter((member) => heroSet.has(member)).length;
        return matched >= bondRequiredMembers(bond.condition)
          ? [
              {
                name,
                effect: bond.content,
                condition: bond.condition ?? '激活条件未记录（按2名缘分武将匹配）',
              },
            ]
          : [];
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    const knownTeamReferences = knowledge.database.team
      .flatMap((knownTeam) => {
        const matchCount = knownTeam.members.filter(({ hero }) => heroSet.has(hero)).length;
        return matchCount < 2
          ? []
          : [
              {
                id: knownTeam.id,
                ranking: knownTeam.ranking,
                championship: knownTeam.sources.includes('championship'),
                formation: knownTeam.formation,
                matchCount,
                members: knownTeam.members,
              },
            ];
      })
      .sort((left, right) => {
        const matchDelta = right.matchCount - left.matchCount;
        if (matchDelta !== 0) return matchDelta;
        const championshipDelta = Number(right.championship) - Number(left.championship);
        return championshipDelta !== 0
          ? championshipDelta
          : left.id.localeCompare(right.id);
      })
      .slice(0, 3);

    const heroes = team.heroes.map((slot, slotIndex) => {
      const heroName = slot.hero;
      if (heroName === null || slot.row === null) {
        throw new Error(`Incomplete team layout at team ${teamIndex} slot ${slotIndex}`);
      }
      const hero = knowledge.database.heroes[heroName];
      if (hero === undefined) throw new Error(`Unknown filled hero: ${heroName}`);
      addSkillToCatalog(hero.skill, context, knowledge);
      context.heroCatalog[heroName] ??= {
        camp: hero.camp,
        troop: hero.troop,
        stats: hero.stats,
        signatureSkill: hero.skill,
        generalEvidence: learnedFeature(`H|${heroName}`, knowledge),
      };

      const extraSkills = slot.skills.map((skillName) => {
        if (skillName === null) {
          throw new Error(`Incomplete skill layout at team ${teamIndex} slot ${slotIndex}`);
        }
        addSkillToCatalog(skillName, context, knowledge);
        const positions = skillPositions.get(skillName) ?? [];
        positions.push({ teamIndex, hero: heroName });
        skillPositions.set(skillName, positions);
        return skillName;
      }) as [string, string];

      if (extraSkills.includes(hero.skill)) {
        context.deterministicRuleWarnings.push({
          teamIndexes: [teamIndex],
          severity: 'critical',
          category: 'resource_rule',
          message: `武将 ${heroName} 的自带战法 ${hero.skill} 不应再作为额外战法装备。`,
          suggestedAction: '移除重复的自带战法并换成可用额外战法。',
          evidence: [
            { source: 'hero', id: heroName },
            { source: 'skill', id: hero.skill },
          ],
        });
      }

      return {
        slotIndex,
        hero: heroName,
        row: slot.row,
        extraSkills,
        skillEvidence: [
          ...extraSkills.flatMap((skill) => {
            const feature = learnedFeature(`HS|${heroName}|${skill}`, knowledge);
            return feature === null ? [] : [feature];
          }),
          ...(() => {
            const feature = learnedFeature(
              skillPairId(heroName, extraSkills[0], extraSkills[1]),
              knowledge
            );
            return feature === null ? [] : [feature];
          })(),
        ],
      };
    });

    const pairEvidence = [
      pairId(heroNames[0]!, heroNames[1]!),
      pairId(heroNames[0]!, heroNames[2]!),
      pairId(heroNames[1]!, heroNames[2]!),
    ].flatMap((id) => {
      const feature = learnedFeature(id, knowledge);
      return feature === null ? [] : [feature];
    });

    return {
      teamIndex,
      formation: { name: team.formation, effect: formationEffect },
      campBonus: {
        id: `team:${teamIndex}`,
        bonus: campAttributeBonus(camps),
        camps,
      },
      activeBonds,
      knownTeamReferences,
      heroes,
      pairEvidence,
    };
  });

  for (const [skill, positions] of skillPositions) {
    if (positions.length < 2) continue;
    context.deterministicRuleWarnings.push({
      teamIndexes: [...new Set(positions.map(({ teamIndex }) => teamIndex))],
      severity: 'critical',
      category: 'resource_rule',
      message: `战法 ${skill} 被重复装备了 ${positions.length} 次。`,
      suggestedAction: '每个额外战法只保留1个，为其他武将更换战法。',
      evidence: [{ source: 'skill', id: skill }],
    });
  }

  return context;
}
