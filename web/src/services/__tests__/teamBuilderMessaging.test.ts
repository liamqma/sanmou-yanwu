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
      warningMessage: '部分武将或战法未通过证据与强度门槛，已保留空位。',
    });
  });

  test('does not count teams with an unfilled hero slot as complete', () => {
    expect(
      summarizeTeamBuilderRecommendation([team(2), team(3), team(3)])
    ).toEqual({
      successMessage: '已编入 2 支完整队伍',
      warningMessage: '部分武将或战法未通过证据与强度门槛，已保留空位。',
    });
  });

  test('names skills specifically when only skill slots remain unfilled', () => {
    expect(
      summarizeTeamBuilderRecommendation([team(3, 1), team(3), team(3)])
    ).toEqual({
      successMessage: '已编入 2 支完整队伍',
      warningMessage: '部分战法未通过证据与强度门槛，已保留空位。',
    });
  });

  test('does not double-count a complete team that is also a guide core', () => {
    const complete = team(3);
    complete.knownTeam = {
      id: 'complete-guide',
      ranking: 'S',
      sources: ['strong'],
      matchedHeroSlots: 3,
      totalHeroSlots: 3,
      matchedSkillSlots: 6,
      totalSkillSlots: 6,
    };

    expect(
      summarizeTeamBuilderRecommendation([complete, team(3), team(3)])
    ).toEqual({
      successMessage: '已编入 3 支完整队伍（其中 1 组源自可信阵容库核心）',
      warningMessage: null,
    });
  });

  test('reports a credible two-of-three guide core without calling it complete', () => {
    const partial = team(2, 1);
    partial.knownTeam = {
      id: 'partial-guide',
      ranking: 'S',
      sources: ['strong'],
      matchedHeroSlots: 2,
      totalHeroSlots: 3,
      matchedSkillSlots: 2,
      totalSkillSlots: 6,
    };

    expect(summarizeTeamBuilderRecommendation([partial])).toEqual({
      successMessage: '采用 1 组可信阵容库核心（1 组为 2/3 武将）',
      warningMessage: '部分武将或战法未通过证据与强度门槛，已保留空位。',
    });
  });
});
