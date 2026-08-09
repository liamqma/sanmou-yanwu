import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentHttpServer } from '../src/httpServer.js';
import type { ChatCompletionRequest, ChatModel } from '../src/model.js';

class FakeChatModel implements ChatModel {
  readonly requests: ChatCompletionRequest[] = [];

  async complete(request: ChatCompletionRequest) {
    this.requests.push(request);
    return {
      id: 'fake-1',
      model: 'fake-model',
      content: 'fake-response',
      finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    };
  }
}

const openServers: Server[] = [];

async function startServer(model: ChatModel): Promise<{ server: Server; baseUrl: string }> {
  const server = createAgentHttpServer({ model, modelName: 'fake-model' });
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
});
