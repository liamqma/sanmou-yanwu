import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { z } from 'zod';

const environmentSchema = z.object({
  SANMOU_AGENT_HOST: z.enum(['127.0.0.1', 'localhost', '::1']).default('127.0.0.1'),
  SANMOU_AGENT_PORT: z.coerce.number().int().min(1).max(65_535).default(8790),
  SANMOU_AGENT_ALLOWED_ORIGINS: z
    .string()
    .default(
      'https://sanmouyanwu.com,http://localhost:3000,http://127.0.0.1:3000,http://localhost:4173,http://127.0.0.1:4173'
    ),
  AI_BASE_URL: z.url().default('http://127.0.0.1:8787/v1'),
  AI_MODEL: z.string().min(1).default('gpt-5.6-sol'),
  SANMOU_REASONING_EFFORT: z
    .enum(['low', 'medium', 'high', 'xhigh'])
    .default('xhigh'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1).max(600_000).default(600_000),
  AI_API_KEY: z.string().min(1).optional(),
});

const browserOriginSchema = z
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
    message: 'Browser origins must use http or https',
  })
  .refine((value) => new URL(value).origin === value, {
    message: 'Browser origins must contain only scheme, host, and optional port',
  });

function parseAllowedOrigins(value: string): string[] {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return [...new Set(z.array(browserOriginSchema).min(1).parse(origins))];
}

export interface AgentConfig {
  host: string;
  port: number;
  allowedOrigins: string[];
  model: {
    baseUrl: string;
    model: string;
    timeoutMs: number;
    apiKey?: string;
  };
  reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh';
}

export function loadLocalEnvironment(path = resolve(process.cwd(), '.env')): void {
  try {
    loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export function readAgentConfig(
  environment: NodeJS.ProcessEnv = process.env
): AgentConfig {
  const parsed = environmentSchema.parse(environment);
  const apiKey = parsed.AI_API_KEY;
  return {
    host: parsed.SANMOU_AGENT_HOST,
    port: parsed.SANMOU_AGENT_PORT,
    allowedOrigins: parseAllowedOrigins(parsed.SANMOU_AGENT_ALLOWED_ORIGINS),
    model: {
      baseUrl: parsed.AI_BASE_URL.replace(/\/+$/, ''),
      model: parsed.AI_MODEL,
      timeoutMs: parsed.AI_TIMEOUT_MS,
      ...(apiKey === undefined ? {} : { apiKey }),
    },
    reasoningEffort: parsed.SANMOU_REASONING_EFFORT,
  };
}
