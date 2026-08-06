import { describe, expect, test } from 'vitest';
import type { ProjectedTeam } from '../recommendationEngine';
import { summarizeTeamBuilderRecommendation } from '../teamBuilderMessaging';

const team = (heroCount: number, skillsPerHero = 2): ProjectedTeam => ({
  heroes: Array.from({ length: heroCount }, (_, heroIndex) => ({
    name: `h${heroIndex}`,
    skills: Array.from(
      { length: skillsPerHero },
      (_, skillIndex) => `s${heroIndex}-${skillIndex}`
    ),
    skillScore: 0,
  })),
  strength: 0,
  evidence: { heroSynergy: [], heroSkill: [], skillSynergy: [] },
});

describe('summarizeTeamBuilderRecommendation', () => {
  test('shows a simple success message for a complete recommendation', () => {
    expect(
      summarizeTeamBuilderRecommendation([team(3), team(3), team(3)])
    ).toEqual({
      successMessage: '已编入 3 支完整队伍',
      warningMessage: null,
    });
  });

  test('omits the success message when no team is complete', () => {
    expect(summarizeTeamBuilderRecommendation([team(3, 1)])).toEqual({
      successMessage: null,
      warningMessage: '数据不足，暂时无法继续编入武将或战法。',
    });
  });

  test('does not count teams with an unfilled hero slot as complete', () => {
    expect(
      summarizeTeamBuilderRecommendation([team(2), team(3), team(3)])
    ).toEqual({
      successMessage: '已编入 2 支完整队伍',
      warningMessage: '数据不足，暂时无法继续编入武将或战法。',
    });
  });

  test('names skills specifically when only skill slots remain unfilled', () => {
    expect(
      summarizeTeamBuilderRecommendation([team(3, 1), team(3), team(3)])
    ).toEqual({
      successMessage: '已编入 2 支完整队伍',
      warningMessage: '数据不足，暂时无法继续编入战法。',
    });
  });
});
