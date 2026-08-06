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
      successMessage: '已编入 3 支推荐队伍',
      warningMessage: null,
    });
  });

  test('highlights that both heroes and skills remain unfilled', () => {
    expect(summarizeTeamBuilderRecommendation([team(3, 1)])).toEqual({
      successMessage: '已编入 1 支推荐队伍',
      warningMessage: '数据不足，暂时无法继续编入武将或战法。',
    });
  });

  test('names skills specifically when only skill slots remain unfilled', () => {
    expect(
      summarizeTeamBuilderRecommendation([team(3, 1), team(3), team(3)])
    ).toEqual({
      successMessage: '已编入 3 支推荐队伍',
      warningMessage: '数据不足，暂时无法继续编入战法。',
    });
  });
});
