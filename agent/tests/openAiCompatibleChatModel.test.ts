import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleChatModel } from '../src/openAiCompatibleChatModel.js';

describe('OpenAICompatibleChatModel', () => {
  it('maps the generic request and normalizes the completion', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          id: 'completion-1',
          model: 'resolved-model',
          choices: [
            {
              message: { content: 'hello' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 4,
            completion_tokens: 2,
            total_tokens: 6,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const model = new OpenAICompatibleChatModel({
      baseUrl: 'http://provider.test/v1',
      model: 'default-model',
      timeoutMs: 1000,
      apiKey: 'test-key',
      fetchImplementation,
    });

    const completion = await model.complete({
      messages: [{ role: 'user', content: 'hi' }],
      reasoningEffort: 'high',
      maxCompletionTokens: 50,
      temperature: 0,
    });

    expect(completion).toEqual({
      id: 'completion-1',
      model: 'resolved-model',
      content: 'hello',
      finishReason: 'stop',
      usage: {
        promptTokens: 4,
        completionTokens: 2,
        totalTokens: 6,
      },
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toBe('http://provider.test/v1/chat/completions');
    expect(init?.headers).toEqual({
      authorization: 'Bearer test-key',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'default-model',
      messages: [{ role: 'user', content: 'hi' }],
      reasoning_effort: 'high',
      max_completion_tokens: 50,
      temperature: 0,
    });
  });

  it('keeps a valid completion when upstream usage is missing', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          id: 'completion-2',
          model: 'resolved-model',
          choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const model = new OpenAICompatibleChatModel({
      baseUrl: 'http://provider.test/v1',
      model: 'default-model',
      timeoutMs: 1000,
      fetchImplementation,
    });

    const completion = await model.complete({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(completion).toEqual({
      id: 'completion-2',
      model: 'resolved-model',
      content: 'hello',
      finishReason: 'stop',
      usage: null,
    });
  });

  it('drops partial or non-integer usage without inventing counts', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          id: 'completion-3',
          model: 'resolved-model',
          choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 4, completion_tokens: 2.5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const model = new OpenAICompatibleChatModel({
      baseUrl: 'http://provider.test/v1',
      model: 'default-model',
      timeoutMs: 1000,
      fetchImplementation,
    });

    const completion = await model.complete({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(completion.content).toBe('hello');
    expect(completion.usage).toBeNull();
  });

  it('normalizes complete valid usage', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          id: 'completion-4',
          model: 'resolved-model',
          choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const model = new OpenAICompatibleChatModel({
      baseUrl: 'http://provider.test/v1',
      model: 'default-model',
      timeoutMs: 1000,
      fetchImplementation,
    });

    const completion = await model.complete({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(completion.usage).toEqual({
      promptTokens: 7,
      completionTokens: 3,
      totalTokens: 10,
    });
  });

  it('preserves a provider error message and status', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ error: { message: 'rate limited', type: 'rate_limit' } }),
        { status: 429, headers: { 'content-type': 'application/json' } }
      )
    );
    const model = new OpenAICompatibleChatModel({
      baseUrl: 'http://provider.test/v1',
      model: 'test-model',
      timeoutMs: 1000,
      fetchImplementation,
    });

    await expect(
      model.complete({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toMatchObject({
      message: 'rate limited',
      statusCode: 429,
    });
  });
});
