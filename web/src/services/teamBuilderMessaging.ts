import type { ProjectedTeam } from './recommendationEngine';

export interface TeamBuilderRecommendationSummary {
  successMessage: string | null;
  warningMessage: string | null;
}

export const summarizeTeamBuilderRecommendation = (
  teams: ProjectedTeam[]
): TeamBuilderRecommendationSummary => {
  const isComplete = (team: ProjectedTeam) =>
    team.heroes.length === 3 &&
    team.heroes.every((hero) => hero.skills.length === 2);
  const isGuideCore = (team: ProjectedTeam) =>
    (team.knownTeam?.matchedHeroSlots ?? 0) >= 2;

  const completeTeams = teams.filter(isComplete).length;
  const completeGuideCores = teams.filter(
    (team) => isComplete(team) && isGuideCore(team)
  ).length;
  const incompleteGuideCores = teams.filter(
    (team) => isGuideCore(team) && !isComplete(team)
  );
  const partialGuideCores = incompleteGuideCores.filter(
    (team) => team.knownTeam?.matchedHeroSlots === 2
  ).length;
  const placedHeroes = teams.reduce(
    (sum, team) => sum + team.heroes.length,
    0
  );
  const placedSkills = teams.reduce(
    (sum, team) =>
      sum +
      team.heroes.reduce(
        (heroSum, hero) => heroSum + hero.skills.length,
        0
      ),
    0
  );
  const missingHeroes = placedHeroes < 9;
  const missingSkills = placedSkills < 18;
  const missingItems = missingHeroes
    ? missingSkills
      ? '武将或战法'
      : '武将'
    : missingSkills
      ? '战法'
      : null;

  const successParts = [
    ...(completeTeams > 0
      ? [
          `已编入 ${completeTeams} 支完整队伍${
            completeGuideCores > 0
              ? `（其中 ${completeGuideCores} 组源自可信阵容库核心）`
              : ''
          }`,
        ]
      : []),
    ...(incompleteGuideCores.length > 0
      ? [
          `采用 ${incompleteGuideCores.length} 组可信阵容库核心${
            partialGuideCores > 0
              ? `（${partialGuideCores} 组为 2/3 武将）`
              : ''
          }`,
        ]
      : []),
  ];

  return {
    successMessage: successParts.length > 0 ? successParts.join('；') : null,
    warningMessage: missingItems
      ? `部分${missingItems}未通过证据与强度门槛，已保留空位。`
      : null,
  };
};
