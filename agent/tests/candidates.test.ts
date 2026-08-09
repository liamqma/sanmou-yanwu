import { describe, expect, it } from 'vitest';
import {
  buildBlankContexts,
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
    const contexts = buildBlankContexts(oneBlankInput, testKnowledge);

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.position).toEqual({ teamIndex: 0, slotIndex: 2 });
    expect(contexts[0]?.candidates.map(({ hero }) => hero)).toEqual(['魏丙', '蜀甲']);
  });

  it('accepts a candidate pool that excludes already-filled heroes', () => {
    const input = {
      ...oneBlankInput,
      availableHeroes: ['魏丙', '蜀甲'],
    };

    expect(legalCandidateNames(input, testKnowledge)).toEqual(['魏丙', '蜀甲']);
    expect(buildBlankContexts(input, testKnowledge)).toHaveLength(1);
  });
});
