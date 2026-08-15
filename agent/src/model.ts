export type ChatRole = 'developer' | 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  model?: string;
  reasoningEffort?: ReasoningEffort;
  maxCompletionTokens?: number;
  temperature?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatCompletion {
  id: string;
  model: string;
  content: string;
  finishReason: string | null;
  usage: TokenUsage | null;
}

export interface ChatModel {
  complete(request: ChatCompletionRequest): Promise<ChatCompletion>;
}

export class ChatModelError extends Error {
  readonly statusCode: number | null;
  readonly details: unknown;

  constructor(message: string, options: { statusCode?: number; details?: unknown } = {}) {
    super(message);
    this.name = 'ChatModelError';
    this.statusCode = options.statusCode ?? null;
    this.details = options.details;
  }
}
