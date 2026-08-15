import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import { agentChatRequestSchema } from './httpSchemas.js';
import {
  ChatModelError,
  type ChatModel,
  type ReasoningEffort,
} from './model.js';
import type { GameKnowledge } from './team/gameData.js';
import { runTeamRecommendation } from './team/teamRecommendationGraph.js';
import { teamRecommendationInputSchema } from './team/teamRecommendationSchemas.js';
import type { TeamReviewAttemptDiagnostic } from './team/teamReviewSubgraph.js';

const MAX_BODY_BYTES = 256 * 1024;
const BROWSER_ENDPOINTS = new Set([
  '/health/live',
  '/health/ready',
  '/v1/team-recommendations',
]);

export interface AgentHttpServerOptions {
  model: ChatModel;
  modelName: string;
  knowledge: GameKnowledge;
  reasoningEffort?: ReasoningEffort;
  allowedOrigins: readonly string[];
  onReviewAttempt?: (diagnostic: TeamReviewAttemptDiagnostic) => void;
}

class RequestBodyError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function writeError(
  response: ServerResponse,
  statusCode: number,
  message: string,
  type: string,
  details?: unknown
): void {
  writeJson(response, statusCode, {
    error: {
      message,
      type,
      ...(details === undefined ? {} : { details }),
    },
  });
}

function prepareBrowserRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  allowedOrigins: ReadonlySet<string>
): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  if (!BROWSER_ENDPOINTS.has(pathname) || !allowedOrigins.has(origin)) {
    writeError(response, 403, 'Browser origin is not allowed', 'forbidden_origin');
    return false;
  }

  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('vary', 'Origin');
  if (request.method !== 'OPTIONS') return true;

  response.writeHead(204, {
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Content-Type',
    'access-control-max-age': '600',
  });
  response.end();
  return false;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new RequestBodyError(415, 'Content-Type must be application/json');
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) {
      throw new RequestBodyError(413, 'Request body is too large');
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new RequestBodyError(400, 'Request body must contain valid JSON');
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: AgentHttpServerOptions,
  allowedOrigins: ReadonlySet<string>
): Promise<void> {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (!prepareBrowserRequest(request, response, pathname, allowedOrigins)) return;

  if (request.method === 'GET' && pathname === '/health/live') {
    writeJson(response, 200, { status: 'ok' });
    return;
  }
  if (request.method === 'GET' && pathname === '/health/ready') {
    writeJson(response, 200, { status: 'ready', model: options.modelName });
    return;
  }
  if (
    request.method !== 'POST' ||
    (pathname !== '/v1/chat' && pathname !== '/v1/team-recommendations')
  ) {
    writeError(response, 404, 'Route not found', 'not_found');
    return;
  }

  try {
    const body = await readJson(request);
    if (pathname === '/v1/team-recommendations') {
      const parsed = teamRecommendationInputSchema.parse(body);
      const result = await runTeamRecommendation(parsed, {
        model: options.model,
        knowledge: options.knowledge,
        ...(options.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: options.reasoningEffort }),
        ...(options.onReviewAttempt === undefined
          ? {}
          : { review: { onAttempt: options.onReviewAttempt } }),
      });
      writeJson(response, 200, result);
      return;
    }

    const parsed = agentChatRequestSchema.parse(body);
    const reasoningEffort = parsed.reasoningEffort ?? options.reasoningEffort;
    const completion = await options.model.complete({
      messages: parsed.messages,
      ...(parsed.model === undefined ? {} : { model: parsed.model }),
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      ...(parsed.maxCompletionTokens === undefined
        ? {}
        : { maxCompletionTokens: parsed.maxCompletionTokens }),
      ...(parsed.temperature === undefined ? {} : { temperature: parsed.temperature }),
    });
    writeJson(response, 200, completion);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      writeError(response, error.statusCode, error.message, 'invalid_request');
      return;
    }
    if (error instanceof ZodError) {
      const contract =
        pathname === '/v1/team-recommendations'
          ? 'team recommendation'
          : 'chat';
      writeError(
        response,
        422,
        `Request body does not match the ${contract} contract`,
        'validation_error',
        error.issues
      );
      return;
    }
    if (error instanceof ChatModelError) {
      writeError(response, 502, error.message, 'model_provider_error', {
        upstreamStatus: error.statusCode,
      });
      return;
    }
    writeError(response, 500, 'Unexpected agent server error', 'internal_error');
  }
}

export function createAgentHttpServer(options: AgentHttpServerOptions): Server {
  const allowedOrigins = new Set(options.allowedOrigins);
  return createServer((request, response) => {
    void handleRequest(request, response, options, allowedOrigins);
  });
}
