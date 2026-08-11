import type { HeroMeta, SkillMeta } from '../types/game';

export const formatHeroRanking = (hero: HeroMeta | null | undefined): string =>
  hero?.ranking ? `${hero.ranking}档` : '';

export const formatHeroDisplay = (heroName: string): string => heroName;

export const formatHeroSearchText = (
  heroName: string,
  heroMetadata: Record<string, HeroMeta> = {}
): string => {
  const hero = heroMetadata?.[heroName];
  if (!hero) return heroName;
  return [heroName, hero.ranking, formatHeroRanking(hero)].filter(Boolean).join(' ');
};

export const formatSkillDisplay = (skillName: string): string => skillName;

export const formatSkillRanking = (skill: SkillMeta | null | undefined): string =>
  skill?.ranking ? `${skill.ranking}档` : '';

export const formatSkillSearchText = (
  skillName: string,
  skillMetadata: Record<string, SkillMeta> = {}
): string => {
  const skill = skillMetadata?.[skillName];
  if (!skill) return skillName;
  return [skillName, skill.category, skill.ranking, formatSkillRanking(skill)]
    .filter(Boolean)
    .join(' ');
};
