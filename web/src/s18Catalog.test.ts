import { database, recommendationData } from './data';
import { getGameAsset } from './gameAssets';
import { api } from './services/api';

describe('S18 catalog integration', () => {
  test('offers the new cards and keeps signatures out of ordinary tactic picks', async () => {
    const items = await api.getDatabaseItems();
    expect(items.maxSeason).toBeGreaterThanOrEqual(18);
    for (const hero of ['南华老仙', '蒋钦2']) {
      const signature = database.heroes[hero].skill;
      expect(items.heroes).toContain(hero);
      expect(items.heroMetadata[hero].season).toBe(18);
      expect(items.heroSkills).toContain(signature);
      expect(items.regularSkills).not.toContain(signature);
      expect(recommendationData.catalog.default_skill[hero]).toBe(signature);
      expect(getGameAsset(hero, 'hero')?.quality).toBe('orange');
      expect(getGameAsset(signature, 'tactic')).toBeNull();
    }
    for (const name of ['筹策夺锋', '久砺成锋']) {
      expect(items.orangeRegularSkills).toContain(name);
      expect(items.heroSkills).not.toContain(name);
      expect(items.skillMetadata[name].season).toBe(18);
      expect(getGameAsset(name, 'tactic')?.tacticType).toBe(database.skills[name].type);
    }
    expect(recommendationData.catalog.relationships.hero_camp['南华老仙']).toBe('群');
    expect(recommendationData.catalog.relationships.hero_camp['蒋钦2']).toBe('吴');
  });
});
