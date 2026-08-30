// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface HeroRecord {
  skill: string;
}

interface SkillRecord {
  shadow?: boolean;
}

interface AssetRecord {
  path: string;
  quality: 'orange' | 'purple';
  type: 'hero' | 'tactic';
  tacticType?: string;
}

interface AssetManifest {
  heroes: Record<string, AssetRecord>;
  tactics: Record<string, AssetRecord>;
}

interface GameDatabase {
  heroes: Record<string, HeroRecord>;
  skills: Record<string, SkillRecord>;
}

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const database = JSON.parse(
  readFileSync(resolve(publicRoot, 'game-data/database.json'), 'utf8')
) as GameDatabase;
const manifest = JSON.parse(
  readFileSync(resolve(publicRoot, 'game-assets/manifest.json'), 'utf8')
) as AssetManifest;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const sorted = (values: string[]) =>
  [...values].sort((a, b) => a.localeCompare(b, 'zh-CN'));

describe('local game asset manifest', () => {
  test('exposes only local runtime asset fields', () => {
    expect(Object.keys(manifest).sort()).toEqual([
      'heroes',
      'schemaVersion',
      'tactics',
    ]);
    for (const entry of Object.values(manifest.heroes)) {
      expect(Object.keys(entry).sort()).toEqual(['path', 'quality', 'type']);
    }
    for (const entry of Object.values(manifest.tactics)) {
      expect(Object.keys(entry).sort()).toEqual([
        'path',
        'quality',
        'tacticType',
        'type',
      ]);
    }
  });

  test('covers every playable hero and regular tactic exactly once', () => {
    const signatureSkills = new Set(
      Object.values(database.heroes).map((hero) => hero.skill)
    );
    const regularTactics = Object.entries(database.skills)
      .filter(([name, skill]) => !signatureSkills.has(name) && skill.shadow !== true)
      .map(([name]) => name);

    expect(sorted(Object.keys(manifest.heroes))).toEqual(
      sorted(Object.keys(database.heroes))
    );
    expect(sorted(Object.keys(manifest.tactics))).toEqual(sorted(regularTactics));
  });

  test('points every entry at a checked-in PNG of the correct kind', () => {
    for (const [kind, entries] of [
      ['hero', manifest.heroes],
      ['tactic', manifest.tactics],
    ] as const) {
      for (const [name, entry] of Object.entries(entries)) {
        expect(entry.type, name).toBe(kind);
        expect(entry.path, name).toMatch(
          new RegExp(
            `^/game-assets/${kind === 'hero' ? 'heroes' : 'tactics'}/[^/]+\\.png$`
          )
        );

        const filePath = resolve(publicRoot, entry.path.slice(1));
        expect(existsSync(filePath), `${name}: ${entry.path}`).toBe(true);
        expect(
          readFileSync(filePath).subarray(0, 8),
          `${name}: ${entry.path}`
        ).toEqual(pngSignature);
      }
    }
  });
});
