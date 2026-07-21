/**
 * Invariants for src/tools/types.ts.
 *
 * This file is the TYPE FOUNDATION for the entire tools subsystem —
 * every tool (bash, file, git, registry) implements the Tool interface,
 * every orchestrator dispatch goes through ToolResult. Because types
 * vanish at runtime, behavior tests (tools-bash.test.ts, tools-file.test.ts,
 * tools-git.test.ts) cannot directly assert them. This file pins the
 * structural contracts via source-level regex and runtime narrowing.
 *
 * Load-bearing contracts:
 *
 *   1. ToolResult is a DISCRIMINATED UNION on `ok`. The discriminant
 *      is a literal boolean (true/false), not a string. This lets
 *      consumers narrow with `if (result.ok)` and get TypeScript
 *      type narrowing for free. Iteration 19 commit-audit relied
 *      on this pattern to detect silent failures.
 *   2. ToolResult Ok branch has `value: string` (never undefined,
 *      never null). All tools MUST return a human-readable value —
 *      the LLM consumes this.
 *   3. ToolResult Err branch has `error: string` (not Error, not
 *      unknown). Tools flatten errors into messages.
 *   4. Tool.execute MUST NOT THROW — it catches internal errors and
 *      returns { ok: false, error }. Tools-bash/file/git all wrap
 *      in try/catch for this reason. The return-type annotation is
 *      Promise<ToolResult>, NOT Promise<ToolResult | void>.
 *   5. Tool.mutates? defaults to true (conservative) when omitted.
 *      Read-only tools (file-read, git-log) override to false so
 *      the orchestrator skips checkpoints for them.
 *   6. ToolContext.cwd is required — every tool needs a working
 *      directory. env and signal are optional (exactOptionalPropertyTypes).
 *   7. ToolSpec is re-exported from llm/provider.ts, not redefined.
 *      This couples the tools layer to the LLM layer intentionally.
 *
 * Also pins:
 *   - Every field is readonly-via-interface (consumers shouldn't mutate).
 *   - execute returns Promise<ToolResult> (always async).
 *   - mutates accepts the same args type as execute.
 */

import { describe, test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import type {
  Tool,
  ToolContext,
  ToolResult,
  ToolResultOk,
  ToolResultErr,
} from '../../src/tools/types.js';
import type { ToolSpec } from '../../src/llm/provider.js';

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

describe('types.ts — module exports', () => {
  test('ToolContext interface is exported', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    expect(src).toMatch(/export\s+interface\s+ToolContext/);
  });

  test('ToolResultOk interface is exported', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    expect(src).toMatch(/export\s+interface\s+ToolResultOk/);
  });

  test('ToolResultErr interface is exported', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    expect(src).toMatch(/export\s+interface\s+ToolResultErr/);
  });

  test('ToolResult type is exported', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    expect(src).toMatch(/export\s+type\s+ToolResult/);
  });

  test('Tool interface is exported', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    expect(src).toMatch(/export\s+interface\s+Tool/);
  });

  test('ToolSpec is re-exported (not redefined)', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    expect(src).toMatch(/import\s+type\s*\{\s*ToolSpec\s*\}\s*from\s*['"]\.\.\/llm\/provider\.js['"]/);
    expect(src).toMatch(/export\s+type\s*\{\s*ToolSpec\s*\}/);
  });

  test('source exports exactly 4 interfaces + 2 types', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    const interfaces = src.match(/^export\s+interface\s+(\w+)/gm) ?? [];
    const types = src.match(/^export\s+type\s+/gm) ?? [];
    expect(interfaces.length).toBe(4);
    // 1 local type (ToolResult) + 1 re-export (export type { ToolSpec }).
    expect(types.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// ToolContext type shape
// ---------------------------------------------------------------------------

describe('ToolContext type shape', () => {
  test('cwd is required string', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    const match = src.match(/export\s+interface\s+ToolContext\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/cwd:\s*string/);
  });

  test('env is optional NodeJS.ProcessEnv', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    const match = src.match(/export\s+interface\s+ToolContext\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/env\?\s*:\s*NodeJS\.ProcessEnv/);
  });

  test('signal is optional AbortSignal', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    const match = src.match(/export\s+interface\s+ToolContext\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/signal\?\s*:\s*AbortSignal/);
  });

  test('exactly 1 required + 2 optional fields', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    const match = src.match(/export\s+interface\s+ToolContext\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    const required = match![1].match(/^\s+\w+:/gm) ?? [];
    const optional = match![1].match(/^\s+\w+\?\s*:/gm) ?? [];
    expect(required.length).toBe(1);
    expect(optional.length).toBe(2);
  });

  test('ToolContext accepts minimal { cwd }', () => {
    const ctx: ToolContext = { cwd: '/tmp' };
    expect(ctx.cwd).toBe('/tmp');
  });

  test('ToolContext accepts all three fields', () => {
    const ctx: ToolContext = {
      cwd: '/tmp',
      env: { MY_VAR: 'value' },
      signal: new AbortController().signal,
    };
    expect(ctx.env?.MY_VAR).toBe('value');
  });
});

// ---------------------------------------------------------------------------
// ToolResultOk — success branch of discriminated union
// ---------------------------------------------------------------------------

describe('ToolResultOk type shape', () => {
  test('ok is literal true', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    const match = src.match(/export\s+interface\s+ToolResultOk\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/ok:\s*true/);
  });

  test('value is string', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    const match = src.match(/export\s+interface\s+ToolResultOk\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/value:\s*string/);
  });

  test('exactly 2 fields, no optional', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    const match = src.match(/export\s+interface\s+ToolResultOk\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toMatch(/\?\s*:/);
  });

  test('ToolResultOk narrows via ok=true discriminant', () => {
    const result: ToolResult = { ok: true, value: 'data' };
    if (result.ok) {
      // Inside this branch, result is ToolResultOk.
      expect(result.value).toBe('data');
    }
  });
});

// ---------------------------------------------------------------------------
// ToolResultErr — failure branch of discriminated union
// ---------------------------------------------------------------------------

describe('ToolResultErr type shape', () => {
  test('ok is literal false', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    const match = src.match(/export\s+interface\s+ToolResultErr\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/ok:\s*false/);
  });

  test('error is string (not Error)', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    const match = src.match(/export\s+interface\s+ToolResultErr\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/error:\s*string/);
    expect(match![1]).not.toMatch(/error:\s*Error/);
  });

  test('exactly 2 fields, no optional', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    const match = src.match(/export\s+interface\s+ToolResultErr\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toMatch(/\?\s*:/);
  });

  test('ToolResultErr narrows via ok=false discriminant', () => {
    const result: ToolResult = { ok: false, error: 'failed' };
    if (!result.ok) {
      // Inside this branch, result is ToolResultErr.
      expect(result.error).toBe('failed');
    }
  });
});

// ---------------------------------------------------------------------------
// ToolResult — discriminated union
// ---------------------------------------------------------------------------

describe('ToolResult discriminated union', () => {
  test('type is union of ToolResultOk | ToolResultErr', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    expect(src).toMatch(/export\s+type\s+ToolResult\s*=\s*ToolResultOk\s*\|\s*ToolResultErr/);
  });

  test('discriminant is `ok` (boolean literal)', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    // Both branches use `ok: true` or `ok: false` as the discriminant.
    expect(src).toMatch(/ok:\s*true/);
    expect(src).toMatch(/ok:\s*false/);
  });

  test('ToolResult narrows via if (result.ok) check at runtime', () => {
    const ok: ToolResult = { ok: true, value: 'x' };
    const err: ToolResult = { ok: false, error: 'y' };
    // Runtime narrowing using the discriminant.
    expect(ok.ok === true).toBe(true);
    expect(err.ok === false).toBe(true);
  });

  test('ToolResult Ok branch has value, not error', () => {
    const result: ToolResult = { ok: true, value: 'data' };
    if (result.ok) {
      // TypeScript: result.value is accessible, result.error is not.
      expect(result.value).toBeDefined();
      expect('error' in result).toBe(false);
    }
  });

  test('ToolResult Err branch has error, not value', () => {
    const result: ToolResult = { ok: false, error: 'oops' };
    if (!result.ok) {
      // TypeScript: result.error is accessible, result.value is not.
      expect(result.error).toBeDefined();
      expect('value' in result).toBe(false);
    }
  });

  test('ToolResult runtime shape: exactly 2 keys', () => {
    const ok: ToolResult = { ok: true, value: 'x' };
    const err: ToolResult = { ok: false, error: 'y' };
    expect(Object.keys(ok).sort()).toEqual(['ok', 'value']);
    expect(Object.keys(err).sort()).toEqual(['error', 'ok']);
  });
});

// ---------------------------------------------------------------------------
// Tool interface shape
// ---------------------------------------------------------------------------

describe('Tool interface shape', () => {
  test('name is string', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    const match = src.match(/export\s+interface\s+Tool\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/name:\s*string/);
  });

  test('description is string', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    const match = src.match(/export\s+interface\s+Tool\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/description:\s*string/);
  });

  test('parameters is Record<string, unknown>', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    const match = src.match(/export\s+interface\s+Tool\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/parameters:\s*Record<string,\s*unknown>/);
  });

  test('execute is async function returning ToolResult', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    const match = src.match(/export\s+interface\s+Tool\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/execute\(args:\s*Record<string,\s*unknown>,\s*ctx:\s*ToolContext\):\s*Promise<ToolResult>/);
  });

  test('mutates is optional function returning boolean', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    const match = src.match(/export\s+interface\s+Tool\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/mutates\?\s*\(args:\s*Record<string,\s*unknown>\):\s*boolean/);
  });

  test('exactly 4 required + 1 optional field', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    const match = src.match(/export\s+interface\s+Tool\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    // Note: methods (execute) count as required fields too.
    // Count via field-name detection at line start.
    const allFields = match![1].match(/^\s+(\w+)(\?)?\s*[:,(]/gm) ?? [];
    const optionalFields = match![1].match(/^\s+\w+\?/gm) ?? [];
    expect(allFields.length).toBe(5);
    expect(optionalFields.length).toBe(1);
  });

  test('mutates accepts same args type as execute', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    // Both methods accept Record<string, unknown>.
    const executeMatch = src.match(/execute\(args:\s*Record<string,\s*unknown>/);
    const mutatesMatch = src.match(/mutates\?\s*\(args:\s*Record<string,\s*unknown>/);
    expect(executeMatch).not.toBeNull();
    expect(mutatesMatch).not.toBeNull();
  });

  test('mutates doc says default is true (conservative)', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    // The doc comment is load-bearing — it documents that omitting
    // mutates() defaults to "may mutate" so the orchestrator creates
    // checkpoints defensively.
    expect(src).toMatch(/Default\s*\(when omitted\):\s*true/i);
    expect(src).toMatch(/conservative/i);
  });

  test('mutates doc mentions read-only tools', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    expect(src).toMatch(/read-only/i);
  });
});

// ---------------------------------------------------------------------------
// Compile-time interface satisfaction (runtime shapes)
// ---------------------------------------------------------------------------

describe('Tool interface — runtime compliance', () => {
  test('a complete Tool implementation satisfies the interface', () => {
    const tool: Tool = {
      name: 'example',
      description: 'example tool',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { ok: true, value: 'done' };
      },
      mutates: () => false,
    };
    expect(tool.name).toBe('example');
    expect(typeof tool.execute).toBe('function');
    expect(typeof tool.mutates).toBe('function');
  });

  test('Tool without mutates() still satisfies the interface (optional)', () => {
    const tool: Tool = {
      name: 'minimal',
      description: 'no mutates',
      parameters: { type: 'object' },
      async execute() {
        return { ok: false, error: 'not implemented' };
      },
    };
    expect(tool.mutates).toBeUndefined();
  });

  test('execute returns Promise<ToolResult>', async () => {
    const tool: Tool = {
      name: 't',
      description: 'd',
      parameters: {},
      async execute() {
        return { ok: true, value: 'v' };
      },
    };
    const result = await tool.execute({}, { cwd: '/tmp' });
    expect(result.ok).toBe(true);
  });

  test('ToolResult from execute is either Ok or Err', async () => {
    const okTool: Tool = {
      name: 'ok',
      description: 'd',
      parameters: {},
      async execute() {
        return { ok: true, value: 'success' };
      },
    };
    const errTool: Tool = {
      name: 'err',
      description: 'd',
      parameters: {},
      async execute() {
        return { ok: false, error: 'fail' };
      },
    };
    const okResult = await okTool.execute({}, { cwd: '/tmp' });
    const errResult = await errTool.execute({}, { cwd: '/tmp' });
    expect(okResult.ok === true).toBe(true);
    expect(errResult.ok === false).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ToolSpec — re-exported from llm/provider.ts
// ---------------------------------------------------------------------------

describe('ToolSpec re-export', () => {
  test('ToolSpec is the same type as llm/provider.ts ToolSpec', async () => {
    // Verify the re-export line exists.
    const src = await readFile('src/tools/types.ts', 'utf8');
    expect(src).toMatch(/export\s+type\s*\{\s*ToolSpec\s*\}/);
  });

  test('ToolSpec has type: "function"', async () => {
    const providerSrc = await readFile('src/llm/provider.ts', 'utf8');
    const match = providerSrc.match(/export\s+interface\s+ToolSpec\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/type:\s*['"]function['"]/);
  });

  test('ToolSpec.function has name, description, parameters', async () => {
    const providerSrc = await readFile('src/llm/provider.ts', 'utf8');
    // ToolSpec has a nested function: {...} object — non-greedy match
    // would stop at the first inner }. Match directly on full source
    // (the field names are unique enough to not collide).
    expect(providerSrc).toMatch(/name:\s*string/);
    expect(providerSrc).toMatch(/description:\s*string/);
    expect(providerSrc).toMatch(/parameters:\s*Record<string,\s*unknown>/);
  });

  test('a valid ToolSpec object satisfies the interface', () => {
    const spec: ToolSpec = {
      type: 'function',
      function: {
        name: 'example',
        description: 'an example',
        parameters: { type: 'object', properties: {} },
      },
    };
    expect(spec.type).toBe('function');
    expect(spec.function.name).toBe('example');
  });
});

// ---------------------------------------------------------------------------
// Determinism (for type-level guarantees exposed at runtime)
// ---------------------------------------------------------------------------

describe('types.ts — determinism', () => {
  test('creating a ToolResult with same values produces equal object', () => {
    const a: ToolResult = { ok: true, value: 'same' };
    const b: ToolResult = { ok: true, value: 'same' };
    expect(a).toEqual(b);
  });

  test('ToolResult Ok and Err are never equal', () => {
    const ok: ToolResult = { ok: true, value: 'x' };
    const err: ToolResult = { ok: false, error: 'x' };
    expect(ok).not.toEqual(err);
  });

  test('Two ToolResultErr with different messages are not equal', () => {
    const a: ToolResult = { ok: false, error: 'one' };
    const b: ToolResult = { ok: false, error: 'two' };
    expect(a).not.toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Source-level invariants — module imports
// ---------------------------------------------------------------------------

describe('types.ts — source-level imports', () => {
  test('imports only ToolSpec type from llm/provider.js', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    expect(src).toMatch(/import\s+type\s*\{\s*ToolSpec\s*\}\s*from\s*['"]\.\.\/llm\/provider\.js['"]/);
  });

  test('source does NOT import from cerebellum or agent layers', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    // tools/types is a foundational layer — it must not depend on
    // higher-level modules (would create a cycle).
    expect(src).not.toMatch(/from\s*['"]\.\.\/cerebellum/);
    expect(src).not.toMatch(/from\s*['"]\.\.\/agent/);
    expect(src).not.toMatch(/from\s*['"]\.\.\/orchestrator/);
  });

  test('source has no runtime imports (only type imports)', async () => {
    const src = await readFile('src/tools/types.ts', 'utf8');
    // Type-only modules don't need runtime imports.
    const runtimeImports = src.match(/^import\s+(?!type\s)/gm) ?? [];
    expect(runtimeImports.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Discriminant pattern — compile-time safety
// ---------------------------------------------------------------------------

describe('ToolResult — discriminant exhaustiveness', () => {
  test('switch on result.ok covers both cases', () => {
    function classify(result: ToolResult): string {
      switch (result.ok) {
        case true:
          return `ok:${result.value}`;
        case false:
          return `err:${result.error}`;
      }
    }
    expect(classify({ ok: true, value: 'data' })).toBe('ok:data');
    expect(classify({ ok: false, error: 'fail' })).toBe('err:fail');
  });

  test('ternary on result.ok narrows type', () => {
    function summary(result: ToolResult): string {
      return result.ok ? result.value : result.error;
    }
    expect(summary({ ok: true, value: 'v' })).toBe('v');
    expect(summary({ ok: false, error: 'e' })).toBe('e');
  });
});

// ---------------------------------------------------------------------------
// Runtime narrowing verification
// ---------------------------------------------------------------------------

describe('ToolResult — runtime narrowing', () => {
  test('Object.keys(result) reveals the variant', () => {
    const ok: ToolResult = { ok: true, value: 'x' };
    const err: ToolResult = { ok: false, error: 'y' };
    // The keys differ based on the variant.
    expect(Object.keys(ok)).toContain('value');
    expect(Object.keys(ok)).not.toContain('error');
    expect(Object.keys(err)).toContain('error');
    expect(Object.keys(err)).not.toContain('value');
  });

  test("'in' operator detects variant", () => {
    const ok: ToolResult = { ok: true, value: 'x' };
    const err: ToolResult = { ok: false, error: 'y' };
    expect('value' in ok).toBe(true);
    expect('error' in ok).toBe(false);
    expect('error' in err).toBe(true);
    expect('value' in err).toBe(false);
  });

  test('JSON.stringify produces different shapes per variant', () => {
    const ok: ToolResult = { ok: true, value: 'x' };
    const err: ToolResult = { ok: false, error: 'y' };
    expect(JSON.stringify(ok)).toBe('{"ok":true,"value":"x"}');
    expect(JSON.stringify(err)).toBe('{"ok":false,"error":"y"}');
  });
});
