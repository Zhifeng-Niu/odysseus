import { describe, test, expect } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  test('reads required env vars with correct defaults', () => {
    const config = loadConfig({
      ODYSSEUS_LLM_API_KEY: 'fake-key',
    });
    expect(config.apiKey).toBe('fake-key');
    expect(config.model).toBe('glm-5.2');
    expect(config.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4');
    expect(config.debug).toBe(false);
  });

  test('throws when API key is missing', () => {
    expect(() => loadConfig({})).toThrow(/API_KEY/i);
  });

  test('honors explicit overrides', () => {
    const config = loadConfig({
      ODYSSEUS_LLM_API_KEY: 'k',
      ODYSSEUS_LLM_MODEL: 'glm-4-plus',
      ODYSSEUS_LLM_BASE_URL: 'https://other.example.com/v1',
      ODYSSEUS_DEBUG: 'true',
    });
    expect(config.model).toBe('glm-4-plus');
    expect(config.baseUrl).toBe('https://other.example.com/v1');
    expect(config.debug).toBe(true);
  });
});
