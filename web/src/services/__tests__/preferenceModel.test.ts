import {
  preferenceFeatures,
  normalizePreferenceForDisplay,
  predictPlayerPreference,
  type PreferenceContext,
} from '../preferenceModel';
import type { TelemetryData } from '../../types/telemetryData';

const CONTEXT: PreferenceContext = {
  roundNumber: 4,
  roundType: 'hero',
  poolBefore: {
    heroes: ['刘备'],
    skills: ['避其锐气'],
    heroSupport: '关羽',
  },
  offeredSets: [
    ['曹操', '夏侯惇', '夏侯渊'],
    ['孙权', '周瑜', '鲁肃'],
    ['袁绍', '颜良', '文丑'],
  ],
  pairedScores: [10, 0, -10],
};

const artifact = {
  schema: { version: 3, source_event_schema_version: 1 },
  catalog_version: 'test',
  summary: {
    event_count: 240,
    invalid_event_count: 0,
    session_count: 40,
    recommendation_accepted_count: 180,
    preference_event_count: 0,
    model_versions: [],
    preference_model_versions: [],
  },
  rounds: [],
  preference_model: {
    model_type: 'conditional-choice-logit',
    feature_schema_version: 1,
    meaningful_probability_margin: 0.1,
    l2: 0.05,
    evidence: {
      event_count: 240,
      session_count: 40,
      recommendation_disagreement_count: 60,
      minimum_event_count: 240,
      minimum_session_count: 40,
      minimum_recommendation_disagreement_count: 30,
      holdout_event_count: 48,
      minimum_holdout_event_count: 36,
    },
    status: 'ready',
    version: 'preference-v1:0000000000000001',
    held_out: null,
    weights: {
      '[\"score\"]': 1,
      '[\"position\",2]': 0.5,
    },
    support: {
      '[\"score\"]': 720,
      '[\"position\",2]': 240,
    },
  },
} as unknown as TelemetryData;

describe('Phase 3 preference model', () => {
  test('builds the same JSON-array feature ids as the Python builder', () => {
    const features = preferenceFeatures(CONTEXT, 0);

    expect(features['["score"]']).toBe(1);
    expect(features['["round_score",4]']).toBe(1);
    expect(features['["position",0]']).toBe(1);
    expect(features['["item","hero","曹操"]']).toBe(1);
    expect(
      features['["pool_item","hero","刘备","hero","曹操"]']
    ).toBe(1);
    expect(
      features['["pool_item","skill","避其锐气","hero","曹操"]']
    ).toBe(1);
  });

  test('clips only schema-v2 score features to match the online Python model', () => {
    const extremeContext: PreferenceContext = {
      ...CONTEXT,
      pairedScores: [1_000, 0, -1_000],
    };

    const legacyHigh = preferenceFeatures(extremeContext, 0, 1);
    const onlineHigh = preferenceFeatures(extremeContext, 0, 2);
    const onlineLow = preferenceFeatures(extremeContext, 2, 2);

    expect(legacyHigh['["score"]']).toBe(100);
    expect(legacyHigh['["round_score",4]']).toBe(100);
    expect(onlineHigh['["score"]']).toBe(10);
    expect(onlineHigh['["round_score",4]']).toBe(10);
    expect(onlineLow['["score"]']).toBe(-10);
    expect(onlineLow['["round_score",4]']).toBe(-10);
  });

  test('uses clipped schema-v2 features for online prediction parity', () => {
    const extremeContext: PreferenceContext = {
      ...CONTEXT,
      pairedScores: [1_000, 0, -1_000],
    };
    const onlineArtifact = {
      ...artifact,
      schema: { version: 4, source_event_schema_version: 1 },
      preference_model: {
        ...artifact.preference_model!,
        feature_schema_version: 2,
        semantics_version: 2,
        algorithm: 'ftrl-proximal',
        minimum_persisted_event_support: 10,
        version: 'preference-v2:0000000000000001',
        weights: { '["score"]': 0.1 },
        support: { '["score"]': 720 },
      },
    } as unknown as TelemetryData;

    expect(
      predictPlayerPreference(onlineArtifact, extremeContext)?.probabilities
    ).toEqual([0.665, 0.245, 0.09]);
    expect(
      predictPlayerPreference(artifact, extremeContext)?.probabilities
    ).toEqual([1, 0, 0]);
  });

  test('normalizes three probabilities without changing the AI recommendation', () => {
    const prediction = predictPlayerPreference(artifact, CONTEXT);

    expect(prediction).not.toBeNull();
    expect(
      prediction!.probabilities.reduce((sum, probability) => sum + probability, 0)
    ).toBeCloseTo(1, 12);
    expect(prediction!.top_index).toBe(0);
    expect(prediction!.version).toBe('preference-v1:0000000000000001');
    expect(prediction!.explanation_driver).toBe(
      '这是相似阵容与选项中的总体选择倾向。'
    );
    expect(
      prediction!.probabilities.every(
        (probability) =>
          Math.abs(probability * 1000 - Math.round(probability * 1000)) <
          Number.EPSILON
      )
    ).toBe(true);
    expect(
      prediction!.probabilities
        .map((probability) => (probability * 100).toFixed(1))
        .reduce((sum, percentage) => sum + Number(percentage), 0)
    ).toBe(100);
  });

  test('rounds displayed thirds to an exact 100.0 percent total', () => {
    expect(
      normalizePreferenceForDisplay([1 / 3, 1 / 3, 1 / 3])
    ).toEqual([0.334, 0.333, 0.333]);
  });

  test('grounds its driver in the strongest positive top-side item signals', () => {
    const grounded = {
      ...artifact,
      preference_model: {
        ...artifact.preference_model!,
        weights: {
          '["position",1]': 3,
          '["pool_item","hero","刘备","hero","孙权"]': 1.4,
          '["pool_item","hero","刘备","hero","周瑜"]': 1.2,
          '["pool_item","hero","刘备","hero","鲁肃"]': 1,
          // An AI-option penalty helps the comparison mathematically, but is
          // not presented as a positive signal belonging to the preference top.
          '["item","hero","曹操"]': -2,
        },
        support: {
          '["position",1]': 240,
          '["pool_item","hero","刘备","hero","孙权"]': 80,
          '["pool_item","hero","刘备","hero","周瑜"]': 70,
          '["pool_item","hero","刘备","hero","鲁肃"]': 60,
          '["item","hero","曹操"]': 100,
        },
      },
    };

    const prediction = predictPlayerPreference(grounded, CONTEXT);

    expect(prediction?.top_index).toBe(1);
    expect(prediction?.explanation_driver).toBe(
      '当前已有刘备时，孙权、周瑜在模型中的选择信号较强。'
    );
    expect(prediction?.explanation_driver).not.toContain('鲁肃');
    expect(prediction?.explanation_driver).not.toContain('曹操');
  });

  test('uses the generic driver when only non-readable model features differ', () => {
    const positionOnly = {
      ...artifact,
      preference_model: {
        ...artifact.preference_model!,
        weights: { '["position",1]': 3 },
        support: { '["position",1]': 240 },
      },
    };

    const prediction = predictPlayerPreference(positionOnly, CONTEXT);

    expect(prediction?.top_index).toBe(1);
    expect(prediction?.explanation_driver).toBe(
      '这是相似阵容与选项中的总体选择倾向。'
    );
  });

  test('does not emit probabilities before the evidence and quality gates pass', () => {
    const unavailable = {
      ...artifact,
      preference_model: {
        ...artifact.preference_model!,
        status: 'insufficient_evidence' as const,
        version: null,
        weights: {},
        support: {},
      },
    };

    expect(predictPlayerPreference(unavailable, CONTEXT)).toBeNull();
  });
});
