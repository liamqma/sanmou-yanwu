import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import { agentChatRequestSchema } from './httpSchemas.js';
import { ChatModelError, type ChatModel } from './model.js';

const MAX_BODY_BYTES = 256 * 1024;

export interface AgentHttpServerOptions {
  model: ChatModel;
  modelName: string;
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
  options: AgentHttpServerOptions
): Promise<void> {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

  if (request.method === 'GET' && pathname === '/health/live') {
    writeJson(response, 200, { status: 'ok' });
    return;
  }
  if (request.method === 'GET' && pathname === '/health/ready') {
    writeJson(response, 200, { status: 'ready', model: options.modelName });
    return;
  }
  if (request.method !== 'POST' || pathname !== '/v1/chat') {
    writeError(response, 404, 'Route not found', 'not_found');
    return;
  }

  try {
    const body = await readJson(request);
    const parsed = agentChatRequestSchema.parse(body);
    const completion = await options.model.complete({
      messages: parsed.messages,
      ...(parsed.model === undefined ? {} : { model: parsed.model }),
      ...(parsed.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: parsed.reasoningEffort }),
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
      writeError(response, 422, 'Request body does not match the chat contract', 'validation_error', error.issues);
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
  return createServer((request, response) => {
    void handleRequest(request, response, options);
  });
}
