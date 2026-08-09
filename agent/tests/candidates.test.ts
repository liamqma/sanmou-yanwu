import { describe, expect, it } from 'vitest';
import {
  buildHeroCompletionContext,
  campAttributeBonus,
  candidateEvidence,
  legalCandidateNames,
} from '../src/team/candidates.js';
import { oneBlankInput, testKnowledge } from './teamFixtures.js';

describe('hero candidate retrieval', () => {
  it('encodes the documented same-camp attribute bonuses', () => {
    expect(campAttributeBonus(['魏'])).toBe(0);
    expect(campAttributeBonus(['魏', '魏'])).toBe(0.05);
    expect(campAttributeBonus(['魏', '魏', '魏'])).toBe(0.1);
    expect(campAttributeBonus(['魏', '魏', '蜀'])).toBe(0.05);
  });

  it('retrieves semantic, guide, bond, camp, and learned evidence', () => {
    const candidate = candidateEvidence('魏丙', ['魏甲', '魏乙'], testKnowledge);

    expect(candidate.campBonusBefore).toBe(0.05);
    expect(candidate.campBonusAfter).toBe(0.1);
    expect(candidate.signatureSkill.description).toContain('治疗');
    expect(candidate.activatedBonds.map(({ name }) => name)).toContain('魏援');
    expect(candidate.knownTeams[0]).toMatchObject({
      id: 'known-wei-team',
      ranking: 'S',
      championship: true,
    });
    expect(candidate.learnedEvidence).toMatchObject({
      contribution: 0.75,
      minimumSupport: 18,
    });
  });

  it('ranks a focused legal shortlist for each blank', () => {
    const context = buildHeroCompletionContext(oneBlankInput, testKnowledge);
    const team = context.teams[0]!;
    const candidates = context.candidateSets[team.candidateSet]!;

    expect(context.teams).toHaveLength(1);
    expect(team.blankSlots).toEqual([{ slotIndex: 2, row: '前排' }]);
    expect(candidates.map(({ hero }) => hero)).toEqual(['魏丙', '蜀甲']);
    expect(context.heroCatalog['魏丙']?.signatureSkill.description).toContain('治疗');
  });

  it('accepts a candidate pool that excludes already-filled heroes', () => {
    const input = {
      ...oneBlankInput,
      availableHeroes: ['魏丙', '蜀甲'],
    };

    expect(legalCandidateNames(input, testKnowledge)).toEqual(['魏丙', '蜀甲']);
    expect(buildHeroCompletionContext(input, testKnowledge).teams).toHaveLength(1);
  });

  it('does not re-filter availableHeroes by season', () => {
    const laterSeasonKnowledge = {
      ...testKnowledge,
      database: {
        ...testKnowledge.database,
        heroes: {
          ...testKnowledge.database.heroes,
          蜀甲: { ...testKnowledge.database.heroes['蜀甲']!, season: 9 },
        },
      },
    };

    expect(
      legalCandidateNames(
        { ...oneBlankInput, season: 1, availableHeroes: ['蜀甲'] },
        laterSeasonKnowledge
      )
    ).toEqual(['蜀甲']);
  });
});
