import type { GameKnowledge } from './gameData.js';
import { bondRequiredMembers, pairId } from './graphUtils.js';
import type {
  FormationCompletionContext,
  FormationCompletionInput,
} from './formationSchemas.js';

function sameMembers(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((name) => rightSet.has(name));
}

export function findFormationTargets(input: FormationCompletionInput): number[] {
  return input.teams.flatMap((team, teamIndex) =>
    team.formation === null || team.heroes.some(({ row }) => row === null)
      ? [teamIndex]
      : []
  );
}

export function buildFormationCompletionContext(
  input: FormationCompletionInput,
  knowledge: GameKnowledge
): FormationCompletionContext {
  const formationCatalog = Object.fromEntries(
    Object.entries(knowledge.database.formations).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );

  const teams = findFormationTargets(input).map((teamIndex) => {
    const team = input.teams[teamIndex];
    if (team === undefined) throw new Error(`Unknown team index: ${teamIndex}`);
    const heroNames = team.heroes.map(({ hero }) => {
      if (hero === null) {
        throw new Error('Formation completion requires every hero position to be filled');
      }
      return hero;
    });
    const heroSet = new Set(heroNames);
    const heroes = team.heroes.map((slot, slotIndex) => {
      const name = heroNames[slotIndex];
      if (name === undefined) throw new Error(`Missing hero at team ${teamIndex} slot ${slotIndex}`);
      const hero = knowledge.database.heroes[name];
      if (hero === undefined) throw new Error(`Unknown filled hero: ${name}`);
      const signatureSkill = knowledge.database.skills[hero.skill];
      if (signatureSkill === undefined) {
        throw new Error(`Missing signature skill ${hero.skill} for ${name}`);
      }
      const extraSkills = slot.skills.flatMap((skillName) => {
        if (skillName === null) return [];
        const skill = knowledge.database.skills[skillName];
        if (skill === undefined) throw new Error(`Unknown assigned skill: ${skillName}`);
        return [
          {
            name: skillName,
            type: skill.type,
            description: skill.desc,
          },
        ];
      });
      return {
        slotIndex,
        name,
        currentRow: slot.row,
        camp: hero.camp,
        troop: hero.troop,
        stats: hero.stats,
        signatureSkill: {
          name: hero.skill,
          type: signatureSkill.type,
          description: signatureSkill.desc,
        },
        extraSkills,
      };
    });

    const activeBonds = Object.entries(knowledge.database.bonds)
      .flatMap(([name, bond]) => {
        const required = bondRequiredMembers(bond.condition);
        const matched = bond.members.filter((member) => heroSet.has(member)).length;
        return matched >= required
          ? [
              {
                name,
                effect: bond.content,
                condition:
                  bond.condition ?? '激活条件未记录（按2名缘分武将匹配）',
              },
            ]
          : [];
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    const knownTeamReferences = knowledge.database.team
      .filter((knownTeam) =>
        sameMembers(
          knownTeam.members.map(({ hero }) => hero),
          heroNames
        )
      )
      .map((knownTeam) => ({
        id: knownTeam.id,
        ranking: knownTeam.ranking,
        championship: knownTeam.sources.includes('championship'),
        formation: knownTeam.formation,
      }))
      .sort((left, right) => {
        const championshipDelta = Number(right.championship) - Number(left.championship);
        return championshipDelta !== 0
          ? championshipDelta
          : left.id.localeCompare(right.id);
      });

    const featureIds = [
      ...heroNames.map((name) => `H|${name}`),
      pairId(heroNames[0]!, heroNames[1]!),
      pairId(heroNames[0]!, heroNames[2]!),
      pairId(heroNames[1]!, heroNames[2]!),
    ];
    const features = featureIds.flatMap((id) => {
      const weight = knowledge.recommendation.model.weights[id];
      if (weight === undefined) return [];
      return [
        {
          id,
          weight,
          support: knowledge.recommendation.model.support[id] ?? 0,
        },
      ];
    });

    return {
      teamIndex,
      currentFormation: team.formation,
      heroes,
      activeBonds,
      knownTeamReferences,
      learnedEvidence: {
        contribution: features.reduce((sum, feature) => sum + feature.weight, 0),
        minimumSupport:
          features.length === 0
            ? 0
            : Math.min(...features.map(({ support }) => support)),
        features,
      },
    };
  });

  return { formationCatalog, teams };
}
