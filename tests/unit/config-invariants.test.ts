import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';

import { loadConfig, type OdysseusConfig, type RawEnv } from '../../src/config.js';

// ---------------------------------------------------------------------------
// Source contract — config.ts
//
// loadConfig reads env vars and produces a validated OdysseusConfig.
//
// Invariants pinned here:
//   - ODYSSEUS_LLM_API_KEY is required and trimmed (throws on missing/blank)
//   - model defaults to 'glm-5.2' when env unset or empty
//   - baseUrl defaults to the GLM production endpoint
//   - debug parses booleans: 'true' | '1' (case-insensitive for 'true'),
//     anything else falls back to the provided default
//   - parseBool is the only helper and is NOT exported
//   - default parameter for env is process.env — keeps tests clean
//
// SECURITY: never reads/writes .env file directly. Tests must not touch the
// real .env; all tests pass an explicit RawEnv.
// ---------------------------------------------------------------------------

describe('config — module exports', () => {
  test('exports OdysseusConfig interface', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).toMatch(/^export\s+interface\s+OdysseusConfig/m);
  });

  test('exports RawEnv interface', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).toMatch(/^export\s+interface\s+RawEnv/m);
  });

  test('exports loadConfig function', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).toMatch(/^export\s+function\s+loadConfig/m);
  });

  test('exactly 3 exports', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    const exports = src.match(/^export\s+(interface|type|function|const|class|enum)\s+\w+/gm) ?? [];
    expect(exports.length).toBe(3);
  });

  test('parseBool is NOT exported (internal helper)', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    // Function exists in source
    expect(src).toMatch(/^function\s+parseBool/m);
    // But is not in an export statement
    expect(src).not.toMatch(/^export\s+.*parseBool/m);
  });

  test('no default export', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).not.toMatch(/^export\s+default\s/m);
  });

  test('no imports (self-contained)', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).not.toMatch(/^import\s/m);
  });
});

// ---------------------------------------------------------------------------
// OdysseusConfig — shape (4 required fields)
// ---------------------------------------------------------------------------

describe('OdysseusConfig — shape', () => {
  test('apiKey: string', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).toMatch(/apiKey:\s*string/);
  });

  test('model: string', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).toMatch(/model:\s*string/);
  });

  test('baseUrl: string', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).toMatch(/baseUrl:\s*string/);
  });

  test('debug: boolean', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).toMatch(/debug:\s*boolean/);
  });

  test('exactly 4 required fields (no optional)', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    const match = src.match(/interface\s+OdysseusConfig\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    const optional = match![1].match(/^\s+\w+\?\s*:/gm) ?? [];
    const required = match![1].match(/^\s+\w+:\s+/gm) ?? [];
    expect(optional.length).toBe(0);
    expect(required.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// RawEnv — shape (4 optional env vars)
// ---------------------------------------------------------------------------

describe('RawEnv — shape', () => {
  test('ODYSSEUS_LLM_API_KEY?: string', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).toMatch(/ODYSSEUS_LLM_API_KEY\?\s*:\s*string/);
  });

  test('ODYSSEUS_LLM_MODEL?: string', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).toMatch(/ODYSSEUS_LLM_MODEL\?\s*:\s*string/);
  });

  test('ODYSSEUS_LLM_BASE_URL?: string', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).toMatch(/ODYSSEUS_LLM_BASE_URL\?\s*:\s*string/);
  });

  test('ODYSSEUS_DEBUG?: string', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).toMatch(/ODYSSEUS_DEBUG\?\s*:\s*string/);
  });

  test('exactly 4 fields, all optional', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    const match = src.match(/interface\s+RawEnv\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    const optional = match![1].match(/^\s+\w+\?\s*:/gm) ?? [];
    const required = match![1].match(/^\s+\w+:\s+/gm) ?? [];
    expect(optional.length).toBe(4);
    expect(required.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// loadConfig — required API key
// ---------------------------------------------------------------------------

describe('loadConfig — required API key', () => {
  test('throws when apiKey is missing', () => {
    expect(() => loadConfig({})).toThrow(/ODYSSEUS_LLM_API_KEY is required/);
  });

  test('throws when apiKey is undefined', () => {
    expect(() => loadConfig({ ODYSSEUS_LLM_API_KEY: undefined })).toThrow();
  });

  test('throws when apiKey is empty string', () => {
    expect(() => loadConfig({ ODYSSEUS_LLM_API_KEY: '' })).toThrow();
  });

  test('throws when apiKey is only whitespace (trimmed to empty)', () => {
    expect(() => loadConfig({ ODYSSEUS_LLM_API_KEY: '   \n\t ' })).toThrow();
  });

  test('does NOT throw when apiKey is a valid string', () => {
    expect(() => loadConfig({ ODYSSEUS_LLM_API_KEY: 'sk-test' })).not.toThrow();
  });

  test('error message mentions .env.example', () => {
    try {
      loadConfig({});
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as Error).message).toMatch(/\.env\.example/);
    }
  });

  test('error message mentions GLM-5.2', () => {
    try {
      loadConfig({});
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as Error).message).toMatch(/GLM-5\.2/);
    }
  });
});

// ---------------------------------------------------------------------------
// loadConfig — trimming
// ---------------------------------------------------------------------------

describe('loadConfig — trimming', () => {
  test('apiKey is trimmed', () => {
    const cfg = loadConfig({ ODYSSEUS_LLM_API_KEY: '  sk-test  \n' });
    expect(cfg.apiKey).toBe('sk-test');
  });

  test('model is trimmed when set', () => {
    const cfg = loadConfig({
      ODYSSEUS_LLM_API_KEY: 'k',
      ODYSSEUS_LLM_MODEL: '  custom-model  ',
    });
    expect(cfg.model).toBe('custom-model');
  });

  test('baseUrl is trimmed when set', () => {
    const cfg = loadConfig({
      ODYSSEUS_LLM_API_KEY: 'k',
      ODYSSEUS_LLM_BASE_URL: '  https://example.com  ',
    });
    expect(cfg.baseUrl).toBe('https://example.com');
  });

  test('empty-string model falls back to default (not empty)', () => {
    const cfg = loadConfig({
      ODYSSEUS_LLM_API_KEY: 'k',
      ODYSSEUS_LLM_MODEL: '',
    });
    expect(cfg.model).toBe('glm-5.2');
  });

  test('whitespace-only model falls back to default', () => {
    const cfg = loadConfig({
      ODYSSEUS_LLM_API_KEY: 'k',
      ODYSSEUS_LLM_MODEL: '   ',
    });
    expect(cfg.model).toBe('glm-5.2');
  });

  test('empty-string baseUrl falls back to default', () => {
    const cfg = loadConfig({
      ODYSSEUS_LLM_API_KEY: 'k',
      ODYSSEUS_LLM_BASE_URL: '',
    });
    expect(cfg.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4');
  });
});

// ---------------------------------------------------------------------------
// loadConfig — defaults
// ---------------------------------------------------------------------------

describe('loadConfig — defaults', () => {
  test('model defaults to "glm-5.2"', () => {
    const cfg = loadConfig({ ODYSSEUS_LLM_API_KEY: 'k' });
    expect(cfg.model).toBe('glm-5.2');
  });

  test('baseUrl defaults to GLM production endpoint', () => {
    const cfg = loadConfig({ ODYSSEUS_LLM_API_KEY: 'k' });
    expect(cfg.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4');
  });

  test('debug defaults to false when env unset', () => {
    const cfg = loadConfig({ ODYSSEUS_LLM_API_KEY: 'k' });
    expect(cfg.debug).toBe(false);
  });

  test('debug defaults to false when env is undefined', () => {
    const cfg = loadConfig({
      ODYSSEUS_LLM_API_KEY: 'k',
      ODYSSEUS_DEBUG: undefined,
    });
    expect(cfg.debug).toBe(false);
  });

  test('source defaults match expected values', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).toMatch(/model:\s*env\.ODYSSEUS_LLM_MODEL\?\.trim\(\)\s*\|\|\s*'glm-5\.2'/);
    expect(src).toMatch(/baseUrl:\s*env\.ODYSSEUS_LLM_BASE_URL\?\.trim\(\)\s*\|\|\s*'https:\/\/open\.bigmodel\.cn\/api\/paas\/v4'/);
    expect(src).toMatch(/debug:\s*parseBool\(env\.ODYSSEUS_DEBUG,\s*false\)/);
  });
});

// ---------------------------------------------------------------------------
// parseBool — via loadConfig (not directly exported)
// ---------------------------------------------------------------------------

describe('loadConfig — debug parsing (parseBool behavior)', () => {
  test('"true" (lowercase) → true', () => {
    const cfg = loadConfig({ ODYSSEUS_LLM_API_KEY: 'k', ODYSSEUS_DEBUG: 'true' });
    expect(cfg.debug).toBe(true);
  });

  test('"TRUE" (uppercase) → true (case-insensitive)', () => {
    const cfg = loadConfig({ ODYSSEUS_LLM_API_KEY: 'k', ODYSSEUS_DEBUG: 'TRUE' });
    expect(cfg.debug).toBe(true);
  });

  test('"True" (mixed case) → true', () => {
    const cfg = loadConfig({ ODYSSEUS_LLM_API_KEY: 'k', ODYSSEUS_DEBUG: 'True' });
    expect(cfg.debug).toBe(true);
  });

  test('"1" → true', () => {
    const cfg = loadConfig({ ODYSSEUS_LLM_API_KEY: 'k', ODYSSEUS_DEBUG: '1' });
    expect(cfg.debug).toBe(true);
  });

  test('"false" → false', () => {
    const cfg = loadConfig({ ODYSSEUS_LLM_API_KEY: 'k', ODYSSEUS_DEBUG: 'false' });
    expect(cfg.debug).toBe(false);
  });

  test('"0" → false', () => {
    const cfg = loadConfig({ ODYSSEUS_LLM_API_KEY: 'k', ODYSSEUS_DEBUG: '0' });
    expect(cfg.debug).toBe(false);
  });

  test('"yes" → false (not a recognized truthy value)', () => {
    const cfg = loadConfig({ ODYSSEUS_LLM_API_KEY: 'k', ODYSSEUS_DEBUG: 'yes' });
    expect(cfg.debug).toBe(false);
  });

  test('empty string → false', () => {
    const cfg = loadConfig({ ODYSSEUS_LLM_API_KEY: 'k', ODYSSEUS_DEBUG: '' });
    expect(cfg.debug).toBe(false);
  });

  test('random string → false', () => {
    const cfg = loadConfig({ ODYSSEUS_LLM_API_KEY: 'k', ODYSSEUS_DEBUG: 'garbage' });
    expect(cfg.debug).toBe(false);
  });

  test('whitespace " true " → false (no trim on DEBUG)', () => {
    // Source uses value.toLowerCase() === 'true' — no trim
    const cfg = loadConfig({ ODYSSEUS_LLM_API_KEY: 'k', ODYSSEUS_DEBUG: ' true ' });
    expect(cfg.debug).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Default parameter — process.env
// ---------------------------------------------------------------------------

describe('loadConfig — default env parameter', () => {
  test('source declares default = process.env', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).toMatch(/function\s+loadConfig\s*\(\s*env:\s*RawEnv\s*=\s*process\.env\s*\)/s);
  });

  test('calling loadConfig() with no args uses process.env', () => {
    // We can't assert specific values without knowing process.env state,
    // but we can verify it doesn't throw a TypeError.
    try {
      loadConfig();
    } catch (e) {
      // Either it succeeds (process.env has API key) or throws the expected
      // missing-API-key error. Either way, no TypeError.
      expect(e).not.toBeInstanceOf(TypeError);
    }
  });
});

// ---------------------------------------------------------------------------
// Purity / determinism
// ---------------------------------------------------------------------------

describe('loadConfig — determinism', () => {
  test('same env produces same config', () => {
    const env: RawEnv = {
      ODYSSEUS_LLM_API_KEY: 'k',
      ODYSSEUS_LLM_MODEL: 'm',
      ODYSSEUS_LLM_BASE_URL: 'u',
      ODYSSEUS_DEBUG: 'true',
    };
    expect(loadConfig(env)).toEqual(loadConfig(env));
  });

  test('does not mutate the env parameter', () => {
    const env: RawEnv = { ODYSSEUS_LLM_API_KEY: 'k' };
    const snapshot = { ...env };
    loadConfig(env);
    expect(env).toEqual(snapshot);
  });

  test('two calls with same env return distinct objects (not same ref)', () => {
    const env: RawEnv = { ODYSSEUS_LLM_API_KEY: 'k' };
    const a = loadConfig(env);
    const b = loadConfig(env);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Source-level safety
// ---------------------------------------------------------------------------

describe('config — source-level safety', () => {
  test('no console, no stdout, no stderr', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).not.toMatch(/console\./);
    expect(src).not.toMatch(/process\.stdout/);
    expect(src).not.toMatch(/process\.stderr/);
  });

  test('no process.exit, no process.argv', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).not.toMatch(/process\.exit/);
    expect(src).not.toMatch(/process\.argv/);
  });

  test('no file reads — no fs import, no readFile', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).not.toMatch(/^import.*fs/m);
    expect(src).not.toMatch(/readFile/);
    expect(src).not.toMatch(/readFileSync/);
  });

  test('no network — no fetch, no http', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/^import.*http/m);
  });

  test('no shell — no exec, no spawn', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).not.toMatch(/child_process/);
    expect(src).not.toMatch(/\bexec\b/);
    expect(src).not.toMatch(/\bspawn\b/);
  });
});

// ---------------------------------------------------------------------------
// Structural fingerprint
// ---------------------------------------------------------------------------

describe('config — structural fingerprint', () => {
  test('file has exactly 2 interface declarations', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    const ifaces = src.match(/^export\s+interface\s+\w+/gm) ?? [];
    expect(ifaces.length).toBe(2);
  });

  test('file has exactly 1 exported function (loadConfig)', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    const fns = src.match(/^export\s+function\s+\w+/gm) ?? [];
    expect(fns.length).toBe(1);
  });

  test('file has exactly 1 internal (non-exported) function (parseBool)', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    const internalFns = src.match(/^function\s+\w+/gm) ?? [];
    expect(internalFns.length).toBe(1);
    expect(internalFns[0]).toMatch(/\bparseBool\b/);
  });

  test('file is under 50 lines (compact config loader)', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    const lines = src.split('\n');
    expect(lines.length).toBeLessThanOrEqual(50);
  });

  test('parseBool signature matches (value: string | undefined, fallback: boolean)', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).toMatch(/function\s+parseBool\s*\(\s*value:\s*string\s*\|\s*undefined,\s*fallback:\s*boolean\s*\)/);
  });

  test('parseBool returns fallback when value is undefined', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).toMatch(/if\s*\(\s*value\s*===\s*undefined\s*\)\s*return\s*fallback/);
  });

  test('parseBool truthy check is "true" OR "1"', async () => {
    const src = await readFile('src/config.ts', 'utf8');
    expect(src).toMatch(/value\.toLowerCase\(\)\s*===\s*'true'\s*\|\|\s*value\s*===\s*'1'/);
  });
});
