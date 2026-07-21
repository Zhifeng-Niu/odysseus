/**
 * Invariants for src/tools/registry.ts.
 *
 * ToolRegistry is the single tool dispatcher — every orchestrator tool
 * call goes through dispatch(). Four load-bearing contracts:
 *
 *   1. LAST-WRITE-WINS on register(): re-registering a tool with the
 *      same name silently replaces the previous. Callers must ensure
 *      no unintended shadowing at registration sites.
 *   2. UNKNOWN TOOL HANDLING:
 *      - get(name) returns undefined.
 *      - mayMutate returns false (conservative — orchestrator will
 *        reject via dispatch before reaching mutate-check).
 *      - dispatch returns { ok: false, error: "Unknown tool: ${name}" }.
 *   3. CONSERVATIVE mutates DEFAULT: tools omitting mutates() are
 *      treated as mutating (return true). Errs on the side of paying
 *      checkpoint cost when in doubt.
 *   4. DISPATCH NEVER THROWS — try/catch wraps execute(). Errors
 *      surface as { ok: false, error: msg } (msg is err.message for
 *      Error instances, String(err) for others).
 *
 * Behavior tests (tool-registry.test.ts, tools-registry.test.ts)
 * cover happy paths. This file pins structural contracts that future
 * refactors must preserve:
 *
 *   - ToolRegistry uses Map<string, Tool> internally (private readonly).
 *   - listSpecs converts Map values to ToolSpec[] with type='function'.
 *   - All methods are public; tools field is private.
 *   - dispatch catches both sync and async errors from execute.
 *   - Error message format: "Unknown tool: ${name}".
 *   - No side effects on Tool objects (registry doesn't mutate Tool).
 */

import { describe, test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { Tool, ToolResult, ToolSpec } from '../../src/tools/types.js';

// ---------------------------------------------------------------------------
// Test helpers — fake tool factories
// ---------------------------------------------------------------------------

function makeTool(opts: {
  name?: string;
  description?: string;
  mutates?: (args: Record<string, unknown>) => boolean;
  execute?: (args: Record<string, unknown>, ctx: { cwd: string }) => Promise<ToolResult>;
}): Tool {
  return {
    name: opts.name ?? 'fake-tool',
    description: opts.description ?? 'fake description',
    parameters: { type: 'object', properties: {} },
    execute:
      opts.execute ??
      (async () => ({ ok: true, value: 'ok' }) as ToolResult),
    ...(opts.mutates !== undefined ? { mutates: opts.mutates } : {}),
  };
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

describe('registry.ts — module exports', () => {
  test('ToolRegistry class is exported', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).toMatch(/export\s+class\s+ToolRegistry/);
  });

  test('source exports exactly one class', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    const classExports = src.match(/^export\s+class\s+(\w+)/gm) ?? [];
    expect(classExports.length).toBe(1);
  });

  test("source imports only types from './types.js'", async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).toMatch(/import\s+type\s*\{\s*Tool,\s*ToolContext,\s*ToolResult,\s*ToolSpec\s*\}\s*from\s*['"]\.\/types\.js['"]/);
  });

  test('source has no other imports', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    const imports = src.match(/^import\s+.*$/gm) ?? [];
    expect(imports.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Internal state — Map<string, Tool>
// ---------------------------------------------------------------------------

describe('ToolRegistry — internal state', () => {
  test('tools field is private readonly Map<string, Tool>', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).toMatch(/private\s+readonly\s+tools\s*=\s*new\s+Map<string,\s*Tool>\(\)/);
  });

  test('tools field uses Map (not Record, not Array)', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).toMatch(/new\s+Map</);
  });

  test('tools field is declared private readonly (TS soft-private)', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    // TypeScript `private` is compile-time only — it does not enforce runtime
    // privacy. The contract here is that the source declares it private, so
    // callers in the same package cannot read/write the field without a cast.
    expect(src).toMatch(/private\s+readonly\s+tools\s*=/);
    // Negative: must NOT use ECMAScript hard-private `#tools` (would change
    // serialization behavior and is unnecessary for this internal state).
    expect(src).not.toMatch(/#\s*tools/);
  });
});

// ---------------------------------------------------------------------------
// register() — last-write-wins contract
// ---------------------------------------------------------------------------

describe('ToolRegistry — register() contract', () => {
  test('register adds a tool retrievable via get()', () => {
    const registry = new ToolRegistry();
    const tool = makeTool({ name: 'my-tool' });
    registry.register(tool);
    expect(registry.get('my-tool')).toBe(tool);
  });

  test('register returns void', () => {
    const registry = new ToolRegistry();
    const result = registry.register(makeTool({ name: 'x' }));
    expect(result).toBeUndefined();
  });

  test('register is a public method', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    // No `private` modifier on register.
    const registerMatch = src.match(/register\s*\(tool:\s*Tool\)/);
    expect(registerMatch).not.toBeNull();
  });

  test('register replaces tool with same name (last-write-wins)', () => {
    const registry = new ToolRegistry();
    const first = makeTool({ name: 'shared', description: 'first' });
    const second = makeTool({ name: 'shared', description: 'second' });
    registry.register(first);
    registry.register(second);
    expect(registry.get('shared')).toBe(second);
    expect(registry.get('shared')?.description).toBe('second');
  });

  test('source documents last-write-wins behavior', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).toMatch(/silently\s+replaced/i);
    expect(src).toMatch(/last-write-wins/i);
  });

  test('register uses tool.name as the map key', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).toMatch(/this\.tools\.set\(tool\.name,\s*tool\)/);
  });

  test('register does NOT throw on duplicate name', () => {
    const registry = new ToolRegistry();
    expect(() => {
      registry.register(makeTool({ name: 'dup' }));
      registry.register(makeTool({ name: 'dup' }));
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// get() — lookup by name
// ---------------------------------------------------------------------------

describe('ToolRegistry — get() contract', () => {
  test('get returns Tool when name is registered', () => {
    const registry = new ToolRegistry();
    const tool = makeTool({ name: 'found' });
    registry.register(tool);
    expect(registry.get('found')).toBe(tool);
  });

  test('get returns undefined for unregistered name', () => {
    const registry = new ToolRegistry();
    expect(registry.get('not-registered')).toBeUndefined();
  });

  test('get returns undefined for empty registry', () => {
    const registry = new ToolRegistry();
    expect(registry.get('any')).toBeUndefined();
  });

  test('get returns the SAME Tool reference that was registered', () => {
    const registry = new ToolRegistry();
    const tool = makeTool({ name: 'same-ref' });
    registry.register(tool);
    expect(registry.get('same-ref')).toBe(tool);
  });

  test('source uses this.tools.get(name)', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).toMatch(/return\s+this\.tools\.get\(name\)/);
  });

  test('get return type is Tool | undefined', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).toMatch(/get\(name:\s*string\):\s*Tool\s*\|\s*undefined/);
  });
});

// ---------------------------------------------------------------------------
// listSpecs() — convert internal map to ToolSpec[]
// ---------------------------------------------------------------------------

describe('ToolRegistry — listSpecs() contract', () => {
  test('listSpecs returns empty array for empty registry', () => {
    const registry = new ToolRegistry();
    expect(registry.listSpecs()).toEqual([]);
  });

  test('listSpecs returns one spec per registered tool', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool({ name: 'a' }));
    registry.register(makeTool({ name: 'b' }));
    registry.register(makeTool({ name: 'c' }));
    expect(registry.listSpecs()).toHaveLength(3);
  });

  test("each spec has type='function'", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool({ name: 'a' }));
    const specs = registry.listSpecs();
    for (const spec of specs) {
      expect(spec.type).toBe('function');
    }
  });

  test('each spec.function has name, description, parameters', () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool({ name: 'my-tool', description: 'my description' }),
    );
    const specs = registry.listSpecs();
    expect(specs[0]!.function.name).toBe('my-tool');
    expect(specs[0]!.function.description).toBe('my description');
    expect(specs[0]!.function.parameters).toEqual({ type: 'object', properties: {} });
  });

  test('listSpecs returns a fresh array each call', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool({ name: 'x' }));
    const a = registry.listSpecs();
    const b = registry.listSpecs();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  test('listSpecs reflects registrations in real-time', () => {
    const registry = new ToolRegistry();
    expect(registry.listSpecs()).toHaveLength(0);
    registry.register(makeTool({ name: 'first' }));
    expect(registry.listSpecs()).toHaveLength(1);
    registry.register(makeTool({ name: 'second' }));
    expect(registry.listSpecs()).toHaveLength(2);
  });

  test('listSpecs does not include replaced tools twice', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool({ name: 'shared', description: 'first' }));
    registry.register(makeTool({ name: 'shared', description: 'second' }));
    expect(registry.listSpecs()).toHaveLength(1);
    expect(registry.listSpecs()[0]!.function.description).toBe('second');
  });

  test('source uses Array.from(this.tools.values()).map(...)', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).toMatch(/Array\.from\(this\.tools\.values\(\)\)\.map/);
  });

  test('source hardcodes type: "function" in listSpecs', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).toMatch(/type:\s*['"]function['"]/);
  });

  test('return type is ToolSpec[]', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).toMatch(/listSpecs\(\):\s*ToolSpec\[\]/);
  });
});

// ---------------------------------------------------------------------------
// mayMutate() — conservative mutation check
// ---------------------------------------------------------------------------

describe('ToolRegistry — mayMutate() contract', () => {
  test('returns false for unregistered tool', () => {
    const registry = new ToolRegistry();
    expect(registry.mayMutate('unknown', {})).toBe(false);
  });

  test("returns true when tool's mutates returns true", () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool({
        name: 'mutating',
        mutates: () => true,
      }),
    );
    expect(registry.mayMutate('mutating', {})).toBe(true);
  });

  test("returns false when tool's mutates returns false", () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool({
        name: 'read-only',
        mutates: () => false,
      }),
    );
    expect(registry.mayMutate('read-only', {})).toBe(false);
  });

  test("defaults to true when tool omits mutates() (conservative)", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool({ name: 'no-mutates-method' }));
    // Tool doesn't implement mutates — should default to true.
    expect(registry.mayMutate('no-mutates-method', {})).toBe(true);
  });

  test('passes args to mutates() function', () => {
    const registry = new ToolRegistry();
    let receivedArgs: Record<string, unknown> | null = null;
    registry.register(
      makeTool({
        name: 'passes-args',
        mutates: (args) => {
          receivedArgs = args;
          return false;
        },
      }),
    );
    const args = { path: '/some/file', content: 'data' };
    registry.mayMutate('passes-args', args);
    expect(receivedArgs).toBe(args);
  });

  test('mayMutate respects mutates() override per-call (args-dependent)', () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool({
        name: 'conditional',
        mutates: (args) => args.mutate === true,
      }),
    );
    expect(registry.mayMutate('conditional', { mutate: true })).toBe(true);
    expect(registry.mayMutate('conditional', { mutate: false })).toBe(false);
  });

  test("source documents 'unknown tools return false'", async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).toMatch(/Unknown tools return false/i);
  });

  test('source documents conservative default (true when omitted)', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).toMatch(/Conservative\s+default/i);
    expect(src).toMatch(/treated as mutating/i);
  });

  test('source uses ternary: tool.mutates ? tool.mutates(args) : true', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).toMatch(/return\s+tool\.mutates\s*\?\s*tool\.mutates\(args\)\s*:\s*true/);
  });

  test("source checks '!tool' first (returns false)", async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).toMatch(/if\s*\(\s*!tool\s*\)\s*return\s+false/);
  });
});

// ---------------------------------------------------------------------------
// dispatch() — error isolation contract (load-bearing)
// ---------------------------------------------------------------------------

describe('ToolRegistry — dispatch() contract', () => {
  test('dispatch returns ToolResult for unknown tool', async () => {
    const registry = new ToolRegistry();
    const result = await registry.dispatch('unknown', {}, { cwd: '/tmp' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Unknown tool: unknown');
    }
  });

  test('dispatch error message format: "Unknown tool: ${name}"', async () => {
    const registry = new ToolRegistry();
    const result = await registry.dispatch('nonexistent', {}, { cwd: '/tmp' });
    if (!result.ok) {
      expect(result.error).toMatch(/^Unknown tool:\s+nonexistent$/);
    }
  });

  test('dispatch returns tool result on success', async () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool({
        name: 'success-tool',
        execute: async () => ({ ok: true, value: 'success' }),
      }),
    );
    const result = await registry.dispatch('success-tool', {}, { cwd: '/tmp' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('success');
    }
  });

  test('dispatch catches Error thrown by execute', async () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool({
        name: 'throwing',
        execute: async () => {
          throw new Error('intentional-error');
        },
      }),
    );
    const result = await registry.dispatch('throwing', {}, { cwd: '/tmp' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('intentional-error');
    }
  });

  test('dispatch catches non-Error throws', async () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool({
        name: 'string-throw',
        execute: async () => {
          throw 'string-error';
        },
      }),
    );
    const result = await registry.dispatch('string-throw', {}, { cwd: '/tmp' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('string-error');
    }
  });

  test('dispatch catches null throws', async () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool({
        name: 'null-throw',
        execute: async () => {
          throw null;
        },
      }),
    );
    const result = await registry.dispatch('null-throw', {}, { cwd: '/tmp' });
    expect(result.ok).toBe(false);
  });

  test('dispatch NEVER throws (catches sync throws from execute)', async () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool({
        name: 'sync-throw',
        execute: (() => {
          throw new Error('sync-thrown');
        }) as never,
      }),
    );
    // The dispatch wrapper awaits execute(), so sync throws become
    // async rejections. The try/catch still catches them.
    const result = await registry.dispatch('sync-throw', {}, { cwd: '/tmp' });
    expect(result.ok).toBe(false);
  });

  test('dispatch passes args to execute', async () => {
    const registry = new ToolRegistry();
    let receivedArgs: Record<string, unknown> | null = null;
    registry.register(
      makeTool({
        name: 'args-tool',
        execute: async (args) => {
          receivedArgs = args;
          return { ok: true, value: 'ok' };
        },
      }),
    );
    await registry.dispatch('args-tool', { key: 'val' }, { cwd: '/tmp' });
    expect(receivedArgs).toEqual({ key: 'val' });
  });

  test('dispatch passes ctx to execute', async () => {
    const registry = new ToolRegistry();
    let receivedCwd: string | null = null;
    registry.register(
      makeTool({
        name: 'ctx-tool',
        execute: async (_args, ctx) => {
          receivedCwd = ctx.cwd;
          return { ok: true, value: 'ok' };
        },
      }),
    );
    await registry.dispatch('ctx-tool', {}, { cwd: '/custom/path' });
    expect(receivedCwd).toBe('/custom/path');
  });

  test('source wraps execute in try/catch', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).toMatch(/try\s*\{[\s\S]*?await\s+tool\.execute[\s\S]*?\}\s*catch/);
  });

  test('source converts Error to err.message', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).toMatch(/err\s+instanceof\s+Error\s*\?\s*err\.message\s*:\s*String\(err\)/);
  });

  test('source returns "Unknown tool: ${name}" for unknown', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).toMatch(/return\s*\{\s*ok:\s*false,\s*error:\s*`Unknown tool:\s*\$\{name\}`/);
  });

  test('dispatch return type is Promise<ToolResult>', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).toMatch(/dispatch\([\s\S]*?\):\s*Promise<ToolResult>/);
  });
});

// ---------------------------------------------------------------------------
// Registry does NOT mutate Tool objects
// ---------------------------------------------------------------------------

describe('ToolRegistry — does not mutate Tool objects', () => {
  test('register does not modify the tool object', () => {
    const registry = new ToolRegistry();
    const tool = makeTool({ name: 'preserved', description: 'original' });
    registry.register(tool);
    expect(tool.name).toBe('preserved');
    expect(tool.description).toBe('original');
    expect(tool.parameters).toEqual({ type: 'object', properties: {} });
  });

  test('get returns the same tool reference unchanged', () => {
    const registry = new ToolRegistry();
    const tool = makeTool({ name: 'x' });
    registry.register(tool);
    const retrieved = registry.get('x');
    expect(retrieved).toBe(tool);
    expect(retrieved?.name).toBe('x');
  });

  test('listSpecs creates new objects (does not return tool references)', () => {
    const registry = new ToolRegistry();
    const tool = makeTool({ name: 'spec-source' });
    registry.register(tool);
    const specs = registry.listSpecs();
    // The spec is a new object — not the tool itself.
    expect(specs[0]).not.toBe(tool);
    // But it carries the tool's name/description/parameters.
    expect(specs[0]!.function.name).toBe(tool.name);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('ToolRegistry — determinism', () => {
  test('get called twice returns same reference', () => {
    const registry = new ToolRegistry();
    const tool = makeTool({ name: 'det' });
    registry.register(tool);
    expect(registry.get('det')).toBe(registry.get('det'));
  });

  test('listSpecs called twice produces equal arrays', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool({ name: 'a' }));
    registry.register(makeTool({ name: 'b' }));
    const a = registry.listSpecs();
    const b = registry.listSpecs();
    expect(a).toEqual(b);
  });

  test('mayMutate called twice with same args returns same result', () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool({
        name: 'det-mutate',
        mutates: (args) => args.flag === true,
      }),
    );
    const args = { flag: true };
    expect(registry.mayMutate('det-mutate', args)).toBe(
      registry.mayMutate('det-mutate', args),
    );
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('ToolRegistry — edge cases', () => {
  test('registering empty-name tool is allowed (no validation)', () => {
    const registry = new ToolRegistry();
    const tool = makeTool({ name: '' });
    expect(() => registry.register(tool)).not.toThrow();
    expect(registry.get('')).toBe(tool);
  });

  test('dispatch with empty name returns "Unknown tool: "', async () => {
    const registry = new ToolRegistry();
    const result = await registry.dispatch('', {}, { cwd: '/tmp' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Unknown tool: ');
    }
  });

  test('mayMutate with empty name returns false (no such tool)', () => {
    const registry = new ToolRegistry();
    expect(registry.mayMutate('', {})).toBe(false);
  });

  test('listSpecs with empty registry returns empty array (not undefined)', () => {
    const registry = new ToolRegistry();
    const specs = registry.listSpecs();
    expect(specs).toEqual([]);
    expect(specs).not.toBeUndefined();
    expect(specs).not.toBeNull();
  });

  test('ToolRegistry can be instantiated with no constructor args', () => {
    expect(() => new ToolRegistry()).not.toThrow();
  });

  test('registering multiple tools with unique names', () => {
    const registry = new ToolRegistry();
    const toolA = makeTool({ name: 'a' });
    const toolB = makeTool({ name: 'b' });
    const toolC = makeTool({ name: 'c' });
    registry.register(toolA);
    registry.register(toolB);
    registry.register(toolC);
    expect(registry.get('a')).toBe(toolA);
    expect(registry.get('b')).toBe(toolB);
    expect(registry.get('c')).toBe(toolC);
    expect(registry.listSpecs()).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Method visibility — all public
// ---------------------------------------------------------------------------

describe('ToolRegistry — method visibility', () => {
  test('register is public', () => {
    const registry = new ToolRegistry();
    expect(typeof registry.register).toBe('function');
  });

  test('get is public', () => {
    const registry = new ToolRegistry();
    expect(typeof registry.get).toBe('function');
  });

  test('listSpecs is public', () => {
    const registry = new ToolRegistry();
    expect(typeof registry.listSpecs).toBe('function');
  });

  test('mayMutate is public', () => {
    const registry = new ToolRegistry();
    expect(typeof registry.mayMutate).toBe('function');
  });

  test('dispatch is public', () => {
    const registry = new ToolRegistry();
    expect(typeof registry.dispatch).toBe('function');
  });

  test('registry exposes exactly 5 public methods', () => {
    const registry = new ToolRegistry();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(registry))
      .filter((name) => name !== 'constructor' && typeof (registry as never as Record<string, unknown>)[name as never] === 'function');
    expect(methods.sort()).toEqual(['dispatch', 'get', 'listSpecs', 'mayMutate', 'register']);
  });
});

// ---------------------------------------------------------------------------
// Source-level — no side-channel leakage
// ---------------------------------------------------------------------------

describe('ToolRegistry — source-level security', () => {
  test('source does NOT call console.log/error/warn', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).not.toMatch(/console\./);
  });

  test('source does NOT write to process.stdout/stderr', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).not.toMatch(/process\.stdout/);
    expect(src).not.toMatch(/process\.stderr/);
  });

  test('source does NOT call process.exit', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).not.toMatch(/process\.exit/);
  });

  test('source does NOT import from cerebellum or agent layers', async () => {
    const src = await readFile('src/tools/registry.ts', 'utf8');
    expect(src).not.toMatch(/from\s*['"]\.\.\/cerebellum/);
    expect(src).not.toMatch(/from\s*['"]\.\.\/agent/);
    expect(src).not.toMatch(/from\s*['"]\.\.\/orchestrator/);
  });
});
