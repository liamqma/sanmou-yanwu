import type { HeroMeta, SkillMeta } from '../types/game';

export const formatHeroRank = (hero: HeroMeta | null | undefined): string => {
  if (!hero?.label || typeof hero.rank !== 'number') return '';
  return `${hero.label} · 第${hero.rank}`;
};

export const formatHeroDisplay = (heroName: string): string => heroName;

export const formatHeroSearchText = (
  heroName: string,
  heroMetadata: Record<string, HeroMeta> = {}
): string => {
  const hero = heroMetadata?.[heroName];
  if (!hero) return heroName;
  return [heroName, hero.label, hero.rank, formatHeroRank(hero)].filter(Boolean).join(' ');
};

export const formatSkillTier = (skill: SkillMeta | null | undefined): string => skill?.tier || '';

export const formatSkillDisplay = (skillName: string): string => skillName;

export const formatSkillSearchText = (
  skillName: string,
  skillMetadata: Record<string, SkillMeta> = {}
): string => {
  const skill = skillMetadata?.[skillName];
  if (!skill) return skillName;
  return [skillName, skill.tier, skill.note].filter(Boolean).join(' ');
};
