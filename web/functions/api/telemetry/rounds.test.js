import { onRequestPost, validateRoundEvent } from './rounds';

const EVENT_ONE = Object.freeze({
  event_id: '3d594650-3436-4af3-aeef-3f7b2ecdbf70',
  session_id: 'be64bd87-50f8-48ff-bbe0-c6313723815e',
  client_ts: '2026-07-22T01:02:03.000Z',
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

  test('rejects fields outside the privacy-minimized contract', () => {
    expect(validateRoundEvent(cloneEvent({ user_agent: 'browser' }))).toBe(
      'event has unexpected fields'
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
          preference_model_version: 'preference-v1',
          preference_probabilities: null,
        })
      )
    ).toBe('preference version and probabilities must both be null or valid');
  });

  test('allows normalized preference probabilities for the later model phase', () => {
    expect(
      validateRoundEvent(
        cloneEvent({
          preference_model_version: 'preference-v1',
          preference_probabilities: [0.5, 0.3, 0.2],
        })
      )
    ).toBeNull();
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
