/**
 * Pure paired-model primitives shared by every recommendation consumer.
 *
 * Feature extraction mirrors `data/build_recommendation_data.py` exactly.  New
 * team-context features require a feasible concrete three-hero team and compact
 * reviewed catalog metadata; incomplete/global pools therefore remain neutral.
 * Chinese descriptions are never parsed at runtime.
 */
import type { PairedModel, RecommendationCatalog } from '../types/recommendation';

export const F_HERO = 'H';
export const F_SKILL = 'S';
export const F_HERO_PAIR = 'HP';
export const F_HERO_SKILL = 'HS';
export const F_SKILL_PAIR = 'SP';
export const F_TEAM_HERO_SKILL = 'THS';
export const F_TEAM_SKILL_PAIR = 'TSP';
export const F_HERO_TRIO = 'HT';
export const F_CAMP = 'HC';
export const F_BOND = 'B';
export const F_MECH = 'MX';
export const F_HERO_MECH = 'HMX';
export const F_TEAM_SKILL_TRIPLE = 'TS3';

export interface AssignedHero {
  name: string;
  /** Equipped non-default tactics; signature skills are added from the catalog for MECH only. */
  skills: string[];
}

export const sortPair = (a: string, b: string): [string, string] => (a <= b ? [a, b] : [b, a]);
const uniq = (values: string[]): string[] => [...new Set(values)];
const sorted = (values: string[]): string[] => [...values].sort();

// Canonical feature-id builders — the only TypeScript location assembling IDs.
export const heroId = (hero: string): string => `${F_HERO}|${hero}`;
export const skillId = (skill: string): string => `${F_SKILL}|${skill}`;
export const heroPairId = (a: string, b: string): string => `${F_HERO_PAIR}|${sorted([a, b]).join('|')}`;
export const heroSkillId = (hero: string, skill: string): string => `${F_HERO_SKILL}|${hero}|${skill}`;
export const skillPairId = (hero: string, first: string, second: string): string =>
  `${F_SKILL_PAIR}|${hero}|${sorted([first, second]).join('|')}`;
export const teamHeroSkillId = (hero: string, skill: string): string =>
  `${F_TEAM_HERO_SKILL}|${hero}|${skill}`;
export const teamSkillPairId = (first: string, second: string): string =>
  `${F_TEAM_SKILL_PAIR}|${sorted([first, second]).join('|')}`;
export const heroTrioId = (heroes: string[]): string => `${F_HERO_TRIO}|${sorted(heroes).join('|')}`;
export const teamSkillTripleId = (skills: string[]): string =>
  `${F_TEAM_SKILL_TRIPLE}|${sorted(skills).join('|')}`;
export const campId = (count: 2 | 3): string => `${F_CAMP}|${count}`;
export const bondId = (name: string): string => `${F_BOND}|${name}`;
export const mechId = (status: string): string => `${F_MECH}|${status}`;
export const heroMechId = (hero: string, status: string): string => `${F_HERO_MECH}|${hero}|${status}`;

function addCombinations(values: string[], size: number, add: (items: string[]) => void): void {
  const picked: string[] = [];
  const visit = (start: number): void => {
    if (picked.length === size) {
      add([...picked]);
      return;
    }
    for (let index = start; index <= values.length - (size - picked.length); index += 1) {
      picked.push(values[index]);
      visit(index + 1);
      picked.pop();
    }
  };
  visit(0);
}

/** Build the presence-encoded feature set for one routed team. */
export function teamFeatureIds(
  team: AssignedHero[],
  catalog?: RecommendationCatalog,
  enabledFamilies?: readonly string[]
): Set<string> {
  const features = new Set<string>();
  const enabled = enabledFamilies ? new Set(enabledFamilies) : null;
  const contextEnabled = (family: string): boolean => enabled === null || enabled.has(family);
  const heroes = team.map(({ name }) => name).filter(Boolean);
  heroes.forEach((hero) => features.add(heroId(hero)));

  const uniqueHeroes = sorted(uniq(heroes));
  addCombinations(uniqueHeroes, 2, ([first, second]) => features.add(heroPairId(first, second)));

  const teamSkills = new Set<string>();
  const skillsByHero = new Map<string, string[]>();
  for (const { name: hero, skills } of team) {
    if (!hero) continue;
    const uniqueSkills = uniq((skills ?? []).filter(Boolean));
    skillsByHero.set(hero, uniqueSkills);
    for (const skill of uniqueSkills) {
      teamSkills.add(skill);
      features.add(skillId(skill));
      features.add(heroSkillId(hero, skill));
    }
    addCombinations(sorted(uniqueSkills), 2, ([first, second]) =>
      features.add(skillPairId(hero, first, second))
    );
  }

  const concrete = team.length === 3 && heroes.length === 3 && uniqueHeroes.length === 3;
  if (!catalog || !concrete) return features;

  const uniqueTeamSkills = sorted([...teamSkills]);
  if (contextEnabled(F_TEAM_HERO_SKILL)) {
    for (const hero of uniqueHeroes) {
      for (const skill of uniqueTeamSkills) features.add(teamHeroSkillId(hero, skill));
    }
  }
  if (contextEnabled(F_TEAM_SKILL_PAIR)) {
    addCombinations(uniqueTeamSkills, 2, ([first, second]) => features.add(teamSkillPairId(first, second)));
  }
  if (contextEnabled(F_HERO_TRIO)) features.add(heroTrioId(uniqueHeroes));
  if (contextEnabled(F_TEAM_SKILL_TRIPLE)) {
    addCombinations(uniqueTeamSkills, 3, (triple) => features.add(teamSkillTripleId(triple)));
  }

  const camps = heroes.map((hero) => catalog.hero_camp?.[hero]).filter(Boolean) as string[];
  if (contextEnabled(F_CAMP) && camps.length === 3) {
    const counts = new Map<string, number>();
    camps.forEach((camp) => counts.set(camp, (counts.get(camp) ?? 0) + 1));
    const maximum = Math.max(...counts.values());
    if (maximum === 3) features.add(campId(3));
    else if (maximum === 2) features.add(campId(2));
  }

  const heroSet = new Set(heroes);
  for (const bond of contextEnabled(F_BOND) ? (catalog.bonds ?? []) : []) {
    const present = bond.members.filter((hero) => heroSet.has(hero)).length;
    if (present >= bond.required_members) features.add(bondId(bond.name));
  }

  const mechanics = catalog.skill_mechanics ?? {};
  const instances = new Map<string, { owner: string; skill: string }>();
  if (!contextEnabled(F_MECH) && !contextEnabled(F_HERO_MECH)) return features;
  for (const hero of uniqueHeroes) {
    const signature = catalog.default_skill[hero];
    if (signature) instances.set(`${hero}\u0000${signature}`, { owner: hero, skill: signature });
    for (const skill of skillsByHero.get(hero) ?? []) {
      instances.set(`${hero}\u0000${skill}`, { owner: hero, skill });
    }
  }
  const activeInstances = [...instances.values()];
  for (const beneficiary of activeInstances) {
    for (const status of mechanics[beneficiary.skill]?.benefitsFrom ?? []) {
      const externalProvider = activeInstances.some(
        (provider) =>
          (provider.owner !== beneficiary.owner || provider.skill !== beneficiary.skill) &&
          (mechanics[provider.skill]?.provides ?? []).includes(status)
      );
      if (externalProvider) {
        if (contextEnabled(F_MECH)) features.add(mechId(status));
        if (contextEnabled(F_HERO_MECH)) features.add(heroMechId(beneficiary.owner, status));
      }
    }
  }
  return features;
}

export function weightOf(model: PairedModel, featureId: string): number {
  return model.weights[featureId] ?? 0;
}
export function supportOf(model: PairedModel, featureId: string): number {
  return model.support[featureId] ?? 0;
}

export function scoreTeam(team: AssignedHero[], model: PairedModel, catalog?: RecommendationCatalog): number {
  let score = 0;
  for (const featureId of teamFeatureIds(team, catalog, model.enabled_families)) score += weightOf(model, featureId);
  return score;
}

/** Partial hero-pool scoring intentionally excludes concrete-team context. */
export function scoreHeroes(heroes: string[], model: PairedModel): number {
  return scoreTeam(heroes.map((name) => ({ name, skills: [] })), model);
}

export function nonDefaultSkillsForHero(hero: string, skills: string[], catalog: RecommendationCatalog): string[] {
  const signature = catalog.default_skill[hero];
  return skills.filter((skill) => skill && skill !== signature);
}

export interface EvidenceSummary {
  featureCount: number;
  totalSupport: number;
  minSupport: number;
}
export interface ActiveContribution {
  featureId: string;
  family: string;
  weight: number;
  support: number;
}

export function activeTeamContributions(
  team: AssignedHero[],
  model: PairedModel,
  catalog?: RecommendationCatalog
): ActiveContribution[] {
  const output: ActiveContribution[] = [];
  for (const featureId of teamFeatureIds(team, catalog, model.enabled_families)) {
    const weight = model.weights[featureId];
    if (weight === undefined || weight === 0) continue;
    output.push({ featureId, family: featureId.split('|')[0], weight, support: supportOf(model, featureId) });
  }
  output.sort((left, right) =>
    right.weight !== left.weight ? right.weight - left.weight : left.featureId.localeCompare(right.featureId)
  );
  return output;
}

export function evidenceFor(
  team: AssignedHero[],
  model: PairedModel,
  catalog?: RecommendationCatalog
): EvidenceSummary {
  let featureCount = 0;
  let totalSupport = 0;
  let minSupport = Infinity;
  for (const featureId of teamFeatureIds(team, catalog, model.enabled_families)) {
    if (model.weights[featureId] === undefined) continue;
    featureCount += 1;
    const support = supportOf(model, featureId);
    totalSupport += support;
    minSupport = Math.min(minSupport, support);
  }
  return { featureCount, totalSupport, minSupport: minSupport === Infinity ? 0 : minSupport };
}
