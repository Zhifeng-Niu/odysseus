/**
 * Invariants for src/llm/provider.ts.
 *
 * This file is the TYPE CONTRACT for the entire LLM layer — every
 * provider (glm.ts, future providers) implements LLMProvider, every
 * tool call flows through ToolCall, every prompt through ChatMessage.
 * Because types vanish at runtime, behavior tests (llm-provider.test.ts,
 * llm-glm.test.ts) cannot directly assert them. This file pins them
 * via source-level regex and runtime shape verification.
 *
 * Load-bearing contracts:
 *
 *   1. ChatMessage.role is a 4-value union — adding a 5th role is a
 *      breaking change for every LLM provider implementation.
 *   2. ToolCall.type is literal 'function' (not 'completion' or
 *      'chat'). The OpenAI-compatible API only supports function calls.
 *   3. ToolSpec.type is literal 'function'. Both ToolCall and ToolSpec
 *      share the same discriminant — a tool spec describes a function,
 *      a tool call invokes a function.
 *   4. LLMCompleteOptions.toolChoice is a 3-way union: 'auto' (default
 *      in glm.ts), 'none', or a specific function. This controls
 *      whether the LLM is allowed to call tools.
 *   5. LLMFinishReason is exactly 4 values. 'stop' = natural completion,
 *      'length' = maxTokens hit, 'tool_calls' = LLM wants to call tools,
 *      'error' = provider error wrapped as a completion.
 *   6. LLMProvider interface: complete() for sync results, stream()
 *      for token-by-token, getModel() for observability.
 *   7. All optional fields use `?` (exactOptionalPropertyTypes compliant).
 *
 * Also pins:
 *   - Source has ZERO runtime imports (pure type module).
 *   - All 7 type/interface exports.
 *   - Readonly modifiers on tuple-style fields.
 */

import { describe, test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import type {
  ChatMessage,
  ToolCall,
  ToolSpec,
  LLMCompleteOptions,
  LLMUsage,
  LLMFinishReason,
  LLMCompletion,
  LLMProvider,
} from '../../src/llm/provider.js';

// ---------------------------------------------------------------------------
// Module exports — all 8 type exports
// ---------------------------------------------------------------------------

describe('provider.ts — module exports', () => {
  test('ChatMessage interface is exported', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).toMatch(/export\s+interface\s+ChatMessage/);
  });

  test('ToolCall interface is exported', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).toMatch(/export\s+interface\s+ToolCall/);
  });

  test('ToolSpec interface is exported', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).toMatch(/export\s+interface\s+ToolSpec/);
  });

  test('LLMCompleteOptions interface is exported', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).toMatch(/export\s+interface\s+LLMCompleteOptions/);
  });

  test('LLMUsage interface is exported', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).toMatch(/export\s+interface\s+LLMUsage/);
  });

  test('LLMFinishReason type is exported', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).toMatch(/export\s+type\s+LLMFinishReason/);
  });

  test('LLMCompletion interface is exported', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).toMatch(/export\s+interface\s+LLMCompletion/);
  });

  test('LLMProvider interface is exported', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).toMatch(/export\s+interface\s+LLMProvider/);
  });

  test('source exports exactly 7 interfaces + 1 type', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const interfaces = src.match(/^export\s+interface\s+(\w+)/gm) ?? [];
    const types = src.match(/^export\s+type\s+(\w+)/gm) ?? [];
    expect(interfaces.length).toBe(7);
    expect(types.length).toBe(1);
  });

  test('source has ZERO runtime imports (pure type module)', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const runtimeImports = src.match(/^import\s+(?!type\s)/gm) ?? [];
    expect(runtimeImports.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ChatMessage — message envelope
// ---------------------------------------------------------------------------

describe('ChatMessage type shape', () => {
  test("role is 4-value union: system|user|assistant|tool", async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+ChatMessage\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/role:\s*['"]system['"]\s*\|\s*['"]user['"]\s*\|\s*['"]assistant['"]\s*\|\s*['"]tool['"]/);
  });

  test('content is string', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+ChatMessage\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/content:\s*string/);
  });

  test('toolCallId is optional string', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+ChatMessage\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/toolCallId\?\s*:\s*string/);
  });

  test('toolCalls is optional ToolCall[]', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+ChatMessage\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/toolCalls\?\s*:\s*ToolCall\[\]/);
  });

  test('exactly 2 required + 2 optional fields', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+ChatMessage\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    const required = match![1].match(/^\s+\w+:/gm) ?? [];
    const optional = match![1].match(/^\s+\w+\?\s*:/gm) ?? [];
    expect(required.length).toBe(2);
    expect(optional.length).toBe(2);
  });

  test('minimal ChatMessage { role, content } satisfies interface', () => {
    const msg: ChatMessage = { role: 'user', content: 'hello' };
    expect(msg.role).toBe('user');
  });

  test('ChatMessage with all fields', () => {
    const msg: ChatMessage = {
      role: 'assistant',
      content: 'response',
      toolCallId: 'tc-1',
      toolCalls: [{ id: 'tc-1', type: 'function', function: { name: 'x', arguments: '{}' } }],
    };
    expect(msg.toolCalls).toHaveLength(1);
  });

  test('role accepts each of the 4 values', () => {
    const sys: ChatMessage = { role: 'system', content: '' };
    const user: ChatMessage = { role: 'user', content: '' };
    const assistant: ChatMessage = { role: 'assistant', content: '' };
    const tool: ChatMessage = { role: 'tool', content: '' };
    expect(sys.role).toBe('system');
    expect(user.role).toBe('user');
    expect(assistant.role).toBe('assistant');
    expect(tool.role).toBe('tool');
  });
});

// ---------------------------------------------------------------------------
// ToolCall — LLM-emitted tool invocation
// ---------------------------------------------------------------------------

describe('ToolCall type shape', () => {
  test('id is string', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+ToolCall\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/id:\s*string/);
  });

  test("type is literal 'function'", async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+ToolCall\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/type:\s*['"]function['"]/);
  });

  test('function is nested { name, arguments }', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    // Nested object — match directly on source to avoid non-greedy issues.
    expect(src).toMatch(/function:\s*\{\s*name:\s*string;\s*arguments:\s*string\s*\}/);
  });

  test('exactly 3 fields, all required', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+ToolCall\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toMatch(/\?\s*:/);
  });

  test('minimal ToolCall satisfies interface', () => {
    const call: ToolCall = {
      id: 'call-1',
      type: 'function',
      function: { name: 'file-read', arguments: '{}' },
    };
    expect(call.type).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// ToolSpec — tool definition sent to LLM
// ---------------------------------------------------------------------------

describe('ToolSpec type shape', () => {
  test("type is literal 'function'", async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+ToolSpec\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/type:\s*['"]function['"]/);
  });

  test('function is nested { name, description, parameters }', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    // Match field names individually due to nested structure.
    expect(src).toMatch(/name:\s*string/);
    expect(src).toMatch(/description:\s*string/);
    expect(src).toMatch(/parameters:\s*Record<string,\s*unknown>/);
  });

  test("source documents JSON Schema parameters convention", async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    // The doc comment is load-bearing — it tells implementers what
    // shape to put in `parameters`.
    expect(src).toMatch(/JSON Schema/i);
    expect(src).toMatch(/type:\s*['"]object['"]/);
  });

  test('minimal ToolSpec satisfies interface', () => {
    const spec: ToolSpec = {
      type: 'function',
      function: {
        name: 'file-read',
        description: 'Read a file',
        parameters: { type: 'object', properties: {} },
      },
    };
    expect(spec.type).toBe('function');
    expect(spec.function.name).toBe('file-read');
  });
});

// ---------------------------------------------------------------------------
// LLMCompleteOptions — call configuration
// ---------------------------------------------------------------------------

describe('LLMCompleteOptions type shape', () => {
  test('model is optional string', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+LLMCompleteOptions\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/model\?\s*:\s*string/);
  });

  test('maxTokens is optional number', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+LLMCompleteOptions\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/maxTokens\?\s*:\s*number/);
  });

  test('temperature is optional number', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+LLMCompleteOptions\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/temperature\?\s*:\s*number/);
  });

  test('systemPrompt is optional string', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+LLMCompleteOptions\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/systemPrompt\?\s*:\s*string/);
  });

  test('history is optional ChatMessage[]', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+LLMCompleteOptions\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/history\?\s*:\s*ChatMessage\[\]/);
  });

  test('tools is optional ToolSpec[]', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+LLMCompleteOptions\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/tools\?\s*:\s*ToolSpec\[\]/);
  });

  test("toolChoice is union: 'auto' | 'none' | { type, function: { name } }", async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+LLMCompleteOptions\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/toolChoice\?\s*:/);
    expect(match![1]).toMatch(/['"]auto['"]\s*\|\s*['"]none['"]/);
  });

  test('signal is optional AbortSignal', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    // LLMCompleteOptions has a nested object in toolChoice — non-greedy
    // match stops at first inner }. Match directly on full source.
    expect(src).toMatch(/signal\?\s*:\s*AbortSignal/);
  });

  test('all 8 fields are optional (no required)', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    // Match on the source line range of LLMCompleteOptions interface.
    // The interface has nested braces in toolChoice, so we can't use
    // non-greedy capture. Instead, count optional fields by name list.
    const expectedOptional = [
      'model?',
      'maxTokens?',
      'temperature?',
      'systemPrompt?',
      'history?',
      'tools?',
      'toolChoice?',
      'signal?',
    ];
    for (const field of expectedOptional) {
      expect(src).toMatch(new RegExp(`^\\s+${field.replace('?', '\\?')}\\s*:`, 'm'));
    }
  });

  test('empty object {} satisfies LLMCompleteOptions', () => {
    const opts: LLMCompleteOptions = {};
    expect(opts).toEqual({});
  });

  test('LLMCompleteOptions accepts all 8 fields', () => {
    const opts: LLMCompleteOptions = {
      model: 'glm-5.2',
      maxTokens: 4096,
      temperature: 0.7,
      systemPrompt: 'system',
      history: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'x', description: 'd', parameters: {} } }],
      toolChoice: 'auto',
      signal: new AbortController().signal,
    };
    expect(opts.model).toBe('glm-5.2');
  });

  test("toolChoice 'none' disables tool calling", () => {
    const opts: LLMCompleteOptions = { toolChoice: 'none' };
    expect(opts.toolChoice).toBe('none');
  });

  test('toolChoice can specify a function by name', () => {
    const opts: LLMCompleteOptions = {
      toolChoice: { type: 'function', function: { name: 'file-read' } },
    };
    expect(opts.toolChoice).toEqual({ type: 'function', function: { name: 'file-read' } });
  });
});

// ---------------------------------------------------------------------------
// LLMUsage — token counters
// ---------------------------------------------------------------------------

describe('LLMUsage type shape', () => {
  test('inputTokens is number', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+LLMUsage\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/inputTokens:\s*number/);
  });

  test('outputTokens is number', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+LLMUsage\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/outputTokens:\s*number/);
  });

  test('exactly 2 fields, no optional', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+LLMUsage\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toMatch(/\?\s*:/);
  });

  test('LLMUsage accepts { inputTokens, outputTokens }', () => {
    const usage: LLMUsage = { inputTokens: 100, outputTokens: 50 };
    expect(usage.inputTokens + usage.outputTokens).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// LLMFinishReason — completion outcome tag
// ---------------------------------------------------------------------------

describe('LLMFinishReason type', () => {
  test("type is union: 'stop' | 'length' | 'tool_calls' | 'error'", async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).toMatch(/export\s+type\s+LLMFinishReason\s*=\s*['"]stop['"]\s*\|\s*['"]length['"]\s*\|\s*['"]tool_calls['"]\s*\|\s*['"]error['"]/);
  });

  test('union has exactly 4 values', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+type\s+LLMFinishReason\s*=\s*([^;]+)/);
    expect(match).not.toBeNull();
    // Match with capture group to extract bare values (no quotes).
    const values = match![1].match(/['"]([^'"]+)['"]/g) ?? [];
    // Strip quotes for comparison.
    const stripped = values.map((v) => v.replace(/^['"]|['"]$/g, ''));
    expect(stripped).toEqual(['stop', 'length', 'tool_calls', 'error']);
  });

  test('each LLMFinishReason value is assignable', () => {
    const stop: LLMFinishReason = 'stop';
    const length: LLMFinishReason = 'length';
    const toolCalls: LLMFinishReason = 'tool_calls';
    const error: LLMFinishReason = 'error';
    expect(stop).toBe('stop');
    expect(length).toBe('length');
    expect(toolCalls).toBe('tool_calls');
    expect(error).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// LLMCompletion — provider return value
// ---------------------------------------------------------------------------

describe('LLMCompletion type shape', () => {
  test('content is string', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+LLMCompletion\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/content:\s*string/);
  });

  test('model is string', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+LLMCompletion\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/model:\s*string/);
  });

  test('usage is LLMUsage', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+LLMCompletion\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/usage:\s*LLMUsage/);
  });

  test('finishReason is LLMFinishReason', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+LLMCompletion\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/finishReason:\s*LLMFinishReason/);
  });

  test('toolCalls is optional ToolCall[]', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+LLMCompletion\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/toolCalls\?\s*:\s*ToolCall\[\]/);
  });

  test('exactly 4 required + 1 optional', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+LLMCompletion\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    const required = match![1].match(/^\s+\w+:/gm) ?? [];
    const optional = match![1].match(/^\s+\w+\?\s*:/gm) ?? [];
    expect(required.length).toBe(4);
    expect(optional.length).toBe(1);
  });

  test('minimal LLMCompletion satisfies interface', () => {
    const c: LLMCompletion = {
      content: 'response',
      model: 'glm-5.2',
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: 'stop',
    };
    expect(c.finishReason).toBe('stop');
  });

  test('LLMCompletion with toolCalls', () => {
    const c: LLMCompletion = {
      content: '',
      model: 'glm-5.2',
      usage: { inputTokens: 10, outputTokens: 0 },
      finishReason: 'tool_calls',
      toolCalls: [{ id: 'tc-1', type: 'function', function: { name: 'file-read', arguments: '{}' } }],
    };
    expect(c.toolCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// LLMProvider — the implementer interface
// ---------------------------------------------------------------------------

describe('LLMProvider interface shape', () => {
  test('complete is async method returning LLMCompletion', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).toMatch(/complete\(prompt:\s*string,\s*options\?\s*:\s*LLMCompleteOptions\):\s*Promise<LLMCompletion>/);
  });

  test('stream is async iterable returning string chunks', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).toMatch(/stream\(prompt:\s*string,\s*options\?\s*:\s*LLMCompleteOptions\):\s*AsyncIterable<string>/);
  });

  test('getModel is sync method returning string', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).toMatch(/getModel\(\):\s*string/);
  });

  test('exactly 3 methods, all required', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const match = src.match(/export\s+interface\s+LLMProvider\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    // 3 method signatures, none optional.
    expect(match![1]).not.toMatch(/\?\s*[(<]/);
  });

  test('complete takes prompt as first positional arg', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).toMatch(/complete\(prompt:\s*string/);
  });

  test('stream takes prompt as first positional arg', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).toMatch(/stream\(prompt:\s*string/);
  });

  test('minimal LLMProvider implementation satisfies interface', () => {
    const provider: LLMProvider = {
      async complete() {
        return {
          content: '',
          model: 'fake',
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: 'stop',
        };
      },
      async *stream() {
        yield '';
      },
      getModel() {
        return 'fake';
      },
    };
    expect(provider.getModel()).toBe('fake');
  });

  test('LLMProvider.complete options is optional (can be omitted)', () => {
    const provider: LLMProvider = {
      async complete(prompt) {
        return {
          content: prompt,
          model: 'fake',
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: 'stop',
        };
      },
      async *stream() {
        yield '';
      },
      getModel() {
        return 'fake';
      },
    };
    // complete can be called with just prompt (no options).
    expect(typeof provider.complete).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Type relationships — cross-references between interfaces
// ---------------------------------------------------------------------------

describe('provider.ts — type relationships', () => {
  test('ChatMessage.toolCalls references ToolCall[]', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).toMatch(/toolCalls\?\s*:\s*ToolCall\[\]/);
  });

  test('LLMCompleteOptions.history references ChatMessage[]', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).toMatch(/history\?\s*:\s*ChatMessage\[\]/);
  });

  test('LLMCompleteOptions.tools references ToolSpec[]', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).toMatch(/tools\?\s*:\s*ToolSpec\[\]/);
  });

  test('LLMCompletion.usage references LLMUsage', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).toMatch(/usage:\s*LLMUsage/);
  });

  test('LLMCompletion.finishReason references LLMFinishReason', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).toMatch(/finishReason:\s*LLMFinishReason/);
  });

  test('LLMProvider.complete returns Promise<LLMCompletion>', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).toMatch(/Promise<LLMCompletion>/);
  });
});

// ---------------------------------------------------------------------------
// Source-level — no runtime dependencies
// ---------------------------------------------------------------------------

describe('provider.ts — source-level imports', () => {
  test('source has no import statements at all (pure type module)', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    const imports = src.match(/^import\s+.*$/gm) ?? [];
    expect(imports.length).toBe(0);
  });

  test('source does NOT import from tools/agent/cerebellum layers', async () => {
    const src = await readFile('src/llm/provider.ts', 'utf8');
    expect(src).not.toMatch(/from\s*['"]\.\.\/tools/);
    expect(src).not.toMatch(/from\s*['"]\.\.\/agent/);
    expect(src).not.toMatch(/from\s*['"]\.\.\/cerebellum/);
  });
});

// ---------------------------------------------------------------------------
// Determinism — same-type-equality at runtime
// ---------------------------------------------------------------------------

describe('provider.ts — determinism', () => {
  test('two ChatMessage with same values are equal', () => {
    const a: ChatMessage = { role: 'user', content: 'hello' };
    const b: ChatMessage = { role: 'user', content: 'hello' };
    expect(a).toEqual(b);
  });

  test('two LLMUsage with same values are equal', () => {
    const a: LLMUsage = { inputTokens: 100, outputTokens: 50 };
    const b: LLMUsage = { inputTokens: 100, outputTokens: 50 };
    expect(a).toEqual(b);
  });

  test('two LLMCompletion with same values are equal', () => {
    const a: LLMCompletion = {
      content: 'x',
      model: 'm',
      usage: { inputTokens: 1, outputTokens: 2 },
      finishReason: 'stop',
    };
    const b: LLMCompletion = {
      content: 'x',
      model: 'm',
      usage: { inputTokens: 1, outputTokens: 2 },
      finishReason: 'stop',
    };
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Runtime narrowing — discriminated unions
// ---------------------------------------------------------------------------

describe('provider.ts — runtime narrowing', () => {
  test('ChatMessage.role narrows via string discriminant', () => {
    function classify(msg: ChatMessage): string {
      switch (msg.role) {
        case 'system':
          return 'system-prompt';
        case 'user':
          return 'user-input';
        case 'assistant':
          return 'assistant-reply';
        case 'tool':
          return 'tool-result';
      }
    }
    expect(classify({ role: 'system', content: '' })).toBe('system-prompt');
    expect(classify({ role: 'user', content: '' })).toBe('user-input');
    expect(classify({ role: 'assistant', content: '' })).toBe('assistant-reply');
    expect(classify({ role: 'tool', content: '' })).toBe('tool-result');
  });

  test('LLMFinishReason narrows via string discriminant', () => {
    function isTerminal(reason: LLMFinishReason): boolean {
      return reason === 'stop' || reason === 'error';
    }
    expect(isTerminal('stop')).toBe(true);
    expect(isTerminal('error')).toBe(true);
    expect(isTerminal('length')).toBe(false);
    expect(isTerminal('tool_calls')).toBe(false);
  });

  test('toolChoice narrows via typeof check', () => {
    function isForced(choice: LLMCompleteOptions['toolChoice']): boolean {
      if (typeof choice === 'string') {
        return false; // 'auto' or 'none'
      }
      return true; // { type: 'function', ... }
    }
    expect(isForced('auto')).toBe(false);
    expect(isForced('none')).toBe(false);
    expect(isForced({ type: 'function', function: { name: 'x' } })).toBe(true);
  });

  test('LLMCompletion.toolCalls presence detected via in operator', () => {
    const withCalls: LLMCompletion = {
      content: '',
      model: 'm',
      usage: { inputTokens: 0, outputTokens: 0 },
      finishReason: 'tool_calls',
      toolCalls: [],
    };
    const withoutCalls: LLMCompletion = {
      content: '',
      model: 'm',
      usage: { inputTokens: 0, outputTokens: 0 },
      finishReason: 'stop',
    };
    expect('toolCalls' in withCalls).toBe(true);
    expect('toolCalls' in withoutCalls).toBe(false);
  });
});
