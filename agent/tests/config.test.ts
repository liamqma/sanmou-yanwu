import { describe, expect, it } from 'vitest';
import { readAgentConfig } from '../src/config.js';

describe('readAgentConfig', () => {
  it('uses local-only defaults', () => {
    const config = readAgentConfig({});

    expect(config).toEqual({
      host: '127.0.0.1',
      port: 8790,
      model: {
        baseUrl: 'http://127.0.0.1:8787/v1',
        model: 'gpt-5.6-sol',
        timeoutMs: 60_000,
      },
    });
  });

  it('normalizes configuration values', () => {
    const config = readAgentConfig({
      SANMOU_AGENT_HOST: 'localhost',
      SANMOU_AGENT_PORT: '9000',
      AI_BASE_URL: 'http://localhost:9001/v1/',
      AI_MODEL: 'test-model',
      AI_TIMEOUT_MS: '1234',
      AI_API_KEY: 'secret',
    });

    expect(config).toEqual({
      host: 'localhost',
      port: 9000,
      model: {
        baseUrl: 'http://localhost:9001/v1',
        model: 'test-model',
        timeoutMs: 1234,
        apiKey: 'secret',
      },
    });
  });
});
