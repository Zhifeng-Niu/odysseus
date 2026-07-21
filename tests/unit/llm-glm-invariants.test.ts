import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';

import { GLMProvider, LLMError, type GLMConfig } from '../../src/llm/glm.js';
import type { LLMProvider as ILLMProvider } from '../../src/llm/provider.js';

// ---------------------------------------------------------------------------
// Source contract — llm/glm.ts
//
// GLMProvider is the production LLM provider: OpenAI-compatible wire protocol
// to GLM-5.2. All network access goes through fetch() with an AbortController
// timeout. withRetry wraps the complete() path.
//
// Invariants pinned here:
//   - GLMConfig: 3 required + 3 optional fields, with documented defaults
//   - LLMError extends Error and exposes status + responseBody
//   - GLMProvider implements LLMProvider (3 methods)
//   - constructor merges defaults WITHOUT overriding caller's values
//   - complete() retries 3 times with 500ms base delay
//   - shouldRetry: 5xx OR 429 (rate limit)
//   - stream() is an async generator
//   - Wire format conversion: camelCase → snake_case (tool_calls, tool_call_id)
//   - Empty prompt skips the user message (no empty user turn)
//   - AbortController enforces requestTimeoutMs
//
// All tests run WITHOUT a network connection. Behavior tests use the
// constructor and getModel() (no I/O). Wire-format and retry policy are
// pinned at the source level via regex.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

describe('llm/glm — module exports', () => {
  test('exports GLMConfig interface', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/^export\s+interface\s+GLMConfig/m);
  });

  test('exports LLMError class', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/^export\s+class\s+LLMError\s+extends\s+Error/m);
  });

  test('exports GLMProvider class', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/^export\s+class\s+GLMProvider\s+implements\s+LLMProvider/m);
  });

  test('exactly 3 exports', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    const exports = src.match(/^export\s+(interface|class|function|const|type)\s+\w+/gm) ?? [];
    expect(exports.length).toBe(3);
  });

  test('no default export', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).not.toMatch(/^export\s+default\s/m);
  });
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

describe('llm/glm — imports', () => {
  test('imports LLMProvider, LLMCompletion, LLMCompleteOptions, ChatMessage, ToolCall as types', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/^import\s+type\s+\{[\s\S]*?LLMProvider,[\s\S]*?LLMCompletion,[\s\S]*?LLMCompleteOptions,[\s\S]*?ChatMessage,[\s\S]*?ToolCall,[\s\S]*?\}\s+from\s+'\.\/provider\.js'/m);
  });

  test('imports withRetry as a value from ./retry.js', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/^import\s+\{\s*withRetry\s*\}\s+from\s+'\.\/retry\.js'/m);
    // And NOT type-only
    expect(src).not.toMatch(/^import\s+type\s+\{\s*withRetry\s*\}/m);
  });

  test('exactly 2 import statements', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    const imports = src.match(/^import\s/mg) ?? [];
    expect(imports.length).toBe(2);
  });

  test('imports use .js ESM extension', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/from\s+'\.\/provider\.js'/);
    expect(src).toMatch(/from\s+'\.\/retry\.js'/);
  });
});

// ---------------------------------------------------------------------------
// GLMConfig — shape
// ---------------------------------------------------------------------------

describe('GLMConfig — shape', () => {
  test('apiKey: string (required)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/apiKey:\s*string/);
  });

  test('model: string (required)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/model:\s*string/);
  });

  test('baseUrl: string (required)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/baseUrl:\s*string/);
  });

  test('maxTokensDefault?: number (optional)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/maxTokensDefault\?\s*:\s*number/);
  });

  test('temperatureDefault?: number (optional)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/temperatureDefault\?\s*:\s*number/);
  });

  test('requestTimeoutMs?: number (optional)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/requestTimeoutMs\?\s*:\s*number/);
  });

  test('exactly 3 required + 3 optional = 6 fields', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    const match = src.match(/interface\s+GLMConfig\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    const required = match![1].match(/^\s+\w+:\s+/gm) ?? [];
    const optional = match![1].match(/^\s+\w+\?\s*:/gm) ?? [];
    expect(required.length).toBe(3);
    expect(optional.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// LLMError — contract
// ---------------------------------------------------------------------------

describe('LLMError — contract', () => {
  test('extends Error', () => {
    expect(LLMError.prototype instanceof Error).toBe(true);
  });

  test('constructor takes (message, status, responseBody)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/constructor\s*\(\s*message:\s*string,\s*readonly\s+status:\s*number,\s*readonly\s+responseBody:\s*string\s*\)/s);
  });

  test('sets name to "LLMError"', () => {
    const err = new LLMError('test', 500, 'body');
    expect(err.name).toBe('LLMError');
  });

  test('exposes status and responseBody as readonly fields', () => {
    const err = new LLMError('test', 429, 'rate limited');
    expect(err.status).toBe(429);
    expect(err.responseBody).toBe('rate limited');
  });

  test('is instanceof Error and instanceof LLMError', () => {
    const err = new LLMError('test', 500, '');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LLMError);
  });

  test('message is preserved', () => {
    const err = new LLMError('GLM API 500', 500, 'body');
    expect(err.message).toBe('GLM API 500');
  });

  test('status and responseBody are own properties', () => {
    const err = new LLMError('x', 500, 'b');
    expect(Object.prototype.hasOwnProperty.call(err, 'status')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(err, 'responseBody')).toBe(true);
  });

  test('stack trace is populated', () => {
    const err = new LLMError('x', 500, '');
    expect(typeof err.stack).toBe('string');
    expect(err.stack).toContain('LLMError');
  });

  test('can be thrown and caught via instanceof', () => {
    try {
      throw new LLMError('test', 429, 'rate');
    } catch (e) {
      expect(e).toBeInstanceOf(LLMError);
      if (e instanceof LLMError) {
        expect(e.status).toBe(429);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// GLMProvider — constructor + config defaults
// ---------------------------------------------------------------------------

describe('GLMProvider — constructor', () => {
  const minConfig: GLMConfig = {
    apiKey: 'sk-test',
    model: 'glm-5.2',
    baseUrl: 'https://example.com',
  };

  test('constructs with minimal config', () => {
    expect(() => new GLMProvider(minConfig)).not.toThrow();
  });

  test('implements LLMProvider interface', () => {
    const provider = new GLMProvider(minConfig);
    // Type-level check: assignment to LLMProvider-typed const must compile
    const _: ILLMProvider = provider;
    expect(_).toBe(provider);
  });

  test('getModel() returns the configured model', () => {
    const provider = new GLMProvider({ ...minConfig, model: 'custom-model' });
    expect(provider.getModel()).toBe('custom-model');
  });

  test('config is stored as Required<GLMConfig> (all fields filled)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/private\s+readonly\s+config:\s*Required<GLMConfig>/);
  });

  test('source merges defaults BEFORE caller config (caller wins)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    // Spread order: defaults first, then ...config last → caller values win
    expect(src).toMatch(/\{\s*maxTokensDefault:[\s\S]*?temperatureDefault:[\s\S]*?requestTimeoutMs:[\s\S]*?\.\.\.config,?\s*\}/s);
  });

  test('default maxTokensDefault is 4096', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/maxTokensDefault:\s*4096/);
  });

  test('default temperatureDefault is 0.7', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/temperatureDefault:\s*0\.7/);
  });

  test('default requestTimeoutMs is 60_000 (60 seconds)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/requestTimeoutMs:\s*60_?000/);
  });

  test('constructor does NOT make network calls', () => {
    // Sanity: construction is pure config merging
    const provider = new GLMProvider(minConfig);
    expect(provider).toBeInstanceOf(GLMProvider);
  });
});

// ---------------------------------------------------------------------------
// GLMProvider — public API surface
// ---------------------------------------------------------------------------

describe('GLMProvider — public API', () => {
  test('exposes exactly 3 public methods (complete, stream, getModel)', () => {
    const methods = Object.getOwnPropertyNames(GLMProvider.prototype).filter(
      (n) => n !== 'constructor',
    );
    expect(methods.sort()).toEqual(['complete', 'getModel', 'stream']);
  });

  test('getModel is sync and returns string', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/getModel\(\):\s*string\s*\{/);
  });

  test('complete is async and returns Promise<LLMCompletion>', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/async\s+complete\s*\(\s*prompt:\s*string,\s*options\?:\s*LLMCompleteOptions\s*\):\s*Promise<LLMCompletion>/);
  });

  test('stream is an async generator (AsyncIterable<string>)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/async\s+\*stream\s*\(\s*prompt:\s*string,\s*options\?:\s*LLMCompleteOptions\s*\):\s*AsyncIterable<string>/);
  });
});

// ---------------------------------------------------------------------------
// complete() — retry policy
// ---------------------------------------------------------------------------

describe('GLMProvider.complete — retry policy', () => {
  test('uses withRetry with maxAttempts: 3', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/withRetry\([\s\S]*?maxAttempts:\s*3,/s);
  });

  test('uses baseDelayMs: 500', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/withRetry\([\s\S]*?baseDelayMs:\s*500,/s);
  });

  test('shouldRetry retries on 5xx (status >= 500)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/err\.status\s*>=\s*500/);
  });

  test('shouldRetry retries on 429 (rate limit)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/err\.status\s*===\s*429/);
  });

  test('shouldRetry returns true for non-LLMError (default retry)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/if\s*\(\s*err\s+instanceof\s+LLMError\s*\)[\s\S]*?return\s+true/s);
  });

  test('shouldRetry is conditional on LLMError instance', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/shouldRetry:\s*\(\s*err\s*\)\s*=>\s*\{[\s\S]*?if\s*\(\s*err\s+instanceof\s+LLMError\s*\)/s);
  });
});

// ---------------------------------------------------------------------------
// buildRequestBody — wire format conversion
// ---------------------------------------------------------------------------

describe('GLMProvider.buildRequestBody — wire format', () => {
  test('converts msg.toolCalls to wire.tool_calls (snake_case)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/wire\.tool_calls\s*=\s*msg\.toolCalls/);
  });

  test('converts msg.toolCallId to wire.tool_call_id (snake_case)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/wire\.tool_call_id\s*=\s*msg\.toolCallId/);
  });

  test('history messages include role and content', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/\{\s*role:\s*msg\.role,\s*content:\s*msg\.content\s*\}/);
  });

  test('system message is prepended when systemPrompt is set', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/if\s*\(\s*options\?\.systemPrompt\s*\)\s*\{[\s\S]*?messages\.push\(\s*\{\s*role:\s*'system',\s*content:\s*options\.systemPrompt\s*\}\s*\)/s);
  });

  test('empty prompt skips the user message (does NOT push empty user)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/if\s*\(\s*prompt\.length\s*>\s*0\s*\)\s*\{[\s\S]*?messages\.push\(\s*\{\s*role:\s*'user',\s*content:\s*prompt\s*\}/s);
  });

  test('body.model defaults to config.model when options.model is undefined', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/model:\s*options\?\.model\s*\?\?\s*this\.config\.model/);
  });

  test('body.temperature uses option or default', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/temperature:\s*options\?\.temperature\s*\?\?\s*this\.config\.temperatureDefault/);
  });

  test('body.max_tokens uses option or default (snake_case)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/max_tokens:\s*options\?\.maxTokens\s*\?\?\s*this\.config\.maxTokensDefault/);
  });

  test('body.stream is the boolean stream parameter', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/stream,\s*$/m);
  });

  test('tools attached only when non-empty', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/if\s*\(\s*options\?\.tools\?\.length\s*\)\s*\{/);
  });

  test('tool_choice attached only when toolChoice is set', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/if\s*\(\s*options\?\.toolChoice\s*\)\s*\{[\s\S]*?body\.tool_choice\s*=\s*options\.toolChoice/s);
  });
});

// ---------------------------------------------------------------------------
// fetchEndpoint — timeout + auth
// ---------------------------------------------------------------------------

describe('GLMProvider.fetchEndpoint — timeout and auth', () => {
  test('uses AbortController', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/new\s+AbortController\(\)/);
  });

  test('setTimeout aborts after requestTimeoutMs', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/setTimeout\(\s*\(\)\s*=>\s*controller\.abort\(\),\s*this\.config\.requestTimeoutMs\s*\)/);
  });

  test('clearTimeout in finally block', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/finally\s*\{\s*clearTimeout\(timeout\)\s*;\s*\}/s);
  });

  test('uses POST method', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/method:\s*'POST'/);
  });

  test('Content-Type header is application/json', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/'Content-Type':\s*'application\/json'/);
  });

  test('Authorization header is Bearer apiKey', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/Authorization:\s*`Bearer\s+\$\{this\.config\.apiKey\}`/);
  });

  test('body is JSON.stringify(body)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/body:\s*JSON\.stringify\(body\)/);
  });

  test('signal comes from controller.signal', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/signal:\s*controller\.signal/);
  });

  test('url is baseUrl + path', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/\$\{this\.config\.baseUrl\}\$\{path\}/);
  });
});

// ---------------------------------------------------------------------------
// parseCompletionResponse — error paths and mapping
// ---------------------------------------------------------------------------

describe('GLMProvider.parseCompletionResponse — mapping', () => {
  test('throws LLMError when !response.ok', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/if\s*\(\s*!response\.ok\s*\)\s*\{[\s\S]*?throw\s+new\s+LLMError\(/s);
  });

  test('error message format is "GLM API {status}"', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/throw\s+new\s+LLMError\(\s*`GLM\s+API\s+\$\{response\.status\}`/);
  });

  test('throws when choices array is empty', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/if\s*\(\s*!choice\s*\)\s*\{[\s\S]*?throw\s+new\s+LLMError\('GLM\s+API:\s+no\s+choices\s+in\s+response'/s);
  });

  test('content defaults to empty string when message.content is missing', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/content:\s*message\?\.content\s*\?\?\s*''/);
  });

  test('finishReason defaults to "stop" when missing', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/\?\?\s*'stop'/);
  });

  test('inputTokens defaults to 0 when usage.prompt_tokens is missing', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/inputTokens:\s*data\.usage\?\.prompt_tokens\s*\?\?\s*0/);
  });

  test('outputTokens defaults to 0 when usage.completion_tokens is missing', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/outputTokens:\s*data\.usage\?\.completion_tokens\s*\?\?\s*0/);
  });

  test('toolCalls attached only when present (not undefined)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/if\s*\(\s*toolCalls\s*\)\s*\{[\s\S]*?completion\.toolCalls\s*=\s*toolCalls/s);
  });

  test('toolCalls mapping: id, type:"function", function:{name, arguments}', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/tc\.id/);
    expect(src).toMatch(/type:\s*'function'/);
    expect(src).toMatch(/function:\s*\{\s*name:\s*tc\.function\.name,\s*arguments:\s*tc\.function\.arguments\s*\}/);
  });
});

// ---------------------------------------------------------------------------
// stream() — async generator contract
// ---------------------------------------------------------------------------

describe('GLMProvider.stream — async generator', () => {
  test('throws LLMError when !response.ok', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    // The stream() function checks !response.ok before reading the body
    const streamSection = src.match(/async\s+\*stream[\s\S]*?\n\}/);
    expect(streamSection).not.toBeNull();
    expect(streamSection![0]).toMatch(/!response\.ok/);
  });

  test('throws LLMError when response.body is missing', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/if\s*\(\s*!response\.body\s*\)\s*\{[\s\S]*?throw\s+new\s+LLMError\('GLM\s+stream:\s+empty\s+body'/s);
  });

  test('uses TextDecoder', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/new\s+TextDecoder\(\)/);
  });

  test('terminates on [DONE] payload', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/payload\s*===\s*'\[DONE\]'/);
  });

  test('only processes lines starting with "data:"', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/startsWith\('data:'\)/);
  });

  test('skips malformed JSON chunks (try/catch with empty catch)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/try\s*\{\s*JSON\.parse\(payload\)[\s\S]*?\}\s*catch\s*\{/);
  });

  test('reader.releaseLock in finally', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/finally\s*\{\s*reader\.releaseLock\(\)\s*;\s*\}/s);
  });

  test('yields delta.content when present', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/if\s*\(\s*delta\s*\)\s*yield\s+delta/);
  });
});

// ---------------------------------------------------------------------------
// Source-level safety
// ---------------------------------------------------------------------------

describe('llm/glm — source-level safety', () => {
  test('no console.* in production paths', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).not.toMatch(/console\./);
  });

  test('no process.exit', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).not.toMatch(/process\.exit/);
  });

  test('no shell exec/spawn', async () => {
    const src = await readFile('src/lllm/glm.ts'.replace('lllm', 'llm'), 'utf8');
    expect(src).not.toMatch(/child_process/);
    expect(src).not.toMatch(/\bexec\(/);
  });

  test('no fs reads/writes', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).not.toMatch(/^import.*from\s+'fs/m);
    expect(src).not.toMatch(/^import.*from\s+'node:fs/m);
    expect(src).not.toMatch(/readFileSync/);
    expect(src).not.toMatch(/writeFileSync/);
  });
});

// ---------------------------------------------------------------------------
// Structural fingerprint
// ---------------------------------------------------------------------------

describe('llm/glm — structural fingerprint', () => {
  test('file has exactly 1 class implementing LLMProvider', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    const providers = src.match(/^export\s+class\s+\w+\s+implements\s+LLMProvider/gm) ?? [];
    expect(providers.length).toBe(1);
  });

  test('GLMProvider has 3 private methods (buildRequestBody, fetchEndpoint, parseCompletionResponse)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/private\s+buildRequestBody\s*\(/);
    expect(src).toMatch(/private\s+async\s+fetchEndpoint\s*\(/);
    expect(src).toMatch(/private\s+async\s+parseCompletionResponse\s*\(/);
    // Count private methods
    const privMethods = src.match(/^\s+private\s+(async\s+)?\w+\s*\(/gm) ?? [];
    expect(privMethods.length).toBe(3);
  });

  test('LLMError has exactly 3 constructor parameters', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    const match = src.match(/constructor\s*\(\s*message:\s*string,\s*readonly\s+status:\s*number,\s*readonly\s+responseBody:\s*string\s*\)/);
    expect(match).not.toBeNull();
  });

  test('file is between 200 and 260 lines', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    const lines = src.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(200);
    expect(lines.length).toBeLessThanOrEqual(260);
  });

  test('fetch is used (global, no import)', async () => {
    const src = await readFile('src/llm/glm.ts', 'utf8');
    expect(src).toMatch(/\bfetch\(/);
    // fetch is a global — should NOT be imported
    expect(src).not.toMatch(/^import\s+.*\bfetch\b/m);
  });
});
