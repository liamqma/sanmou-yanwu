// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  displayedReduction,
  loadBattleReportSamples,
  loadReductionReviews,
  resolveReductionEffects,
  sampleLine,
  type ReductionReview,
} from './battleReportSamples';
import { simulateDamageReduction } from '../damageReduction';

const TEXT = '[我方:甲]的【受到伤害】降低6.00%(-6.00%)\n' +
  '[敌方:乙]的【受到伤害】降低3.50%(-3.50%)\n' +
  '[我方:甲]的【受到伤害】降低3.29%(-9.29%)\n';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const manifestEntry = (id = 'sample') => ({
  id,
  path: `reports/${id}.txt`,
  sha256: hash(TEXT),
  lineCount: 3,
  imageCount: 1,
  sourcePath: `study-battle-report/battles/${id}/battle_log.txt`,
  notes: 'Synthetic input for the corpus consumer tests, not game evidence.',
});
const makeReview = (battleId = 'sample'): ReductionReview => ({
  battleId,
  status: 'comparison',
  reason: 'Synthetic shared-rate example.',
  rawRates: {
    baseline: { status: 'observed-unstacked', line: 1, provenance: 'Synthetic baseline.' },
    extra: { status: 'observed-unstacked', line: 2, provenance: 'Synthetic same-rate donor.' },
  },
  observations: [{ description: 'Shared-rate prediction', effects: ['baseline', 'extra'], observedLine: 3 }],
});

let root: string;
const writeJson = (path: string, value: unknown) =>
  writeFileSync(join(root, path), JSON.stringify(value) + '\n');
const writeReviews = (reports: unknown[]) =>
  writeJson('observations/damage-reduction.json', { schemaVersion: 1, reports });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sanmou-battle-samples-'));
  mkdirSync(join(root, 'reports'));
  mkdirSync(join(root, 'observations'));
  writeFileSync(join(root, 'reports/sample.txt'), TEXT);
  writeJson('manifest.json', { schemaVersion: 1, reports: [manifestEntry()] });
  writeReviews([makeReview()]);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('shared battle-report sample consumer', () => {
  test('resolves source lines and evaluates a real simulator call without copied expectations', () => {
    const samples = loadBattleReportSamples(root);
    const [review] = loadReductionReviews(samples, root);
    const sample = samples.get('sample')!;
    expect(sampleLine(sample, 3)).toBe(TEXT.split('\n')[2]);
    const observation = review.observations[0];
    const actual = simulateDamageReduction(100, resolveReductionEffects(sample, review, observation.effects));
    const expected = displayedReduction(sample, observation.observedLine);
    expect(actual.totalReduction * 100).toBeCloseTo(expected.totalPercentagePoints, 10);
    expect(actual.steps.at(-1)!.effectiveRate * 100).toBeCloseTo(expected.effectivePercentagePoints, 10);
  });

  test('detects changed report bytes before any formula comparison', () => {
    writeFileSync(join(root, 'reports/sample.txt'), TEXT.replace('9.29', '9.99'));
    expect(() => loadBattleReportSamples(root)).toThrow(/SHA-256 mismatch/);
  });

  test('checks line count independently of the byte hash', () => {
    writeJson('manifest.json', { schemaVersion: 1, reports: [{ ...manifestEntry(), lineCount: 2 }] });
    expect(() => loadBattleReportSamples(root)).toThrow(/line count mismatch/);
  });

  test('rejects unknown manifest versions and non-integer metadata counts', () => {
    writeJson('manifest.json', { schemaVersion: 2, reports: [manifestEntry()] });
    expect(() => loadBattleReportSamples(root)).toThrow(/manifest version/);
    writeJson('manifest.json', { schemaVersion: 1, reports: [{ ...manifestEntry(), imageCount: 1.5 }] });
    expect(() => loadBattleReportSamples(root)).toThrow(/source image count/);
  });

  test('detects unregistered and missing report files', () => {
    writeFileSync(join(root, 'reports/new.txt'), TEXT);
    expect(() => loadBattleReportSamples(root)).toThrow(/exactly match the manifest/);
    rmSync(join(root, 'reports/new.txt'));
    rmSync(join(root, 'reports/sample.txt'));
    expect(() => loadBattleReportSamples(root)).toThrow(/ENOENT/);
  });

  test('rejects duplicate manifest IDs and path traversal', () => {
    writeJson('manifest.json', { schemaVersion: 1, reports: [manifestEntry(), manifestEntry()] });
    expect(() => loadBattleReportSamples(root)).toThrow(/Duplicate battle ID/);
    writeJson('manifest.json', { schemaVersion: 1, reports: [{ ...manifestEntry(), path: '../other.txt' }] });
    expect(() => loadBattleReportSamples(root)).toThrow(/Invalid report path/);
  });

  test('a newly registered report requires a reduction review, even with insufficient evidence', () => {
    writeFileSync(join(root, 'reports/new.txt'), TEXT);
    writeJson('manifest.json', { schemaVersion: 1, reports: [manifestEntry(), manifestEntry('new')] });
    const samples = loadBattleReportSamples(root);
    expect(() => loadReductionReviews(samples, root)).toThrow(/Every sample report needs an explicit/);
    const insufficient: ReductionReview = {
      battleId: 'new', status: 'insufficient-evidence', reason: 'Synthetic report lacks independent raw rates.',
      rawRates: {}, observations: [],
    };
    writeReviews([makeReview(), insufficient]);
    expect(loadReductionReviews(samples, root)[1]).toEqual(insufficient);
    writeReviews([makeReview(), { ...insufficient, reason: ' ' }]);
    expect(() => loadReductionReviews(samples, root)).toThrow(/requires a reason/);
  });

  test('rejects duplicate or unknown reviews, missing comparisons, and invalid status', () => {
    const samples = loadBattleReportSamples(root);
    writeReviews([makeReview(), makeReview()]);
    expect(() => loadReductionReviews(samples, root)).toThrow(/Duplicate reduction review/);
    writeReviews([makeReview('unknown')]);
    expect(() => loadReductionReviews(samples, root)).toThrow(/Unknown reviewed report/);
    writeReviews([{ ...makeReview(), observations: [] }]);
    expect(() => loadReductionReviews(samples, root)).toThrow(/needs observations/);
    writeReviews([{ ...makeReview(), status: 'unreviewed' }]);
    expect(() => loadReductionReviews(samples, root)).toThrow(/invalid review status/);
    writeReviews([{ ...makeReview(), status: 'insufficient-evidence' }]);
    expect(() => loadReductionReviews(samples, root)).toThrow(/must not carry numerical comparisons/);
  });

  test('rejects broken effect references and out-of-range or unreadable source lines', () => {
    const samples = loadBattleReportSamples(root);
    const review = makeReview();
    review.observations[0].effects.push('missing');
    writeReviews([review]);
    expect(() => loadReductionReviews(samples, root)).toThrow(/missing raw-rate evidence/);
    review.observations[0].effects.pop();
    for (const line of [0, 1.5, 4]) {
      review.observations[0].observedLine = line;
      writeReviews([review]);
      expect(() => loadReductionReviews(samples, root)).toThrow(/invalid source line/);
    }
    expect(() => displayedReduction({ id: 'broken-ocr', lines: ['[我方:甲]的【受到伤害】降低?'] }, 1))
      .toThrow(/missing generic reduction display/);
  });

  test('requires inferred raw rates to remain compatibility-only with traceable lines', () => {
    const samples = loadBattleReportSamples(root);
    const review = makeReview();
    review.rawRates.extra = {
      status: 'inferred-compatibility-witness', value: 0.035, lines: [1, 3],
      provenance: 'Synthetic same-display inference, not independent evidence.',
    };
    writeReviews([review]);
    expect(() => loadReductionReviews(samples, root)).toThrow(/require compatibility-only/);
    review.status = 'compatibility-only';
    writeReviews([review]);
    expect(loadReductionReviews(samples, root)[0].status).toBe('compatibility-only');
    review.rawRates.extra.lines = [999];
    writeReviews([review]);
    expect(() => loadReductionReviews(samples, root)).toThrow(/invalid source line/);
  });

  test('rejects unsupported raw-rate sources and invalid numerical values', () => {
    const samples = loadBattleReportSamples(root);
    const review = makeReview();
    writeReviews([{ ...review, rawRates: { ...review.rawRates, extra: { status: 'unknown', provenance: 'Unknown.' } } }]);
    expect(() => loadReductionReviews(samples, root)).toThrow(/unsupported raw-rate evidence/);
    review.rawRates.extra = {
      status: 'catalog-described', value: 1.2, sourcePath: 'example.json', sourceKey: 'extra',
      text: 'Synthetic description.', provenance: 'Synthetic catalog source.',
    };
    writeReviews([review]);
    expect(() => loadReductionReviews(samples, root)).toThrow(/invalid raw rate/);
  });

  test('a calibrated target cannot be used as its own prediction', () => {
    const samples = loadBattleReportSamples(root);
    const review = makeReview();
    review.rawRates.extra = { status: 'cross-target-calibrated', line: 3, provenance: 'Circular example.' };
    writeReviews([review]);
    expect(() => loadReductionReviews(samples, root)).toThrow(/Calibration cannot validate itself/);
    review.rawRates.extra.line = 2;
    writeReviews([review]);
    const [loaded] = loadReductionReviews(samples, root);
    expect(resolveReductionEffects(samples.get('sample')!, loaded, ['extra'])[0].rate).toBeCloseTo(0.035, 12);
  });
});
