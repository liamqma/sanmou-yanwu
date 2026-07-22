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
} from '../../utils/telemetryStorage';
import type { RoundTelemetryInput } from '../../types/telemetry';

const INPUT: RoundTelemetryInput = {
  roundNumber: 1,
  roundType: 'hero',
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
  pairedScores: [18.4, 13.1, 7.8],
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
      preference_model_version: null,
      preference_probabilities: null,
    });

    INPUT.poolBefore.heroes.push('later mutation');
    INPUT.offeredSets[0].push('later mutation');
    INPUT.pairedScores[0] = -999;

    expect(event?.pool_before.heroes).not.toContain('later mutation');
    expect(event?.pool_before).toMatchObject({
      hero_support: '诸葛亮',
      skills_support: ['战法三', '战法四'],
    });
    expect(event?.offered_sets[0]).not.toContain('later mutation');
    expect(event?.paired_scores[0]).toBe(18.4);

    INPUT.poolBefore.heroes.pop();
    INPUT.offeredSets[0].pop();
    INPUT.pairedScores[0] = 18.4;
  });

  test('refuses incomplete score data instead of creating a poison event', () => {
    expect(createRoundTelemetryEvent({ ...INPUT, pairedScores: [1, 2] })).toBeNull();
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
});
