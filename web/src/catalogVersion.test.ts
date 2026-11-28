import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { catalogVersion } from './catalogVersion';
import { CATALOG_VERSION } from './data';

test('matches the Python catalog hash', () => {
  // data/test_catalog.py pins the same value for the same catalog.
  expect(
    catalogVersion({
      heroes: { 乙: { skill: '甲技', season: 2 }, 甲: { skill: '乙技', season: 1 } },
      skills: {
        甲技: { color: 'orange', season: 2 },
        乙技: { color: 'purple', season: 1, shadow: true },
        '丙"技': { season: 3 },
      },
    })
  ).toBe('2544b17e0cd9');
});

test('the app carries the version of the shipped database', () => {
  const database = JSON.parse(
    readFileSync(resolve(__dirname, '../public/game-data/database.json'), 'utf8')
  );
  expect(CATALOG_VERSION).toBe(catalogVersion(database));
});
