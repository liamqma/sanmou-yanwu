import {
  MAX_EVENT_AGE_MS,
  MAX_FUTURE_SKEW_MS,
  onRequestPost,
  validateRoundEvent,
} from './rounds';

const EVENT_ONE = Object.freeze({
  event_id: '3d594650-3436-4af3-aeef-3f7b2ecdbf70',
  session_id: 'be64bd87-50f8-48ff-bbe0-c6313723815e',
  client_ts: new Date().toISOString(),
  round_number: 1,
  round_type: 'hero',
  schema_version: 1,
  model_version: '2:corpus-hash',
  catalog_version: 'catalog-hash',
  pool_before: {
    heroes: ['刘备', '关羽', '张飞', '赵云'],
    skills: ['战法一', '战法二'],
    hero_support: '诸葛亮',
    skills_support: ['战法三', '战法四'],
  },
  offered_sets: [
    ['曹操', '夏侯惇', '夏侯渊'],
    ['孙权', '周瑜', '鲁肃'],
    ['袁绍', '颜良', '文丑'],
  ],
  paired_scores: [18.4, 13.1, 7.8],
  recommended_index: 0,
  chosen_index: 1,
  preference_model_version: null,
  preference_probabilities: null,
});

const cloneEvent = (overrides = {}) => ({
  ...EVENT_ONE,
  pool_before: { ...EVENT_ONE.pool_before },
  offered_sets: EVENT_ONE.offered_sets.map((set) => [...set]),
  paired_scores: [...EVENT_ONE.paired_scores],
  ...overrides,
});

class FakeD1 {
  constructor() {
    this.eventIds = new Set();
  }

  prepare() {
    return {
      bind: (...values) => ({ values }),
    };
  }

  async batch(statements) {
    return statements.map(({ values }) => {
      const eventId = values[0];
      const changes = this.eventIds.has(eventId) ? 0 : 1;
      this.eventIds.add(eventId);
      return { meta: { changes } };
    });
  }
}

const requestFor = (body) =>
  new Request('https://example.test/api/telemetry/rounds', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('round telemetry validation', () => {
  test('accepts a complete schema-v1 round event', () => {
    expect(validateRoundEvent(cloneEvent())).toBeNull();
  });

  test('allows support context to be omitted', () => {
    const event = cloneEvent();
    delete event.pool_before.hero_support;
    delete event.pool_before.skills_support;
    expect(validateRoundEvent(event)).toBeNull();
  });

  test('rejects invalid support context', () => {
    expect(
      validateRoundEvent(cloneEvent({ pool_before: { ...EVENT_ONE.pool_before, skills_support: [] } }))
    ).toBe('pool_before contains invalid support items');
  });

  test.each([
    ['normal pool', '刘备'],
    ['support selection', '诸葛亮'],
  ])('rejects a hero offer overlapping the %s', (_category, overlappingHero) => {
    const event = cloneEvent();
    event.offered_sets[0][0] = overlappingHero;
    expect(validateRoundEvent(event)).toBe('offered_sets overlaps pool_before');
  });

  test('rejects a skill offer overlapping support skills', () => {
    const event = cloneEvent({
      round_number: 2,
      round_type: 'skill',
      offered_sets: [
        ['战法三', '战法五', '战法六'],
        ['战法七', '战法八', '战法九'],
        ['战法十', '战法十一', '战法十二'],
      ],
    });
    expect(validateRoundEvent(event)).toBe('offered_sets overlaps pool_before');
  });

  test('rejects duplicate items across offered sets', () => {
    const event = cloneEvent();
    event.offered_sets[1][0] = event.offered_sets[0][0];
    expect(validateRoundEvent(event)).toBe('offered_sets contains duplicate items');
  });

  test('rejects fields outside the privacy-minimized contract', () => {
    expect(validateRoundEvent(cloneEvent({ user_agent: 'browser' }))).toBe(
      'event has unexpected fields'
    );
  });

  test.each([
    '2026-07-22',
    '07/22/2026',
    '2026-02-30T01:02:03.000Z',
    '2026-13-01T01:02:03.000Z',
  ])(
    'rejects non-canonical client timestamp %s',
    (client_ts) => {
      expect(validateRoundEvent(cloneEvent({ client_ts }))).toBe(
        'client_ts must be an ISO timestamp'
      );
    }
  );

  test('accepts retries through the seven-day boundary and rejects older events', () => {
    const nowMs = Date.parse('2026-07-24T01:02:03.000Z');
    const atBoundary = new Date(nowMs - MAX_EVENT_AGE_MS).toISOString();
    const expired = new Date(nowMs - MAX_EVENT_AGE_MS - 1).toISOString();

    expect(validateRoundEvent(cloneEvent({ client_ts: atBoundary }), nowMs)).toBeNull();
    expect(validateRoundEvent(cloneEvent({ client_ts: expired }), nowMs)).toBe(
      'client_ts is older than the retry window'
    );
  });

  test('allows small clock skew and rejects timestamps too far in the future', () => {
    const nowMs = Date.parse('2026-07-24T01:02:03.000Z');
    const atBoundary = new Date(nowMs + MAX_FUTURE_SKEW_MS).toISOString();
    const tooFarAhead = new Date(nowMs + MAX_FUTURE_SKEW_MS + 1).toISOString();

    expect(validateRoundEvent(cloneEvent({ client_ts: atBoundary }), nowMs)).toBeNull();
    expect(validateRoundEvent(cloneEvent({ client_ts: tooFarAhead }), nowMs)).toBe(
      'client_ts is too far in the future'
    );
  });

  test('requires the recommendation to identify a highest paired score', () => {
    expect(validateRoundEvent(cloneEvent({ recommended_index: 2 }))).toBe(
      'recommended_index must identify a highest paired score'
    );
  });

  test('requires preference probabilities and version to appear together', () => {
    expect(
      validateRoundEvent(
        cloneEvent({
          preference_model_version: 'preference-v1:0000000000000001',
          preference_probabilities: null,
        })
      )
    ).toBe('preference version and probabilities must both be null or valid');
  });

  test('allows normalized preference probabilities for the later model phase', () => {
    expect(
      validateRoundEvent(
        cloneEvent({
          preference_model_version: 'preference-v1:0000000000000001',
          preference_probabilities: [0.5, 0.3, 0.2],
        })
      )
    ).toBeNull();
  });

  test('rejects a preference version without its content hash', () => {
    expect(
      validateRoundEvent(
        cloneEvent({
          preference_model_version: 'preference-v1',
          preference_probabilities: [0.5, 0.3, 0.2],
        })
      )
    ).toBe('preference version and probabilities must both be null or valid');
  });
});

describe('POST /api/telemetry/rounds', () => {
  test('stores valid events and treats retries as duplicates', async () => {
    const database = new FakeD1();
    const context = {
      request: requestFor({ events: [cloneEvent()] }),
      env: { TELEMETRY_DB: database },
    };

    const first = await onRequestPost(context);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ ok: true, accepted: 1, duplicates: 0 });

    const retry = await onRequestPost({
      ...context,
      request: requestFor({ events: [cloneEvent()] }),
    });
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toEqual({ ok: true, accepted: 0, duplicates: 1 });
  });

  test('rejects an invalid event without writing the batch', async () => {
    const database = new FakeD1();
    const response = await onRequestPost({
      request: requestFor({ events: [cloneEvent({ round_type: 'skill' })] }),
      env: { TELEMETRY_DB: database },
    });

    expect(response.status).toBe(400);
    expect(database.eventIds.size).toBe(0);
  });

  test.each([
    ['expired', -MAX_EVENT_AGE_MS - 1],
    ['too far in the future', MAX_FUTURE_SKEW_MS + 60_000],
  ])('permanently rejects an %s event without writing it', async (_label, offsetMs) => {
    const database = new FakeD1();
    const response = await onRequestPost({
      request: requestFor({
        events: [
          cloneEvent({
            client_ts: new Date(Date.now() + offsetMs).toISOString(),
          }),
        ],
      }),
      env: { TELEMETRY_DB: database },
    });

    expect(response.status).toBe(422);
    expect(database.eventIds.size).toBe(0);
  });

  test('fails safely when the production D1 binding is absent', async () => {
    const response = await onRequestPost({
      request: requestFor({ events: [cloneEvent()] }),
      env: {},
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  test('rejects a streamed body once it crosses the byte limit', async () => {
    const response = await onRequestPost({
      request: requestFor('x'.repeat(64 * 1024 + 1)),
      env: { TELEMETRY_DB: new FakeD1() },
    });

    expect(response.status).toBe(413);
  });
});
