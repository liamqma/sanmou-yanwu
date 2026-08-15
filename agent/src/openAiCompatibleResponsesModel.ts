import { z } from 'zod';
import {
  ChatModelError,
  type ChatCompletion,
  type ChatCompletionRequest,
  type ChatModel,
  type TokenUsage,
} from './model.js';

const upstreamResponseSchema = z.object({
  id: z.string().default(''),
  model: z.string().default(''),
  status: z.string(),
  output_text: z.string().optional(),
  output: z.array(
    z.object({
      type: z.string(),
      content: z
        .array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
          })
        )
        .optional(),
    })
  ),
  incomplete_details: z
    .object({
      reason: z.string().optional(),
    })
    .nullable()
    .optional(),
  usage: z.unknown().optional(),
});

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function normalizeUsage(raw: unknown): TokenUsage | null {
  if (raw === null || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const promptTokens = record.input_tokens;
  const completionTokens = record.output_tokens;
  const totalTokens = record.total_tokens;
  if (
    isNonnegativeInteger(promptTokens) &&
    isNonnegativeInteger(completionTokens) &&
    isNonnegativeInteger(totalTokens)
  ) {
    return { promptTokens, completionTokens, totalTokens };
  }
  return null;
}

function extractOutputText(response: z.infer<typeof upstreamResponseSchema>): string | null {
  if (response.output_text !== undefined) {
    return response.output_text.length === 0 ? null : response.output_text;
  }

  const textParts = response.output.flatMap((item) =>
    item.type === 'message'
      ? (item.content ?? [])
          .filter((part) => part.type === 'output_text')
          .flatMap((part) => (part.text === undefined ? [] : [part.text]))
      : []
  );
  const content = textParts.join('');
  return content.length === 0 ? null : content;
}

function finishReason(response: z.infer<typeof upstreamResponseSchema>): string | null {
  if (response.status === 'completed') return 'stop';
  if (response.status === 'incomplete') {
    return response.incomplete_details?.reason ?? 'incomplete';
  }
  return response.status.length === 0 ? null : response.status;
}

export interface OpenAICompatibleResponsesModelOptions {
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

export class OpenAICompatibleResponsesModel implements ChatModel {
  private readonly endpoint: URL;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;
  private readonly apiKey: string | undefined;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: OpenAICompatibleResponsesModelOptions) {
    const baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`;
    this.endpoint = new URL('responses', baseUrl);
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

    const requestedModel = request.model ?? this.defaultModel;
    let response: Response;
    try {
      response = await this.fetchImplementation(this.endpoint, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          model: requestedModel,
          input: request.messages,
          store: false,
          ...(request.reasoningEffort === undefined
            ? {}
            : { reasoning: { effort: request.reasoningEffort } }),
          ...(request.maxCompletionTokens === undefined
            ? {}
            : { max_output_tokens: request.maxCompletionTokens }),
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
    if (parsed.data.status !== 'completed' && parsed.data.status !== 'incomplete') {
      throw new ChatModelError(
        `Model provider returned response status ${parsed.data.status}`,
        {
          statusCode: response.status,
          details: body,
        }
      );
    }

    const content = extractOutputText(parsed.data);
    if (content === null) {
      throw new ChatModelError('Model provider returned no text content', {
        statusCode: response.status,
        details: body,
      });
    }
    return {
      id: parsed.data.id,
      model: parsed.data.model || requestedModel,
      content,
      finishReason: finishReason(parsed.data),
      usage: normalizeUsage(parsed.data.usage),
    };
  }
}
