import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentHttpServer } from '../src/httpServer.js';
import type { ChatCompletionRequest, ChatModel } from '../src/model.js';
import type { TeamRecommendationInput } from '../src/team/teamRecommendationSchemas.js';
import type { TeamReviewAttemptDiagnostic } from '../src/team/teamReviewSubgraph.js';
import {
  completeReviewTeams,
  skillTestKnowledge,
  validReviewDecision,
} from './teamFixtures.js';

const BROWSER_ORIGIN = 'https://sanmouyanwu.com';

class FakeChatModel implements ChatModel {
  readonly requests: ChatCompletionRequest[] = [];

  constructor(private readonly content: string | string[] = 'fake-response') {}

  async complete(request: ChatCompletionRequest) {
    const responseIndex = this.requests.length;
    this.requests.push(request);
    return {
      id: 'fake-1',
      model: 'fake-model',
      content: Array.isArray(this.content)
        ? this.content[responseIndex] ?? this.content.at(-1) ?? ''
        : this.content,
      finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    };
  }
}

const openServers: Server[] = [];

async function startServer(
  model: ChatModel,
  onReviewAttempt?: (diagnostic: TeamReviewAttemptDiagnostic) => void
): Promise<{ server: Server; baseUrl: string }> {
  const server = createAgentHttpServer({
    model,
    modelName: 'fake-model',
    knowledge: skillTestKnowledge,
    reasoningEffort: 'high',
    allowedOrigins: [BROWSER_ORIGIN, 'http://localhost:3000'],
    ...(onReviewAttempt === undefined ? {} : { onReviewAttempt }),
  });
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        )
    )
  );
});

describe('agent HTTP server', () => {
  it('reports liveness and readiness without a model request', async () => {
    const model = new FakeChatModel();
    const { baseUrl } = await startServer(model);

    const live = await fetch(`${baseUrl}/health/live`);
    const ready = await fetch(`${baseUrl}/health/ready`);

    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: 'ok' });
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: 'ready', model: 'fake-model' });
    expect(model.requests).toEqual([]);
  });

  it('validates and forwards a chat request', async () => {
    const model = new FakeChatModel();
    const { baseUrl } = await startServer(model);

    const response = await fetch(`${baseUrl}/v1/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hello' }],
        reasoningEffort: 'high',
        maxCompletionTokens: 64,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      model: 'fake-model',
      content: 'fake-response',
    });
    expect(model.requests).toEqual([
      {
        messages: [{ role: 'user', content: 'hello' }],
        reasoningEffort: 'high',
        maxCompletionTokens: 64,
      },
    ]);
  });

  it('rejects an invalid request without calling the model', async () => {
    const model = new FakeChatModel();
    const { baseUrl } = await startServer(model);

    const response = await fetch(`${baseUrl}/v1/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { type: 'validation_error' },
    });
    expect(model.requests).toEqual([]);
  });

  it('answers browser preflight only for an allowed team endpoint origin', async () => {
    const model = new FakeChatModel();
    const { baseUrl } = await startServer(model);

    const response = await fetch(`${baseUrl}/v1/team-recommendations`, {
      method: 'OPTIONS',
      headers: {
        origin: BROWSER_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(BROWSER_ORIGIN);
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('access-control-allow-headers')).toBe('Content-Type');
    expect(response.headers.get('vary')).toBe('Origin');
    expect(model.requests).toEqual([]);
  });

  it('rejects disallowed browser origins and browser access to generic chat', async () => {
    const model = new FakeChatModel();
    const { baseUrl } = await startServer(model);

    const disallowed = await fetch(`${baseUrl}/health/ready`, {
      headers: { origin: 'https://example.com' },
    });
    const genericChat = await fetch(`${baseUrl}/v1/chat`, {
      method: 'POST',
      headers: {
        origin: BROWSER_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });

    expect(disallowed.status).toBe(403);
    expect(disallowed.headers.get('access-control-allow-origin')).toBeNull();
    expect(await disallowed.json()).toMatchObject({
      error: { type: 'forbidden_origin' },
    });
    expect(genericChat.status).toBe(403);
    expect(genericChat.headers.get('access-control-allow-origin')).toBeNull();
    expect(model.requests).toEqual([]);
  });

  it('routes a completed browser lineup directly to grounded review', async () => {
    const model = new FakeChatModel(validReviewDecision);
    const diagnostics: TeamReviewAttemptDiagnostic[] = [];
    const { baseUrl } = await startServer(model, (diagnostic) =>
      diagnostics.push(diagnostic)
    );

    const response = await fetch(`${baseUrl}/v1/team-recommendations`, {
      method: 'POST',
      headers: {
        origin: BROWSER_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        season: 1,
        availableHeroes: [],
        availableSkills: [],
        teams: completeReviewTeams,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(BROWSER_ORIGIN);
    expect(await response.json()).toMatchObject({
      status: 'complete',
      stoppedAt: null,
      attempts: { heroes: 0, formations: 0, skills: 0, review: 1 },
      review: { status: 'complete', verdict: 'sound' },
    });
    expect(model.requests).toHaveLength(1);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        attempt: 1,
        outcome: 'accepted',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        validationErrors: [],
      }),
    ]);
  });

  it('runs every recommendation stage for a partial browser lineup', async () => {
    const input: TeamRecommendationInput = {
      season: 1,
      availableHeroes: ['魏丙', '蜀甲'],
      availableSkills: ['治疗术'],
      teams: [
        {
          formation: null,
          heroes: [
            { hero: '魏甲', row: null, skills: ['甲技', null] },
            { hero: '魏乙', row: '前排', skills: ['乙技', '丙技'] },
            { hero: null, row: null, skills: ['丁技', '戊技'] },
          ],
        },
      ],
    };
    const model = new FakeChatModel([
      JSON.stringify({
        assignments: [
          {
            teamIndex: 0,
            slotIndex: 2,
            hero: '魏丙',
            reason: '三魏触发10%属性加成。',
            evidence: ['同阵营三人'],
          },
        ],
      }),
      JSON.stringify({
        decisions: [
          {
            teamIndex: 0,
            formation: '雁形阵',
            rows: [
              { slotIndex: 0, row: '后排' },
              { slotIndex: 1, row: '前排' },
              { slotIndex: 2, row: '后排' },
            ],
            reason: '乙在前排承伤，甲与丙在后排发挥。',
            evidence: ['雁形阵后排增伤'],
          },
        ],
      }),
      JSON.stringify({
        assignments: [
          {
            teamIndex: 0,
            slotIndex: 0,
            skillSlotIndex: 1,
            skill: '治疗术',
            reason: '利用智力补充团队治疗。',
            evidence: ['治疗受智力影响'],
          },
        ],
      }),
      validReviewDecision,
    ]);
    const { baseUrl } = await startServer(model);

    const response = await fetch(`${baseUrl}/v1/team-recommendations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'complete',
      attempts: { heroes: 1, formations: 1, skills: 1, review: 1 },
      teams: [
        {
          formation: '雁形阵',
          heroes: [
            { hero: '魏甲', row: '后排', skills: ['甲技', '治疗术'] },
            { hero: '魏乙', row: '前排', skills: ['乙技', '丙技'] },
            { hero: '魏丙', row: '后排', skills: ['丁技', '戊技'] },
          ],
        },
      ],
    });
    expect(model.requests).toHaveLength(4);
  });

  it('rejects an invalid team contract before calling the model', async () => {
    const model = new FakeChatModel();
    const { baseUrl } = await startServer(model);

    const response = await fetch(`${baseUrl}/v1/team-recommendations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teams: [] }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: {
        type: 'validation_error',
        message: 'Request body does not match the team recommendation contract',
      },
    });
    expect(model.requests).toEqual([]);
  });
});
