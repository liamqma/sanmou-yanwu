import telemetryRaw from '../../../public/game-data/telemetry_data.json';
import {
  clearTelemetryDataCacheForTests,
  getCachedTelemetryData,
  loadTelemetryData,
  parseTelemetryData,
} from '../telemetryData';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const ROUND_TYPES = [
  'hero',
  'skill',
  'skill',
  'hero',
  'skill',
  'skill',
  'hero',
  'skill',
] as const;

const schemaV2Artifact = (): Record<string, any> => ({
  catalog_version: telemetryRaw.catalog_version,
  preference_model: null,
  rounds: ROUND_TYPES.map((roundType, index) => ({
    round_number: index + 1,
    round_type: roundType,
    event_count: 0,
    recommendation_accepted_count: 0,
    chosen_position_counts: [0, 0, 0],
    recommended_position_counts: [0, 0, 0],
  })),
  schema: { version: 2, source_event_schema_version: 1 },
  summary: {
    event_count: 0,
    invalid_event_count: 0,
    session_count: 0,
    preference_event_count: 0,
    model_versions: [],
    preference_model_versions: [],
  },
});

const readyArtifact = (): Record<string, any> => ({
  catalog_version: telemetryRaw.catalog_version,
  schema: { version: 3, source_event_schema_version: 1 },
  summary: {
    event_count: 240,
    invalid_event_count: 0,
    session_count: 40,
    recommendation_accepted_count: 160,
    preference_event_count: 0,
    model_versions: [
      { version: '2:0000000000000000', event_count: 240 },
    ],
    preference_model_versions: [],
  },
  rounds: ROUND_TYPES.map((roundType, index) => ({
    round_number: index + 1,
    round_type: roundType,
    event_count: 30,
    recommendation_accepted_count: 20,
    chosen_position_counts: [10, 10, 10],
    recommended_position_counts: [12, 10, 8],
    rate_suppressed: false,
    preference_top_disagreement_count: 8,
    meaningful_preference_disagreement_count: 5,
    player_preference_agreement_count: 15,
    average_meaningful_preference_disagreement_margin: null,
  })),
  analytics: {
    minimum_rate_support: 10,
    items: { heroes: [], skills: [] },
    score_margins: [
      {
        key: 'tie',
        label: '并列',
        event_count: 240,
        recommendation_accepted_count: 160,
        rate_suppressed: false,
      },
      ...['0_to_1', '1_to_3', 'over_3'].map((key) => ({
        key,
        label: key,
        event_count: 0,
        recommendation_accepted_count: 0,
        rate_suppressed: true,
      })),
    ],
  },
  preference_model: {
    model_type: 'conditional-choice-logit',
    feature_schema_version: 1,
    meaningful_probability_margin: 0.1,
    l2: 0.05,
    evidence: {
      event_count: 240,
      session_count: 40,
      recommendation_disagreement_count: 80,
      minimum_event_count: 240,
      minimum_session_count: 40,
      minimum_recommendation_disagreement_count: 30,
      holdout_event_count: 48,
      minimum_holdout_event_count: 36,
    },
    status: 'ready',
    version: 'preference-v1:0000000000000001',
    held_out: {
      event_count: 48,
      accuracy: 0.7,
      log_loss: 0.8,
      brier: 0.15,
      calibration_error: 0.05,
      train_event_count: 192,
      paired_accuracy: 0.65,
      uniform_log_loss: 1.098612288668,
    },
    weights: { '["score"]': 0.5 },
    support: { '["score"]': 720 },
  },
});

const readyV4Artifact = (): Record<string, any> => {
  const artifact = readyArtifact();
  artifact.schema.version = 4;
  artifact.summary.estimated_session_count = artifact.summary.session_count;
  delete artifact.summary.session_count;
  artifact.analytics.items = {
    heroes: Array.from({ length: 8 }, (_, index) => ({
      name: `武将${index}`,
      offer_count: 90,
      opportunity_count: 90,
      picked_count: 30,
      rate_suppressed: false,
    })),
    skills: Array.from({ length: 9 }, (_, index) => ({
      name: `战法${index}`,
      offer_count: 150,
      opportunity_count: 150,
      picked_count: 50,
      rate_suppressed: false,
    })),
  };
  const marginLabels = ['并列', '0–1 分', '1–3 分', '超过 3 分'];
  artifact.analytics.score_margins.forEach(
    (row: Record<string, any>, index: number) => {
      row.label = marginLabels[index];
    }
  );
  artifact.preference_model = {
    model_type: 'conditional-choice-logit',
    feature_schema_version: 2,
    semantics_version: 2,
    algorithm: 'ftrl-proximal',
    meaningful_probability_margin: 0.1,
    l2: 0.05,
    minimum_persisted_event_support: 10,
    evidence: {
      event_count: 240,
      estimated_session_count: 40,
      recommendation_disagreement_count: 80,
      minimum_event_count: 240,
      minimum_estimated_session_count: 40,
      minimum_recommendation_disagreement_count: 30,
      evaluation_event_count: 48,
      minimum_evaluation_event_count: 36,
    },
    status: 'ready',
    version: 'preference-v2:0000000000000001',
    evaluation: {
      method: 'prequential',
      event_count: 48,
      calibration_event_count: 48,
      accuracy: 0.7,
      log_loss: 0.8,
      brier: 0.15,
      calibration_error: 0.05,
      paired_accuracy: 0.65,
      uniform_log_loss: 1.098612288668,
    },
    weights: { '["score"]': 0.5 },
    support: { '["score"]': 720 },
  };
  return artifact;
};

const insufficientV4Artifact = (): Record<string, any> => {
  const artifact = readyV4Artifact();
  artifact.summary = {
    event_count: 0,
    invalid_event_count: 0,
    estimated_session_count: 0,
    recommendation_accepted_count: 0,
    preference_event_count: 0,
    model_versions: [],
    preference_model_versions: [],
  };
  artifact.rounds.forEach((round: Record<string, any>) => {
    round.event_count = 0;
    round.recommendation_accepted_count = 0;
    round.chosen_position_counts = [0, 0, 0];
    round.recommended_position_counts = [0, 0, 0];
    round.rate_suppressed = true;
    round.preference_top_disagreement_count = null;
    round.meaningful_preference_disagreement_count = null;
    round.player_preference_agreement_count = null;
    round.average_meaningful_preference_disagreement_margin = null;
  });
  artifact.analytics.score_margins.forEach(
    (row: Record<string, any>) => {
      row.event_count = 0;
      row.recommendation_accepted_count = 0;
      row.rate_suppressed = true;
    }
  );
  artifact.analytics.items = { heroes: [], skills: [] };
  artifact.preference_model.evidence = {
    event_count: 0,
    estimated_session_count: 0,
    recommendation_disagreement_count: 0,
    minimum_event_count: 240,
    minimum_estimated_session_count: 40,
    minimum_recommendation_disagreement_count: 30,
    evaluation_event_count: 0,
    minimum_evaluation_event_count: 36,
  };
  artifact.preference_model.status = 'insufficient_evidence';
  artifact.preference_model.version = null;
  artifact.preference_model.evaluation = {
    method: 'prequential',
    event_count: 0,
    calibration_event_count: 0,
    accuracy: null,
    log_loss: null,
    brier: null,
    calibration_error: null,
    paired_accuracy: null,
    uniform_log_loss: 1.098612288668,
  };
  artifact.preference_model.weights = {};
  artifact.preference_model.support = {};
  return artifact;
};

const responseFor = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  }) as unknown as Response;

afterEach(() => {
  clearTelemetryDataCacheForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('static telemetry artifact boundary', () => {
  test('accepts the generated schema-v3/v4 hand-off during transition', () => {
    const telemetry = parseTelemetryData(telemetryRaw);

    expect(telemetry.summary.event_count).toBe(
      telemetry.rounds.reduce((sum, round) => sum + round.event_count, 0)
    );
    expect(telemetry.rounds).toHaveLength(8);
    expect([3, 4]).toContain(telemetry.schema.version);
    expect(telemetry.analytics?.minimum_rate_support).toBe(10);
    expect(telemetry.preference_model?.status).toMatch(
      /^(insufficient_evidence|quality_gate_failed|ready)$/
    );
    if (telemetry.schema.version === 3) {
      expect(telemetry.summary.session_count).toBeTypeOf('number');
      expect(telemetry.summary.estimated_session_count).toBeUndefined();
    } else {
      expect(telemetry.schema.version).toBe(4);
      expect(telemetry.summary.estimated_session_count).toBeTypeOf('number');
      expect(telemetry.summary.session_count).toBeUndefined();
    }
  });

  test('continues to accept the frozen schema-v2 contract', () => {
    const telemetry = parseTelemetryData(schemaV2Artifact());

    expect(telemetry.schema.version).toBe(2);
    expect(telemetry.preference_model).toBeNull();
    expect(telemetry.analytics).toBeUndefined();
  });

  test('keeps schema-v2 isolated from phase-three fields', () => {
    const schemaV2 = schemaV2Artifact();
    expect(() =>
      parseTelemetryData({
        ...schemaV2,
        preference_model: readyArtifact().preference_model,
      })
    ).toThrow('Schema-v2');
    expect(() =>
      parseTelemetryData({
        ...schemaV2,
        analytics: readyArtifact().analytics,
      })
    ).toThrow('contract');
  });

  test('rejects inconsistent public aggregate totals', () => {
    const schemaV2 = schemaV2Artifact();
    expect(() =>
      parseTelemetryData({
        ...schemaV2,
        summary: { ...schemaV2.summary, event_count: 999 },
      })
    ).toThrow('totals');
  });

  test('validates a mutually consistent ready schema-v3 model', () => {
    expect(parseTelemetryData(readyArtifact()).preference_model?.status).toBe(
      'ready'
    );
  });

  test('validates a mutually consistent ready schema-v4 online model', () => {
    const parsed = parseTelemetryData(readyV4Artifact());

    expect(parsed.schema.version).toBe(4);
    expect(parsed.summary.estimated_session_count).toBe(40);
    expect(parsed.preference_model?.status).toBe('ready');
    expect(parsed.preference_model?.version).toMatch(
      /^preference-v2:[0-9a-f]{16}$/
    );
  });

  test('accepts schema-v4 aggregate buckets and unpublished quality failures', () => {
    const bucketed = readyV4Artifact();
    bucketed.summary.model_versions = [
      { version: '2:0000000000000000', event_count: 200 },
      { version: 'other', event_count: 40 },
    ];
    expect(
      parseTelemetryData(bucketed).summary.model_versions
    ).toEqual(bucketed.summary.model_versions);

    const unavailable = readyV4Artifact();
    unavailable.preference_model.status = 'quality_gate_failed';
    unavailable.preference_model.version = null;
    unavailable.preference_model.weights = {};
    unavailable.preference_model.support = {};
    unavailable.rounds.forEach((round: Record<string, any>) => {
      round.preference_top_disagreement_count = null;
      round.meaningful_preference_disagreement_count = null;
      round.player_preference_agreement_count = null;
      round.average_meaningful_preference_disagreement_margin = null;
    });
    expect(
      parseTelemetryData(unavailable).preference_model?.status
    ).toBe('quality_gate_failed');
  });

  test('rejects invalid schema-v4 online-model contracts', () => {
    const mutations = [
      (artifact: Record<string, any>) => {
        artifact.preference_model.semantics_version = 1;
      },
      (artifact: Record<string, any>) => {
        artifact.preference_model.algorithm = 'batch-gradient-descent';
      },
      (artifact: Record<string, any>) => {
        artifact.preference_model.evidence.estimated_session_count = 39;
      },
      (artifact: Record<string, any>) => {
        artifact.preference_model.evaluation.event_count = 47;
      },
      (artifact: Record<string, any>) => {
        artifact.preference_model.evaluation.calibration_error = null;
      },
      (artifact: Record<string, any>) => {
        artifact.preference_model.evaluation.log_loss = 1.098612288668;
      },
      (artifact: Record<string, any>) => {
        artifact.preference_model.version =
          'preference-v1:0000000000000001';
      },
      (artifact: Record<string, any>) => {
        artifact.preference_model.support['["score"]'] = 29;
      },
      (artifact: Record<string, any>) => {
        artifact.analytics.items.heroes.pop();
      },
      (artifact: Record<string, any>) => {
        artifact.analytics.score_margins[1].label = '任意标签';
      },
    ];

    for (const mutate of mutations) {
      const artifact = readyV4Artifact();
      mutate(artifact);
      expect(() => parseTelemetryData(artifact)).toThrow();
    }
  });

  test('accepts nullable zero-event v4 evaluation metrics and keeps non-ready models unpublished', () => {
    const unavailable = insufficientV4Artifact();

    expect(
      parseTelemetryData(unavailable).preference_model?.status
    ).toBe('insufficient_evidence');

    const nonNullMetric = clone(unavailable);
    nonNullMetric.preference_model.evaluation.accuracy = 0;
    expect(() => parseTelemetryData(nonNullMetric)).toThrow('evidence');

    const leakedCoefficient = clone(unavailable);
    leakedCoefficient.preference_model.weights = { '["score"]': 0 };
    leakedCoefficient.preference_model.support = { '["score"]': 30 };
    expect(() => parseTelemetryData(leakedCoefficient)).toThrow('status');
  });

  test('allows only the exact privacy bucket among unhashed preference versions', () => {
    const bucketed = readyArtifact();
    bucketed.summary.preference_event_count = 30;
    bucketed.summary.preference_model_versions = [
      { version: 'other', event_count: 20 },
      {
        version: 'preference-v2:0000000000000002',
        event_count: 10,
      },
    ];
    expect(
      parseTelemetryData(bucketed).summary.preference_model_versions
    ).toEqual(bucketed.summary.preference_model_versions);

    const arbitraryLabel = clone(bucketed);
    arbitraryLabel.summary.preference_model_versions[0].version = 'redacted';
    expect(() => parseTelemetryData(arbitraryLabel)).toThrow('version totals');

    const bareModelFamily = clone(bucketed);
    bareModelFamily.summary.preference_model_versions[1].version =
      'preference-v1';
    expect(() => parseTelemetryData(bareModelFamily)).toThrow('version totals');
  });

  test('cross-checks round types, summary totals, suppression, and evidence', () => {
    const mutations = [
      (artifact: Record<string, any>) => {
        artifact.rounds[0].round_type = 'skill';
      },
      (artifact: Record<string, any>) => {
        artifact.summary.recommendation_accepted_count = 159;
      },
      (artifact: Record<string, any>) => {
        artifact.rounds[0].rate_suppressed = true;
      },
      (artifact: Record<string, any>) => {
        artifact.preference_model.evidence.event_count = 239;
      },
      (artifact: Record<string, any>) => {
        artifact.preference_model.evidence.recommendation_disagreement_count =
          30;
      },
      (artifact: Record<string, any>) => {
        artifact.preference_model.held_out.train_event_count = 191;
      },
      (artifact: Record<string, any>) => {
        artifact.preference_model.evidence.holdout_event_count = 240;
        artifact.preference_model.held_out.event_count = 240;
        artifact.preference_model.held_out.train_event_count = 0;
      },
      (artifact: Record<string, any>) => {
        artifact.preference_model.held_out.log_loss = 1.098612288668;
      },
    ];

    for (const mutate of mutations) {
      const artifact = readyArtifact();
      mutate(artifact);
      expect(() => parseTelemetryData(artifact)).toThrow();
    }
  });

  test('requires canonical, supported, bounded preference features', () => {
    const malformed = readyArtifact();
    malformed.preference_model.weights = { '[ "score" ]': 0.5 };
    malformed.preference_model.support = { '[ "score" ]': 720 };
    expect(() => parseTelemetryData(malformed)).toThrow('ready model');

    const lowSupport = readyArtifact();
    lowSupport.preference_model.weights = { '["round_score",1]': 0.5 };
    lowSupport.preference_model.support = { '["round_score",1]': 29 };
    expect(() => parseTelemetryData(lowSupport)).toThrow('ready model');

    const tooMany = readyArtifact();
    tooMany.preference_model.weights = Object.fromEntries(
      Array.from({ length: 5_001 }, (_, index) => [
        JSON.stringify(['item', 'hero', `H${index}`]),
        0.1,
      ])
    );
    tooMany.preference_model.support = Object.fromEntries(
      Object.keys(tooMany.preference_model.weights).map((featureId) => [
        featureId,
        10,
      ])
    );
    expect(() => parseTelemetryData(tooMany)).toThrow('ready model');
  });

  test('cross-checks item opportunities, item suppression, and margin totals', () => {
    const withItem = readyArtifact();
    withItem.analytics.items.heroes = [
      {
        name: '甲',
        offer_count: 5,
        opportunity_count: 90,
        picked_count: 2,
        rate_suppressed: true,
      },
    ];
    expect(parseTelemetryData(withItem).analytics?.items.heroes).toHaveLength(1);

    const wrongOpportunity = clone(withItem);
    wrongOpportunity.analytics.items.heroes[0].opportunity_count = 89;
    expect(() => parseTelemetryData(wrongOpportunity)).toThrow('analytics');

    const impossibleOfferCount = clone(withItem);
    impossibleOfferCount.analytics.items.heroes[0].offer_count = 91;
    impossibleOfferCount.analytics.items.heroes[0].rate_suppressed = false;
    expect(() => parseTelemetryData(impossibleOfferCount)).toThrow('analytics');

    const wrongItemSuppression = clone(withItem);
    wrongItemSuppression.analytics.items.heroes[0].rate_suppressed = false;
    expect(() => parseTelemetryData(wrongItemSuppression)).toThrow('analytics');

    const wrongMarginTotal = readyArtifact();
    wrongMarginTotal.analytics.score_margins[0].event_count = 239;
    expect(() => parseTelemetryData(wrongMarginTotal)).toThrow('totals');

    const wrongMarginSuppression = readyArtifact();
    wrongMarginSuppression.analytics.score_margins[1].rate_suppressed = false;
    expect(() => parseTelemetryData(wrongMarginSuppression)).toThrow(
      'score-margin'
    );
  });

  test('publishes disagreement averages only for ready, supported rounds', () => {
    const supported = readyArtifact();
    supported.rounds[0].preference_top_disagreement_count = 10;
    supported.rounds[0].meaningful_preference_disagreement_count = 10;
    supported.rounds[0].average_meaningful_preference_disagreement_margin = 0.2;
    expect(
      parseTelemetryData(supported).rounds[0]
        .average_meaningful_preference_disagreement_margin
    ).toBe(0.2);

    const lowSupport = readyArtifact();
    lowSupport.rounds[0].average_meaningful_preference_disagreement_margin = 0.2;
    expect(() => parseTelemetryData(lowSupport)).toThrow('round 1');

    const unavailable = readyArtifact();
    unavailable.preference_model.status = 'quality_gate_failed';
    unavailable.preference_model.version = null;
    unavailable.preference_model.held_out.log_loss = 1.098612288668;
    unavailable.preference_model.weights = {};
    unavailable.preference_model.support = {};
    unavailable.rounds.forEach((round: Record<string, any>) => {
      round.preference_top_disagreement_count = null;
      round.meaningful_preference_disagreement_count = null;
      round.player_preference_agreement_count = null;
      round.average_meaningful_preference_disagreement_margin = null;
    });
    expect(
      parseTelemetryData(unavailable).preference_model?.status
    ).toBe('quality_gate_failed');
    unavailable.rounds[0].average_meaningful_preference_disagreement_margin =
      0.2;
    expect(() => parseTelemetryData(unavailable)).toThrow('round 1');
  });
});

describe('static telemetry cache recovery', () => {
  test('times out, aborts, clears the failed cache, and retries successfully', async () => {
    vi.useFakeTimers();
    let firstSignal: AbortSignal | null | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        (
          _input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1]
        ) => {
          firstSignal = init?.signal;
          return new Promise<Response>(() => undefined);
        }
      )
      .mockResolvedValueOnce(responseFor(schemaV2Artifact()));
    vi.stubGlobal('fetch', fetchMock);

    const firstLoad = loadTelemetryData();
    const rejection = expect(firstLoad).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(5_000);
    await rejection;

    expect(firstSignal?.aborted).toBe(true);
    const recovered = await loadTelemetryData();
    expect(recovered.schema.version).toBe(2);
    expect(getCachedTelemetryData()).toBe(recovered);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('clearing an in-flight request prevents its late result from replacing a new cache', async () => {
    vi.useFakeTimers();
    let settleFirst!: (response: Response) => void;
    let firstSignal: AbortSignal | null | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        (
          _input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1]
        ) => {
          firstSignal = init?.signal;
          return new Promise<Response>((resolve) => {
            settleFirst = resolve;
          });
        }
      )
      .mockResolvedValueOnce(responseFor(schemaV2Artifact()));
    vi.stubGlobal('fetch', fetchMock);

    const staleLoad = loadTelemetryData();
    clearTelemetryDataCacheForTests();
    expect(firstSignal?.aborted).toBe(true);

    const active = await loadTelemetryData();
    const staleArtifact = schemaV2Artifact();
    staleArtifact.summary.invalid_event_count = 99;
    settleFirst(responseFor(staleArtifact));
    await staleLoad;

    expect(getCachedTelemetryData()).toBe(active);
    expect(getCachedTelemetryData()?.summary.invalid_event_count).toBe(
      schemaV2Artifact().summary.invalid_event_count
    );
  });
});
