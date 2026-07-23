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
  test('accepts the generated hand-off with version-appropriate invariants', () => {
    const telemetry = parseTelemetryData(telemetryRaw);

    expect(telemetry.summary.event_count).toBe(
      telemetry.rounds.reduce((sum, round) => sum + round.event_count, 0)
    );
    expect(telemetry.rounds).toHaveLength(8);
    if (telemetry.schema.version === 2) {
      expect(telemetry.preference_model).toBeNull();
      expect(telemetry.analytics).toBeUndefined();
    } else {
      expect(telemetry.schema.version).toBe(3);
      expect(telemetry.analytics?.minimum_rate_support).toBe(10);
      expect(telemetry.preference_model?.status).toMatch(
        /^(insufficient_evidence|quality_gate_failed|ready)$/
      );
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
