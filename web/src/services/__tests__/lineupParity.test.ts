import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LineupScorer, MASK, type LineupModelMeta } from '../lineupModel';
import { LineupEngine, type CardKind } from '../lineupSearch';
import parity from './fixtures/lineupParity.json';

// Results of data/lineup_net.py on the same model; regenerate both with `make export-lineup`.
const TOLERANCE = 1e-3;
const gameData = resolve(__dirname, '../../../public/game-data');
const meta = JSON.parse(readFileSync(resolve(gameData, 'lineup_model.json'), 'utf8')) as LineupModelMeta;
const weights = readFileSync(resolve(gameData, 'lineup_model.bin'));
const scorer = new LineupScorer(
  meta,
  weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength) as ArrayBuffer
);
const engine = new LineupEngine(scorer);

const expectClose = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(Math.abs(value - expected[index])).toBeLessThan(TOLERANCE));
};

describe('neural lineup model against the Python reference', { timeout: 120_000 }, () => {
  test('the fixtures were generated from the exported model', () => {
    expect(parity.version).toBe(meta.version);
  });

  test('team scores and strengths', () => {
    const id = (names: string[], name: string) => (name === '' ? MASK : Math.max(names.indexOf(name), 0));
    for (const { team, score, strength } of parity.teams as {
      team: [string, [string, string]][];
      score: number;
      strength: number;
    }[]) {
      const value = scorer.score([
        ...team.map(([hero]) => id(meta.heroes, hero)),
        ...team.flatMap(([, skills]) => skills.map((skill) => id(meta.skills, skill))),
      ]);
      expectClose([value.score, value.strength], [score, strength]);
    }
  });

  test('best lineups', () => {
    for (const { heroes, skills, restarts, score } of parity.lineups) {
      expectClose([engine.lineup(heroes, skills, restarts).score], [score]);
    }
  });

  test('filling around fixed cards', () => {
    for (const fixture of parity.fills) {
      const found = engine.fill(fixture.layout_heroes, fixture.layout_skills, fixture.heroes, fixture.skills);
      expectClose([found.score], [fixture.score]);
      const heroes = found.teams.flatMap((team) => team.heroes);
      const skills = found.teams.flatMap((team) => team.skills);
      fixture.layout_heroes.forEach((name, slot) => name && expect(heroes[slot]).toBe(name));
      fixture.layout_skills.forEach((name, slot) => name && expect(skills[slot]).toBe(name));
    }
  });

  test('three-choice picks', () => {
    for (const fixture of parity.picks) {
      const { first, deepened } = engine.pick(
        fixture.heroes,
        fixture.skills,
        fixture.options,
        fixture.kind as CardKind,
        fixture.restarts,
        fixture.deepen
      );
      expectClose(first.map((found) => found.score), fixture.scores);
      expectClose(deepened.map((found) => found.score), fixture.deepened);
    }
  });

  test('support rankings', () => {
    for (const fixture of parity.supports) {
      const found = engine.support(
        fixture.heroes,
        fixture.skills,
        fixture.kind as CardKind,
        fixture.count,
        fixture.candidates,
        fixture
      );
      expectClose([found.base], [fixture.base]);
      for (const [ranked, expected] of [
        [found.single, fixture.single],
        [found.pairs, fixture.pairs],
      ] as const) {
        expectClose(ranked.map((row) => row.lineup.score), (expected as [string[], number][]).map(([, value]) => value));
        if (expected.length) expect(ranked[0].cards).toEqual((expected as [string[], number][])[0][0]);
      }
    }
  });
});
