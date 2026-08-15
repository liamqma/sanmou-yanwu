import { describe, expect, it } from 'vitest';
import { readAgentConfig } from '../src/config.js';

describe('readAgentConfig', () => {
  it('uses local-only defaults', () => {
    const config = readAgentConfig({});

    expect(config).toEqual({
      host: '127.0.0.1',
      port: 8790,
      allowedOrigins: [
        'https://sanmouyanwu.com',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:4173',
        'http://127.0.0.1:4173',
      ],
      reasoningEffort: 'xhigh',
      model: {
        baseUrl: 'http://127.0.0.1:8787/v1',
        model: 'gpt-5.6-sol',
        timeoutMs: 270_000,
      },
    });
  });

  it('normalizes configuration values', () => {
    const config = readAgentConfig({
      SANMOU_AGENT_HOST: 'localhost',
      SANMOU_AGENT_PORT: '9000',
      SANMOU_AGENT_ALLOWED_ORIGINS:
        ' https://example.com, http://localhost:3000,https://example.com ',
      AI_BASE_URL: 'http://localhost:9001/v1/',
      AI_MODEL: 'test-model',
      SANMOU_REASONING_EFFORT: 'low',
      AI_TIMEOUT_MS: '1234',
      AI_API_KEY: 'secret',
    });

    expect(config).toEqual({
      host: 'localhost',
      port: 9000,
      allowedOrigins: ['https://example.com', 'http://localhost:3000'],
      reasoningEffort: 'low',
      model: {
        baseUrl: 'http://localhost:9001/v1',
        model: 'test-model',
        timeoutMs: 1234,
        apiKey: 'secret',
      },
    });
  });

  it('rejects non-loopback binds and origins containing paths', () => {
    expect(() => readAgentConfig({ SANMOU_AGENT_HOST: '0.0.0.0' })).toThrow();
    expect(() =>
      readAgentConfig({
        SANMOU_AGENT_ALLOWED_ORIGINS: 'https://sanmouyanwu.com/team-builder',
      })
    ).toThrow('Browser origins must contain only scheme, host, and optional port');
    expect(() =>
      readAgentConfig({ SANMOU_AGENT_ALLOWED_ORIGINS: 'ftp://localhost' })
    ).toThrow('Browser origins must use http or https');
  });
});
