export const formatHeroRank = (hero) => {
  if (!hero?.label || typeof hero.rank !== 'number') return '';
  return `${hero.label}#${hero.rank}`;
};

export const formatHeroDisplay = (heroName, heroMetadata = {}) => {
  const rankText = formatHeroRank(heroMetadata?.[heroName]);
  return rankText ? `${heroName} · ${rankText}` : heroName;
};

export const formatHeroSearchText = (heroName, heroMetadata = {}) => {
  const hero = heroMetadata?.[heroName];
  if (!hero) return heroName;
  return [heroName, hero.label, hero.rank, formatHeroRank(hero)].filter(Boolean).join(' ');
};

export const formatSkillTier = (skill) => skill?.tier || '';

export const formatSkillDisplay = (skillName, skillMetadata = {}) => {
  const tierText = formatSkillTier(skillMetadata?.[skillName]);
  return tierText ? `${skillName} · ${tierText}` : skillName;
};

export const formatSkillSearchText = (skillName, skillMetadata = {}) => {
  const skill = skillMetadata?.[skillName];
  if (!skill) return skillName;
  return [skillName, skill.tier, skill.note].filter(Boolean).join(' ');
};
