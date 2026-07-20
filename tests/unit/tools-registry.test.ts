import { describe, test, expect } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { Tool, ToolContext, ToolResult } from '../../src/tools/types.js';

/**
 * registry.ts — the agent's tool dispatch surface.
 *
 * Iteration 27 — the registry had no dedicated test file. Its contract
 * was exercised only indirectly via the orchestrator integration suite.
 * That suite covers the happy path (tools are registered at boot and
 * dispatched during a voyage), but it does NOT pin the edge cases that
 * matter for safety:
 *
 * - The conservative default of `mayMutate` (returns true when a tool
 *   omits the `mutates` predicate). If anyone flipped this default to
 *   false, every read-only tool that forgot to override would silently
 *   skip its checkpoint — the orchestrator would then roll the un-
 *   checkpointed mutation back on failure. This test file is what makes
 *   that regression visible.
 *
 * - The exception-swallowing behavior of `dispatch`. A thrown tool
 *   must surface as `{ ok: false, error }`, not propagate — the
 *   orchestrator's caller assumes dispatch never throws. If dispatch
 *   started letting exceptions through, a single buggy tool would crash
 *   the whole voyage loop.
 *
 * - The OpenAI function-call shape from `listSpecs`. The LLM provider
 *   consumes this array verbatim. A shape change (e.g. dropping the
 *   `type: 'function'` wrapper) would silently break tool-use at the
 *   model boundary.
 */

// ---------------------------------------------------------------------------
// Helpers — minimal tool implementations for the registry tests. We inline
// these instead of importing the real file/bash/git tools so the registry
// tests stay focused on registry behavior, not on any specific tool's I/O.
// ---------------------------------------------------------------------------

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: 'echo',
    description: 'returns the args as a string',
    parameters: { type: 'object', properties: {} },
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      return { ok: true, value: JSON.stringify(args) };
    },
    ...overrides,
  };
}

const ctx: ToolContext = { cwd: '/tmp' };

// ---------------------------------------------------------------------------
// register / get
// ---------------------------------------------------------------------------

describe('ToolRegistry — register + get', () => {
  test('register makes a tool retrievable by name', () => {
    const reg = new ToolRegistry();
    const tool = makeTool();
    reg.register(tool);
    expect(reg.get('echo')).toBe(tool);
  });

  test('get returns undefined for an unregistered name', () => {
    const reg = new ToolRegistry();
    expect(reg.get('nope')).toBeUndefined();
  });

  test('register with a duplicate name silently replaces (last-write-wins)', () => {
    // Documented in registry.ts: callers are responsible for avoiding
    // unintended shadowing. The registry itself does not warn. If this
    // behavior changed to throw, boot-time tool wiring would break.
    const reg = new ToolRegistry();
    const v1 = makeTool({ name: 'dup', description: 'first' });
    const v2 = makeTool({ name: 'dup', description: 'second' });
    reg.register(v1);
    reg.register(v2);
    expect(reg.get('dup')).toBe(v2);
    expect(reg.get('dup')?.description).toBe('second');
  });

  test('register preserves tool identity (same reference returned by get)', () => {
    // The registry must NOT clone — tools carry closures over captured
    // state (e.g. the agent's working directory). A clone would drop
    // that state and silently break tool execution.
    const reg = new ToolRegistry();
    const tool = makeTool();
    reg.register(tool);
    expect(reg.get(tool.name)).toBe(tool);
  });
});

// ---------------------------------------------------------------------------
// listSpecs — OpenAI function-call shape
// ---------------------------------------------------------------------------

describe('ToolRegistry — listSpecs', () => {
  test('returns empty array when no tools are registered', () => {
    const reg = new ToolRegistry();
    expect(reg.listSpecs()).toEqual([]);
  });

  test('wraps each tool in the OpenAI function-call envelope', () => {
    // The provider hands this array directly to the LLM. If the shape
    // drifts (missing `type: 'function'`, nested fields renamed), the
    // model will silently stop calling tools. Pin the exact envelope.
    const reg = new ToolRegistry();
    reg.register(
      makeTool({
        name: 'read',
        description: 'reads a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      })
    );
    const specs = reg.listSpecs();
    expect(specs).toHaveLength(1);
    expect(specs[0]).toEqual({
      type: 'function',
      function: {
        name: 'read',
        description: 'reads a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    });
  });

  test('returns specs for every registered tool, not just one', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool({ name: 'a' }));
    reg.register(makeTool({ name: 'b' }));
    reg.register(makeTool({ name: 'c' }));
    const names = reg.listSpecs().map((s) => s.function.name);
    expect(names.sort()).toEqual(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// mayMutate — conservative default + delegate
// ---------------------------------------------------------------------------

describe('ToolRegistry — mayMutate', () => {
  test('returns false for an unknown tool', () => {
    // The orchestrator's lazy-checkpoint path calls mayMutate before
    // dispatch. Unknown tools never reach this branch at runtime
    // (dispatch rejects them first), but the contract is still "false":
    // we don't pay the checkpoint cost for a name we can't resolve.
    const reg = new ToolRegistry();
    expect(reg.mayMutate('ghost', {})).toBe(false);
  });

  test('returns true for a registered tool that omits the mutates predicate (conservative default)', () => {
    // This is the load-bearing default. Flipping it would silently skip
    // checkpoints for any tool that forgot to declare mutates.
    const reg = new ToolRegistry();
    reg.register(makeTool({ name: 'writer' }));
    expect(reg.mayMutate('writer', {})).toBe(true);
  });

  test('delegates to tool.mutates when provided', () => {
    const mutates = (args: Record<string, unknown>): boolean => args.dryRun !== true;
    const reg = new ToolRegistry();
    reg.register(makeTool({ name: 'git', mutates }));
    expect(reg.mayMutate('git', { dryRun: true })).toBe(false);
    expect(reg.mayMutate('git', { dryRun: false })).toBe(true);
    expect(reg.mayMutate('git', {})).toBe(true);
  });

  test('passes args verbatim to the mutates predicate', () => {
    // The predicate sees exactly what dispatch will see. If the registry
    // ever started cloning or normalizing args, read-only detection would
    // silently desync from actual execution.
    let observed: Record<string, unknown> | null = null;
    reg_with_observer();
    function reg_with_observer() {
      const r = new ToolRegistry();
      r.register(
        makeTool({
          name: 'observed',
          mutates: (args) => {
            observed = args;
            return false;
          },
        })
      );
      r.mayMutate('observed', { foo: 'bar', nested: { x: 1 } });
    }
    expect(observed).toEqual({ foo: 'bar', nested: { x: 1 } });
  });
});

// ---------------------------------------------------------------------------
// dispatch — the boundary that never throws
// ---------------------------------------------------------------------------

describe('ToolRegistry — dispatch', () => {
  test('returns ok:true with the tool value on success', async () => {
    const reg = new ToolRegistry();
    reg.register(makeTool({ name: 'echo' }));
    const result = await reg.dispatch('echo', { msg: 'hi' }, ctx);
    expect(result).toEqual({ ok: true, value: JSON.stringify({ msg: 'hi' }) });
  });

  test('returns ok:false with "Unknown tool: <name>" for unregistered name', async () => {
    const reg = new ToolRegistry();
    const result = await reg.dispatch('ghost', {}, ctx);
    expect(result).toEqual({ ok: false, error: 'Unknown tool: ghost' });
  });

  test('passes through ok:false results from the tool (does not rewrite them)', async () => {
    // Tools signal domain errors by returning ok:false. The registry
    // must NOT convert these into a different shape — the error message
    // is the tool's contract with its caller.
    const reg = new ToolRegistry();
    reg.register(
      makeTool({
        name: 'fail',
        async execute() {
          return { ok: false, error: 'File not found: /etc/shadow' };
        },
      })
    );
    const result = await reg.dispatch('fail', {}, ctx);
    expect(result).toEqual({ ok: false, error: 'File not found: /etc/shadow' });
  });

  test('catches thrown Error and wraps it as ok:false with the message', async () => {
    // The boundary contract: dispatch NEVER throws. A buggy tool that
    // forgets to return ok:false and just throws must still produce a
    // ToolResultErr. Without this, the orchestrator would need its own
    // try/catch around every dispatch — defeating the abstraction.
    const reg = new ToolRegistry();
    reg.register(
      makeTool({
        name: 'throwy',
        async execute() {
          throw new Error('kaboom');
        },
      })
    );
    const result = await reg.dispatch('throwy', {}, ctx);
    expect(result).toEqual({ ok: false, error: 'kaboom' });
  });

  test('catches thrown non-Error value and stringifies it', async () => {
    // Some library code throws strings or plain objects. The registry's
    // catch must handle both — `String(err)` covers strings, numbers,
    // and arbitrary objects.
    const reg = new ToolRegistry();
    reg.register(
      makeTool({
        name: 'stringThrow',
        async execute() {
          // eslint-disable-next-line no-throw-literal
          throw 'string error';
        },
      })
    );
    const result = await reg.dispatch('stringThrow', {}, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('string error');
    }
  });

  test('passes ctx through to the tool', async () => {
    // The ctx argument carries cwd/env/signal. If dispatch ever started
    // rebuilding ctx (e.g. stripping env), tools would silently see a
    // different environment than the orchestrator intended.
    const reg = new ToolRegistry();
    let observedCtx: ToolContext | null = null;
    reg.register(
      makeTool({
        name: 'ctxProbe',
        async execute(_args, c) {
          observedCtx = c;
          return { ok: true, value: '' };
        },
      })
    );
    const customCtx: ToolContext = { cwd: '/custom/path', env: { FOO: 'bar' } };
    await reg.dispatch('ctxProbe', {}, customCtx);
    expect(observedCtx).toBe(customCtx);
  });
});
