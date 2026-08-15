import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleResponsesModel } from '../src/openAiCompatibleResponsesModel.js';

function completedResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'response-1',
    model: 'resolved-model',
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'hello', annotations: [] }],
      },
    ],
    ...overrides,
  };
}

describe('OpenAICompatibleResponsesModel', () => {
  it('maps the generic request to Responses API and normalizes the response', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify(
          completedResponse({
            output: [
              { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Think.' }] },
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'hello', annotations: [] }],
              },
            ],
            usage: {
              input_tokens: 4,
              output_tokens: 2,
              total_tokens: 6,
            },
          })
        ),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const model = new OpenAICompatibleResponsesModel({
      baseUrl: 'http://provider.test/v1',
      model: 'default-model',
      timeoutMs: 1000,
      apiKey: 'test-key',
      fetchImplementation,
    });

    const completion = await model.complete({
      messages: [{ role: 'user', content: 'hi' }],
      reasoningEffort: 'xhigh',
      maxCompletionTokens: 50,
      temperature: 0,
    });

    expect(completion).toEqual({
      id: 'response-1',
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
    expect(String(url)).toBe('http://provider.test/v1/responses');
    expect(init?.headers).toEqual({
      authorization: 'Bearer test-key',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'default-model',
      input: [{ role: 'user', content: 'hi' }],
      store: false,
      reasoning: { effort: 'xhigh' },
      max_output_tokens: 50,
      temperature: 0,
    });
  });

  it('uses top-level output_text and keeps a valid response when usage is missing', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify(completedResponse({ output_text: 'top-level text' })),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const model = new OpenAICompatibleResponsesModel({
      baseUrl: 'http://provider.test/v1',
      model: 'default-model',
      timeoutMs: 1000,
      fetchImplementation,
    });

    const completion = await model.complete({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(completion).toEqual({
      id: 'response-1',
      model: 'resolved-model',
      content: 'top-level text',
      finishReason: 'stop',
      usage: null,
    });
  });

  it('drops partial or non-integer usage without inventing counts', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify(
          completedResponse({ usage: { input_tokens: 4, output_tokens: 2.5 } })
        ),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const model = new OpenAICompatibleResponsesModel({
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

  it('preserves incomplete response text and reports its reason', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify(
          completedResponse({
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
          })
        ),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const model = new OpenAICompatibleResponsesModel({
      baseUrl: 'http://provider.test/v1',
      model: 'default-model',
      timeoutMs: 1000,
      fetchImplementation,
    });

    const completion = await model.complete({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(completion).toMatchObject({
      content: 'hello',
      finishReason: 'max_output_tokens',
    });
  });

  it('preserves the provider error from a failed Responses status', async () => {
    const failedBody = completedResponse({
      status: 'failed',
      output: [],
      error: {
        code: 'model_error',
        message: 'unsupported request',
        type: 'invalid_request_error',
      },
      provider_metadata: { request_id: 'request-1' },
    });
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(failedBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const model = new OpenAICompatibleResponsesModel({
      baseUrl: 'http://provider.test/v1',
      model: 'test-model',
      timeoutMs: 1000,
      fetchImplementation,
    });

    const error = await model
      .complete({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      message: 'unsupported request',
      statusCode: 200,
    });
    expect((error as { details: unknown }).details).toEqual(failedBody);
  });

  it('preserves a provider error message and status', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ error: { message: 'rate limited', type: 'rate_limit' } }),
        { status: 429, headers: { 'content-type': 'application/json' } }
      )
    );
    const model = new OpenAICompatibleResponsesModel({
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
