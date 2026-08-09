import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { z } from 'zod';

const environmentSchema = z.object({
  SANMOU_AGENT_HOST: z.string().min(1).default('127.0.0.1'),
  SANMOU_AGENT_PORT: z.coerce.number().int().min(1).max(65_535).default(8790),
  AI_BASE_URL: z.url().default('http://127.0.0.1:8787/v1'),
  AI_MODEL: z.string().min(1).default('gpt-5.6-sol'),
  SANMOU_REASONING_EFFORT: z.enum(['low', 'medium', 'high']).default('high'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1).max(300_000).default(60_000),
  AI_API_KEY: z.string().min(1).optional(),
});

export interface AgentConfig {
  host: string;
  port: number;
  model: {
    baseUrl: string;
    model: string;
    timeoutMs: number;
    apiKey?: string;
  };
  reasoningEffort: 'low' | 'medium' | 'high';
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
    model: {
      baseUrl: parsed.AI_BASE_URL.replace(/\/+$/, ''),
      model: parsed.AI_MODEL,
      timeoutMs: parsed.AI_TIMEOUT_MS,
      ...(apiKey === undefined ? {} : { apiKey }),
    },
    reasoningEffort: parsed.SANMOU_REASONING_EFFORT,
  };
}
