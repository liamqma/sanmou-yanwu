import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  buildHeroCompletionContext,
} from '../src/team/candidates.js';
import {
  buildFormationCompletionContext,
} from '../src/team/formationContext.js';
import {
  buildFormationCompletionPrompt,
} from '../src/team/formationCompletionSubgraph.js';
import { loadGameKnowledge } from '../src/team/gameData.js';
import { buildHeroCompletionPrompt } from '../src/team/heroCompletionSubgraph.js';
import { buildSkillCompletionContext } from '../src/team/skillContext.js';
import { buildSkillCompletionPrompt } from '../src/team/skillCompletionSubgraph.js';
import { teamRecommendationInputSchema } from '../src/team/teamRecommendationSchemas.js';
import { buildTeamReviewContext } from '../src/team/teamReviewContext.js';
import { buildTeamReviewPrompt } from '../src/team/teamReviewSubgraph.js';

describe('model prompt contracts', () => {
  it('normalizes repeated hero, formation, and skill facts within their size budgets', async () => {
    const [knowledge, fixtureText, completeFixtureText] = await Promise.all([
      loadGameKnowledge(),
      readFile(new URL('../fixtures/partial-teams.json', import.meta.url), 'utf8'),
      readFile(new URL('../fixtures/complete-teams.json', import.meta.url), 'utf8'),
    ]);
    const fixture = teamRecommendationInputSchema.parse(JSON.parse(fixtureText) as unknown);
    const completeFixture = teamRecommendationInputSchema.parse(
      JSON.parse(completeFixtureText) as unknown
    );

    const heroContext = buildHeroCompletionContext(fixture, knowledge);
    const heroPrompt = buildHeroCompletionPrompt(heroContext, [], []);
    expect(heroContext.teams).toHaveLength(2);
    expect(Object.values(heroContext.candidateSets)).toHaveLength(1);
    expect(heroPrompt).not.toContain('retrievalScore');
    expect(heroPrompt.length).toBeLessThanOrEqual(18_000);

    const teams = structuredClone(fixture.teams);
    const recommendedHeroes = [
      ['孙坚2', '吕布', '貂蝉'],
      ['关羽', '马云禄', '魏延'],
    ];
    for (let teamIndex = 1; teamIndex < 3; teamIndex += 1) {
      const team = teams[teamIndex]!;
      team.formation = teamIndex === 1 ? '雁形阵' : '方圆阵';
      for (let slotIndex = 0; slotIndex < 3; slotIndex += 1) {
        const slot = team.heroes[slotIndex]!;
        slot.hero = recommendedHeroes[teamIndex - 1]![slotIndex]!;
        slot.row = slotIndex === 2 ? '前排' : '后排';
      }
    }

    const formationContext = buildFormationCompletionContext(
      {
        teams: structuredClone(teams).map((team, teamIndex) =>
          teamIndex === 0
            ? team
            : {
                ...team,
                formation: null,
                heroes: team.heroes.map((slot) => ({ ...slot, row: null })),
              }
        ),
      },
      knowledge
    );
    const formationPrompt = buildFormationCompletionPrompt(formationContext, [], []);
    expect(Object.keys(formationContext.formationCatalog)).toHaveLength(
      Object.keys(knowledge.database.formations).length
    );
    expect(formationPrompt.match(/formationCatalog/g)).toHaveLength(2);
    expect(formationPrompt).not.toContain('formationCandidates');
    expect(formationPrompt.length).toBeLessThanOrEqual(8_000);

    const skillContext = buildSkillCompletionContext(
      {
        teams,
        availableSkills: fixture.availableSkills,
        season: fixture.season,
      },
      knowledge
    );
    const skillPrompt = buildSkillCompletionPrompt(skillContext, [], []);
    const skillHeroes = skillContext.teams.flatMap((team) => team.heroes);
    const specificFeatures = skillHeroes.flatMap((hero) =>
      hero.specificSkillEvidence.flatMap(({ features }) => features)
    );
    expect(Object.keys(skillContext.skillCatalog)).toHaveLength(
      fixture.availableSkills.length
    );
    expect(skillContext.teams).toHaveLength(3);
    expect(skillHeroes).toHaveLength(9);
    expect(specificFeatures.every(({ id }) => !id.startsWith('S|'))).toBe(true);
    expect(skillPrompt).not.toContain('"teammates":');
    expect(skillPrompt).not.toContain('Never assign a hero its own signature skill');
    expect(skillPrompt.length).toBeLessThanOrEqual(25_000);

    const reviewContext = buildTeamReviewContext(
      { teams: completeFixture.teams },
      knowledge
    );
    const reviewPrompt = buildTeamReviewPrompt(reviewContext, undefined, []);
    expect(reviewContext.teams).toHaveLength(3);
    expect(Object.keys(reviewContext.heroCatalog)).toHaveLength(9);
    expect(reviewPrompt.match(/"skillCatalog"/g)).toHaveLength(1);
    expect(reviewPrompt.length).toBeLessThanOrEqual(30_000);

    for (const prompt of [heroPrompt, formationPrompt, skillPrompt, reviewPrompt]) {
      expect(prompt).not.toMatch(/\n  "(?:heroCatalog|formationCatalog|skillCatalog)"/);
    }
  });
});
