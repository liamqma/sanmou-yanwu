import type { GameKnowledge } from './gameData.js';
import { bondRequiredMembers } from './graphUtils.js';
import type {
  SkillCompletionContext,
  SkillCompletionInput,
} from './skillSchemas.js';

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

export interface EmptySkillPosition {
  teamIndex: number;
  slotIndex: number;
  skillSlotIndex: number;
}

function skillPairId(hero: string, first: string, second: string): string {
  const [left, right] = first <= second ? [first, second] : [second, first];
  return `SP|${hero}|${left}|${right}`;
}

export function findEmptySkillPositions(
  input: SkillCompletionInput
): EmptySkillPosition[] {
  return input.teams.flatMap((team, teamIndex) =>
    team.heroes.flatMap((slot, slotIndex) =>
      slot.skills.flatMap((skill, skillSlotIndex) =>
        skill === null ? [{ teamIndex, slotIndex, skillSlotIndex }] : []
      )
    )
  );
}

export function legalAvailableSkills(
  input: SkillCompletionInput,
  knowledge: GameKnowledge
): string[] {
  const used = new Set(
    input.teams.flatMap((team) =>
      team.heroes.flatMap((slot) =>
        slot.skills.flatMap((skill) => (skill === null ? [] : [skill]))
      )
    )
  );
  return input.availableSkills.filter((name) => {
    if (knowledge.database.skills[name] === undefined) {
      throw new Error(`Unknown available skill: ${name}`);
    }
    return !used.has(name);
  });
}

export function buildSkillCompletionContext(
  input: SkillCompletionInput,
  knowledge: GameKnowledge
): SkillCompletionContext {
  const targets = findEmptySkillPositions(input);
  const legalSkills = legalAvailableSkills(input, knowledge);
  if (legalSkills.length < targets.length) {
    throw new Error(
      `Cannot fill ${targets.length} empty skill slots with only ${legalSkills.length} legal unused skills`
    );
  }

  const skillCatalog: SkillCompletionContext['skillCatalog'] = {};
  for (const name of legalSkills) {
    const skill = knowledge.database.skills[name];
    if (skill === undefined) throw new Error(`Unknown available skill: ${name}`);
    const estimates: Record<string, number> = {};
    for (const key of estimateFields) {
      const value = skill[key];
      if (value !== undefined) estimates[key] = value;
    }
    const featureId = `S|${name}`;
    const weight = knowledge.recommendation.model.weights[featureId];
    skillCatalog[name] = {
      type: skill.type,
      probability: skill.prob,
      description: skill.desc,
      estimates,
      generalEvidence:
        weight === undefined
          ? null
          : {
              id: featureId,
              weight,
              support: knowledge.recommendation.model.support[featureId] ?? 0,
            },
    };
  }

  const targetTeamIndexes = [...new Set(targets.map(({ teamIndex }) => teamIndex))];
  const targetHeroKeys = new Set(
    targets.map(({ teamIndex, slotIndex }) => `${teamIndex}:${slotIndex}`)
  );
  const teams = targetTeamIndexes.map((teamIndex) => {
    const team = input.teams[teamIndex];
    if (team === undefined) throw new Error(`Unknown team index: ${teamIndex}`);
    if (team.formation === null) throw new Error(`Missing formation on team ${teamIndex}`);
    const formationEffect = knowledge.database.formations[team.formation];
    if (formationEffect === undefined) throw new Error(`Unknown formation: ${team.formation}`);
    const teamHeroSet = new Set(
      team.heroes.flatMap(({ hero: name }) => (name === null ? [] : [name]))
    );
    const activeBonds = Object.entries(knowledge.database.bonds)
      .flatMap(([name, bond]) => {
        const matched = bond.members.filter((member) => teamHeroSet.has(member)).length;
        return matched >= bondRequiredMembers(bond.condition)
          ? [{ name, effect: bond.content }]
          : [];
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    const heroes = team.heroes.map((slot, slotIndex) => {
      if (slot.hero === null || slot.row === null) {
        throw new Error(`Incomplete hero layout at team ${teamIndex} slot ${slotIndex}`);
      }
      const hero = knowledge.database.heroes[slot.hero];
      if (hero === undefined) throw new Error(`Unknown filled hero: ${slot.hero}`);
      const signatureSkill = knowledge.database.skills[hero.skill];
      if (signatureSkill === undefined) {
        throw new Error(`Missing signature skill ${hero.skill} for ${slot.hero}`);
      }
      const currentExtraSkills = slot.skills.flatMap((skillName) => {
        if (skillName === null) return [];
        if (knowledge.database.skills[skillName] === undefined) {
          throw new Error(`Unknown assigned skill: ${skillName}`);
        }
        return [skillName];
      });
      const emptySkillSlots = slot.skills.flatMap((skillName, skillSlotIndex) =>
        skillName === null ? [skillSlotIndex] : []
      );
      const isTargetHero = targetHeroKeys.has(`${teamIndex}:${slotIndex}`);
      const specificSkillEvidence = isTargetHero
        ? legalSkills
            .filter((skill) => skill !== hero.skill)
            .flatMap((skill) => {
              const featureIds = [
                `HS|${slot.hero}|${skill}`,
                ...currentExtraSkills.map((existing) =>
                  skillPairId(slot.hero!, skill, existing)
                ),
              ];
              const features = featureIds.flatMap((id) => {
                const weight = knowledge.recommendation.model.weights[id];
                return weight === undefined
                  ? []
                  : [
                      {
                        id,
                        weight,
                        support: knowledge.recommendation.model.support[id] ?? 0,
                      },
                    ];
              });
              return features.length === 0 ? [] : [{ skill, features }];
            })
        : [];

      const pairEvidence: SkillCompletionContext['teams'][number]['heroes'][number]['pairEvidence'] =
        [];
      if (isTargetHero) {
        for (let firstIndex = 0; firstIndex < legalSkills.length; firstIndex += 1) {
          for (
            let secondIndex = firstIndex + 1;
            secondIndex < legalSkills.length;
            secondIndex += 1
          ) {
            const first = legalSkills[firstIndex]!;
            const second = legalSkills[secondIndex]!;
            if (first === hero.skill || second === hero.skill) continue;
            const id = skillPairId(slot.hero, first, second);
            const weight = knowledge.recommendation.model.weights[id];
            if (weight === undefined) continue;
            pairEvidence.push({
              first,
              second,
              weight,
              support: knowledge.recommendation.model.support[id] ?? 0,
            });
          }
        }
        pairEvidence.sort((left, right) => {
          const weightDelta = Math.abs(right.weight) - Math.abs(left.weight);
          return weightDelta !== 0
            ? weightDelta
            : `${left.first}|${left.second}`.localeCompare(
                `${right.first}|${right.second}`
              );
        });
      }

      return {
        slotIndex,
        hero: slot.hero,
        row: slot.row,
        stats: hero.stats,
        signatureSkill: {
          name: hero.skill,
          type: signatureSkill.type,
          description: signatureSkill.desc,
        },
        currentExtraSkills,
        emptySkillSlots,
        specificSkillEvidence,
        pairEvidence: pairEvidence.slice(0, 40),
      };
    });

    return {
      teamIndex,
      formation: team.formation,
      formationEffect,
      activeBonds,
      heroes,
    };
  });

  return { skillCatalog, teams };
}
