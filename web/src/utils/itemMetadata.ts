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

export const formatSkillSearchText = (
  skillName: string,
  _skillMetadata: Record<string, SkillMeta> = {}
): string => skillName;
