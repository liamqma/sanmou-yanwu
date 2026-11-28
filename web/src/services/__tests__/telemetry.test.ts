import {
  beginTelemetrySession,
  createRoundTelemetryEvent,
  flushTelemetryQueue,
} from '../telemetry';
import {
  clearTelemetryStorageForTests,
  enqueueTelemetryEvent,
  getOrCreateTelemetrySession,
  loadTelemetryQueue,
  MAX_TELEMETRY_QUEUE_SIZE,
  TELEMETRY_QUEUE_TTL_MS,
} from '../../utils/telemetryStorage';
import type { RoundTelemetryInput } from '../../types/telemetry';
import { validateRoundEvent } from '../../../functions/api/telemetry/rounds.js';
import { CATALOG_VERSION } from '../../data';

const MODEL_VERSION = '9:0123456789abcdef';
const INPUT: RoundTelemetryInput = {
  roundNumber: 1,
  roundType: 'hero',
  modelVersion: MODEL_VERSION,
  poolBefore: {
    heroes: ['刘备', '关羽', '张飞', '赵云'],
    skills: ['战法一', '战法二'],
    heroSupport: '诸葛亮',
    skillsSupport: ['战法三', '战法四'],
  },
  offeredSets: [
    ['曹操', '夏侯惇', '夏侯渊'],
    ['孙权', '周瑜', '鲁肃'],
    ['袁绍', '颜良', '文丑'],
  ],
  scores: [-18.4, -23.1, -27.8],
  recommendedIndex: 0,
  chosenIndex: 1,
};

beforeEach(() => {
  clearTelemetryStorageForTests();
});

describe('anonymous telemetry sessions', () => {
  test('reuses one session for the current game and rotates on a new game', () => {
    const first = getOrCreateTelemetrySession();
    expect(getOrCreateTelemetrySession()).toBe(first);

    beginTelemetrySession();
    expect(getOrCreateTelemetrySession()).not.toBe(first);
  });
});

describe('round telemetry construction', () => {
  test('captures independent copies of the pre-choice pool, offers, scores and choice', () => {
    const event = createRoundTelemetryEvent(INPUT);
    expect(event).not.toBeNull();
    expect(event).toMatchObject({
      round_number: 1,
      round_type: 'hero',
      recommended_index: 0,
      chosen_index: 1,
      model_version: MODEL_VERSION,
      catalog_version: CATALOG_VERSION,
      preference_model_version: null,
      preference_probabilities: null,
    });

    // The Pages Function accepts what the app sends.
    expect(validateRoundEvent(event)).toBeNull();

    INPUT.poolBefore.heroes.push('later mutation');
    INPUT.offeredSets[0].push('later mutation');
    INPUT.scores[0] = -999;

    expect(event?.pool_before.heroes).not.toContain('later mutation');
    expect(event?.pool_before).toMatchObject({
      hero_support: '诸葛亮',
      skills_support: ['战法三', '战法四'],
    });
    expect(event?.offered_sets[0]).not.toContain('later mutation');
    expect(event?.paired_scores[0]).toBe(-18.4);

    INPUT.poolBefore.heroes.pop();
    INPUT.offeredSets[0].pop();
    INPUT.scores[0] = -18.4;
  });

  test('refuses events the telemetry builder would reject', () => {
    expect(createRoundTelemetryEvent({ ...INPUT, scores: [1, 2] })).toBeNull();
    expect(createRoundTelemetryEvent({ ...INPUT, scores: [-18.4, NaN, -27.8] })).toBeNull();
    // The recommended set must have a highest score.
    expect(createRoundTelemetryEvent({ ...INPUT, recommendedIndex: 1 })).toBeNull();
    expect(createRoundTelemetryEvent({ ...INPUT, modelVersion: 'lineup-net' })).toBeNull();
  });

  test('accepts round 9 and 10 with their repeated offer shapes', () => {
    const round9 = createRoundTelemetryEvent({
      ...INPUT,
      roundNumber: 9,
      offeredSets: INPUT.offeredSets.map((set) => set.slice(0, 2)),
    });
    const round10 = createRoundTelemetryEvent({
      ...INPUT,
      roundNumber: 10,
      roundType: 'skill',
    });

    expect(round9).toMatchObject({ round_number: 9, round_type: 'hero' });
    expect(round10).toMatchObject({ round_number: 10, round_type: 'skill' });
  });

  test('rejects a mismatched round type, offer size, or round 11', () => {
    expect(
      createRoundTelemetryEvent({
        ...INPUT,
        roundNumber: 9,
        roundType: 'skill',
        offeredSets: INPUT.offeredSets.map((set) => set.slice(0, 2)),
      })
    ).toBeNull();
    expect(
      createRoundTelemetryEvent({ ...INPUT, roundNumber: 9 })
    ).toBeNull();
    expect(
      createRoundTelemetryEvent({ ...INPUT, roundNumber: 11 })
    ).toBeNull();
  });

  test('refuses an offered item already present in the relevant pool', () => {
    expect(
      createRoundTelemetryEvent({
        ...INPUT,
        poolBefore: {
          ...INPUT.poolBefore,
          heroes: [...INPUT.poolBefore.heroes, INPUT.offeredSets[0][0]],
        },
      })
    ).toBeNull();
  });

  test('omits support fields when the player has not entered support', () => {
    const event = createRoundTelemetryEvent({
      ...INPUT,
      poolBefore: { heroes: INPUT.poolBefore.heroes, skills: INPUT.poolBefore.skills },
    });
    expect(event?.pool_before).toEqual({
      heroes: INPUT.poolBefore.heroes,
      skills: INPUT.poolBefore.skills,
    });
  });
});

describe('local telemetry retry queue', () => {
  test('removes a batch only after the endpoint confirms success', async () => {
    const event = createRoundTelemetryEvent(INPUT)!;
    enqueueTelemetryEvent(event);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ ok: true, accepted: 1, duplicates: 0 })
    );

    await flushTelemetryQueue(fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      '/api/telemetry/rounds',
      expect.objectContaining({ method: 'POST', keepalive: true })
    );
    expect(loadTelemetryQueue()).toEqual([]);
  });

  test('retains events after a network or storage-service failure', async () => {
    const event = createRoundTelemetryEvent(INPUT)!;
    enqueueTelemetryEvent(event);

    await flushTelemetryQueue(vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')));
    expect(loadTelemetryQueue()).toHaveLength(1);

    await flushTelemetryQueue(
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ ok: false, error: 'unavailable' }, { status: 503 })
      )
    );
    expect(loadTelemetryQueue()).toHaveLength(1);
  });

  test('retains retryable 408 and 429 responses', async () => {
    for (const status of [408, 429]) {
      clearTelemetryStorageForTests();
      enqueueTelemetryEvent(createRoundTelemetryEvent(INPUT)!);
      await flushTelemetryQueue(
        vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: false }, { status }))
      );
      expect(loadTelemetryQueue()).toHaveLength(1);
    }
  });

  test('drops permanent validation failures and continues draining later batches', async () => {
    for (let index = 0; index < 10; index += 1) {
      enqueueTelemetryEvent(createRoundTelemetryEvent(INPUT)!);
    }
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ok: false }, { status: 422 }))
      .mockResolvedValue(Response.json({ ok: true }));

    await flushTelemetryQueue(fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(loadTelemetryQueue()).toEqual([]);
  });

  test('caps retained telemetry so failures cannot grow localStorage without bound', () => {
    for (let index = 0; index < MAX_TELEMETRY_QUEUE_SIZE + 5; index += 1) {
      const event = createRoundTelemetryEvent(INPUT)!;
      event.event_id = crypto.randomUUID();
      enqueueTelemetryEvent(event);
    }

    expect(loadTelemetryQueue()).toHaveLength(MAX_TELEMETRY_QUEUE_SIZE);
  });

  test('expires queued retries after seven days so purged events cannot be replayed', async () => {
    const event = createRoundTelemetryEvent(INPUT)!;
    event.client_ts = new Date(Date.now() - TELEMETRY_QUEUE_TTL_MS - 1).toISOString();
    enqueueTelemetryEvent(event);
    const fetcher = vi.fn<typeof fetch>();

    await flushTelemetryQueue(fetcher);

    expect(fetcher).not.toHaveBeenCalled();
    expect(loadTelemetryQueue()).toEqual([]);
  });
});
