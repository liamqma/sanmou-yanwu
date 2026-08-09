import { z } from 'zod';
import {
  ChatModelError,
  type ChatCompletion,
  type ChatCompletionRequest,
  type ChatModel,
} from './model.js';

const upstreamResponseSchema = z.object({
  id: z.string().default(''),
  model: z.string().default(''),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable(),
        }),
        finish_reason: z.string().nullable().optional(),
      })
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
      total_tokens: z.number().int().nonnegative(),
    })
    .nullable()
    .optional(),
});

export interface OpenAICompatibleChatModelOptions {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  apiKey?: string;
  fetchImplementation?: typeof fetch;
}

function errorMessage(body: unknown, status: number): string {
  if (
    body !== null &&
    typeof body === 'object' &&
    'error' in body &&
    body.error !== null &&
    typeof body.error === 'object' &&
    'message' in body.error &&
    typeof body.error.message === 'string'
  ) {
    return body.error.message;
  }
  return `Model provider returned HTTP ${status}`;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ChatModelError('Model provider returned a non-JSON response', {
      statusCode: response.status,
      details: { cause: error instanceof Error ? error.message : String(error) },
    });
  }
}

export class OpenAICompatibleChatModel implements ChatModel {
  private readonly endpoint: URL;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;
  private readonly apiKey: string | undefined;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: OpenAICompatibleChatModelOptions) {
    const baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`;
    this.endpoint = new URL('chat/completions', baseUrl);
    this.defaultModel = options.model;
    this.timeoutMs = options.timeoutMs;
    this.apiKey = options.apiKey;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletion> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (this.apiKey !== undefined) headers.authorization = `Bearer ${this.apiKey}`;

    let response: Response;
    try {
      response = await this.fetchImplementation(this.endpoint, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          model: request.model ?? this.defaultModel,
          messages: request.messages,
          ...(request.maxCompletionTokens === undefined
            ? {}
            : { max_completion_tokens: request.maxCompletionTokens }),
          ...(request.temperature === undefined
            ? {}
            : { temperature: request.temperature }),
        }),
      });
    } catch (error) {
      throw new ChatModelError(
        error instanceof DOMException && error.name === 'TimeoutError'
          ? `Model provider timed out after ${this.timeoutMs}ms`
          : `Could not reach model provider: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const body = await parseJsonResponse(response);
    if (!response.ok) {
      throw new ChatModelError(errorMessage(body, response.status), {
        statusCode: response.status,
        details: body,
      });
    }

    const parsed = upstreamResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ChatModelError('Model provider returned an unexpected response shape', {
        statusCode: response.status,
        details: parsed.error.issues,
      });
    }
    const choice = parsed.data.choices[0];
    if (choice === undefined) {
      throw new ChatModelError('Model provider returned no completion choices', {
        statusCode: response.status,
      });
    }
    const content = choice.message.content;
    if (content === null) {
      throw new ChatModelError('Model provider returned no text content', {
        statusCode: response.status,
      });
    }
    const usage = parsed.data.usage;
    return {
      id: parsed.data.id,
      model: parsed.data.model,
      content,
      finishReason: choice.finish_reason ?? null,
      usage:
        usage === undefined || usage === null
          ? null
          : {
              promptTokens: usage.prompt_tokens,
              completionTokens: usage.completion_tokens,
              totalTokens: usage.total_tokens,
            },
    };
  }
}
