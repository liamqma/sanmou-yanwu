import { describe, expect, it } from 'vitest';
import { loadGameKnowledge } from '../src/team/gameData.js';

describe('loadGameKnowledge', () => {
  it('loads the checked-in semantic and learned evidence artifacts', async () => {
    const knowledge = await loadGameKnowledge();

    expect(Object.keys(knowledge.database.heroes).length).toBeGreaterThan(90);
    expect(Object.keys(knowledge.database.skills).length).toBeGreaterThan(200);
    expect(knowledge.database.team.length).toBeGreaterThan(50);
    expect(Object.keys(knowledge.recommendation.model.weights).length).toBeGreaterThan(1000);
  });
});
