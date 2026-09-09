// Test-only consumer of the repository's shared, checked-in OCR corpus.
// No production simulator or browser entrypoint imports this Node module.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DamageReductionEffect } from '../damageReduction';

export const SAMPLE_ROOT = fileURLToPath(
  new URL('../../../../../battle-report-samples/', import.meta.url)
);

interface SampleManifest {
  schemaVersion: number;
  reports: {
    id: string;
    path: string;
    sha256: string;
    lineCount: number;
    imageCount: number;
    sourcePath: string;
    notes: string;
  }[];
}

export interface BattleReportSample {
  id: string;
  lines: string[];
}

type RawRateEvidence = { provenance: string } & (
  | {
      status: 'observed-unstacked' | 'observed-total' | 'cross-target-calibrated';
      line: number;
    }
  | {
      status: 'catalog-described';
      value: number;
      sourcePath: string;
      sourceKey: string;
      text: string;
    }
  | {
      status: 'inferred-compatibility-witness';
      value: number;
      lines: number[];
    }
);

export interface ReductionReview {
  battleId: string;
  status: 'comparison' | 'compatibility-only' | 'insufficient-evidence';
  reason: string;
  rawRates: Record<string, RawRateEvidence>;
  observations: {
    description: string;
    effects: string[];
    observedLine: number;
  }[];
}

const nonBlank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0;

export function loadBattleReportSamples(root = SAMPLE_ROOT): Map<string, BattleReportSample> {
  const manifest: SampleManifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  assert(manifest?.schemaVersion === 1, 'Unsupported battle sample manifest version');
  assert(Array.isArray(manifest.reports) && manifest.reports.length > 0, 'No sample reports');
  const samples = new Map<string, BattleReportSample>();
  const paths: string[] = [];

  for (const report of manifest.reports) {
    assert(report && nonBlank(report.id) && /^[\w-]+$/.test(report.id), 'Invalid battle ID');
    assert(!samples.has(report.id), `Duplicate battle ID: ${report.id}`);
    // Only this fixed shape is supported; no absolute paths or traversal.
    assert(report.path === `reports/${report.id}.txt`, `Invalid report path: ${report.path}`);
    assert(typeof report.sha256 === 'string' && /^[a-f0-9]{64}$/.test(report.sha256), 'Invalid SHA-256');
    assert(positiveInteger(report.lineCount), 'Invalid report line count');
    assert(positiveInteger(report.imageCount), 'Invalid source image count');
    assert(nonBlank(report.sourcePath) && nonBlank(report.notes), 'Missing sample provenance');
    const bytes = readFileSync(join(root, report.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), report.sha256,
      `${report.id}: report SHA-256 mismatch`);
    const text = bytes.toString('utf8');
    assert(bytes.equals(Buffer.from(text, 'utf8')), `${report.id}: invalid UTF-8`);
    // Preserve original text; only exclude the trailing terminator from line indexing.
    const lines = text.replace(/\n$/, '').split('\n');
    assert.equal(lines.length, report.lineCount, `${report.id}: report line count mismatch`);
    samples.set(report.id, { id: report.id, lines });
    paths.push(`${report.id}.txt`);
  }

  const entries = readdirSync(join(root, 'reports'), { withFileTypes: true });
  assert(entries.every((entry) => entry.isFile()), 'Reports must be regular text files');
  assert.deepEqual(entries.map((entry) => entry.name).sort(), paths.sort(),
    'Report files must exactly match the manifest (including newly added reports)');
  return samples;
}

export function sampleLine(sample: BattleReportSample, line: number): string {
  assert(positiveInteger(line) && line <= sample.lines.length,
    `${sample.id}: invalid source line ${line}`);
  return sample.lines[line - 1];
}

/** Parse an owned data contract, never implementation source. No fuzzy OCR repairs. */
export function displayedReduction(sample: BattleReportSample, line: number) {
  const match = sampleLine(sample, line).match(
    /^\[[^\]]+\]的【受到伤害】(降低|提升)(\d+\.\d{2})%\(-(\d+\.\d{2})%\)$/u
  );
  assert(match, `${sample.id}:${line}: missing generic reduction display`);
  const effectivePercentagePoints = Number(match[2]);
  const totalPercentagePoints = Number(match[3]);
  assert(effectivePercentagePoints <= 100 && totalPercentagePoints <= 100,
    `${sample.id}:${line}: out-of-range reduction display`);
  return { direction: match[1], effectivePercentagePoints, totalPercentagePoints };
}

export function resolveReductionEffects(
  sample: BattleReportSample,
  review: ReductionReview,
  ids: string[]
): DamageReductionEffect[] {
  return ids.map((id) => {
    assert(Object.hasOwn(review.rawRates, id), `${sample.id}: missing raw-rate evidence for ${id}`);
    const evidence = review.rawRates[id];
    switch (evidence.status) {
      case 'catalog-described':
      case 'inferred-compatibility-witness':
        return { id, rate: evidence.value };
      case 'observed-total':
        return { id, rate: displayedReduction(sample, evidence.line).totalPercentagePoints / 100 };
      case 'observed-unstacked': {
        const display = displayedReduction(sample, evidence.line);
        assert.equal(display.direction, '降低');
        assert.equal(display.effectivePercentagePoints, display.totalPercentagePoints);
        return { id, rate: display.effectivePercentagePoints / 100 };
      }
      case 'cross-target-calibrated': {
        const display = displayedReduction(sample, evidence.line);
        assert.equal(display.direction, '降低');
        const prior = (display.totalPercentagePoints - display.effectivePercentagePoints) / 100;
        assert(prior >= 0 && prior < 1, `${sample.id}: invalid calibration baseline`);
        return { id, rate: display.effectivePercentagePoints / 100 / (1 - prior) };
      }
      default:
        throw new Error(`${sample.id}: unsupported raw-rate evidence`);
    }
  });
}

export function loadReductionReviews(
  samples: Map<string, BattleReportSample>,
  root = SAMPLE_ROOT
): ReductionReview[] {
  const document: { schemaVersion: number; reports: ReductionReview[] } = JSON.parse(
    readFileSync(join(root, 'observations/damage-reduction.json'), 'utf8')
  );
  assert(document?.schemaVersion === 1, 'Unsupported reduction observation version');
  assert(Array.isArray(document.reports), 'Missing reduction report reviews');
  const reviewed = new Set<string>();

  for (const review of document.reports) {
    assert(review && nonBlank(review.battleId), 'Missing reviewed battle ID');
    assert(!reviewed.has(review.battleId), `Duplicate reduction review: ${review.battleId}`);
    reviewed.add(review.battleId);
    const sample = samples.get(review.battleId);
    assert(sample, `Unknown reviewed report: ${review.battleId}`);
    assert(['comparison', 'compatibility-only', 'insufficient-evidence'].includes(review.status),
      `${sample.id}: invalid review status`);
    assert(nonBlank(review.reason), `${sample.id}: review requires a reason`);
    assert(isRecord(review.rawRates) && Array.isArray(review.observations), 'Invalid observation structure');
    if (review.status === 'insufficient-evidence') {
      assert(review.observations.length === 0 && Object.keys(review.rawRates).length === 0,
        `${sample.id}: insufficient evidence must not carry numerical comparisons`);
      continue;
    }
    assert(review.observations.length > 0, `${sample.id}: reviewed report needs observations`);
    for (const [id, evidence] of Object.entries(review.rawRates)) {
      assert(nonBlank(id) && evidence && nonBlank(evidence.provenance), 'Missing raw-rate provenance');
      switch (evidence.status) {
        case 'observed-total':
        case 'observed-unstacked':
        case 'cross-target-calibrated':
          displayedReduction(sample, evidence.line);
          break;
        case 'catalog-described':
          assert(nonBlank(evidence.sourcePath) && nonBlank(evidence.sourceKey) && nonBlank(evidence.text),
            `${sample.id}: catalog evidence must retain its source description`);
          break;
        case 'inferred-compatibility-witness':
          assert(review.status === 'compatibility-only', `${sample.id}: inferred rates require compatibility-only`);
          assert(Array.isArray(evidence.lines) && evidence.lines.length > 0, 'Missing inference lines');
          evidence.lines.forEach((line) => sampleLine(sample, line));
          break;
        default:
          throw new Error(`${sample.id}: unsupported raw-rate evidence`);
      }
    }
    // Resolve even unused raw rates so a malformed entry never silently survives.
    for (const effect of resolveReductionEffects(sample, review, Object.keys(review.rawRates))) {
      assert(Number.isFinite(effect.rate) && effect.rate >= 0 && effect.rate <= 1,
        `${sample.id}: invalid raw rate for ${effect.id}`);
    }
    for (const observation of review.observations) {
      assert(observation && nonBlank(observation.description), 'Missing observation description');
      assert(Array.isArray(observation.effects) && observation.effects.length > 0 &&
        observation.effects.every(nonBlank), 'Missing observation effects');
      assert.equal(displayedReduction(sample, observation.observedLine).direction, '降低');
      resolveReductionEffects(sample, review, observation.effects);
      // A calibration target is not its own independent prediction target.
      for (const id of observation.effects) {
        const evidence = review.rawRates[id];
        if (evidence.status === 'cross-target-calibrated') {
          assert.notEqual(evidence.line, observation.observedLine, 'Calibration cannot validate itself');
        }
      }
    }
  }
  assert.deepEqual([...reviewed].sort(), [...samples.keys()].sort(),
    'Every sample report needs an explicit reduction review, including insufficient evidence');
  return document.reports;
}
