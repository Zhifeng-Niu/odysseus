import { describe, test, expect } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { Tool, ToolContext, ToolResult } from '../../src/tools/types.js';

const makeTool = (name: string, result: string): Tool => ({
  name,
  description: `${name} tool`,
  parameters: {
    type: 'object',
    properties: { input: { type: 'string' } },
    required: ['input'],
  },
  async execute(_args: { input: string }, _ctx: ToolContext): Promise<ToolResult> {
    return { ok: true, value: result };
  },
});

describe('ToolRegistry', () => {
  test('register and dispatch by name', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('echo', 'echoed'));

    const result = await registry.dispatch('echo', { input: 'hi' }, { cwd: '/tmp' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('echoed');
  });

  test('unknown tool returns error result', async () => {
    const registry = new ToolRegistry();
    const result = await registry.dispatch('missing', {}, { cwd: '/tmp' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unknown tool/i);
  });

  test('list returns tool specs for LLM', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('echo', 'x'));
    registry.register(makeTool('cat', 'y'));

    const specs = registry.listSpecs();
    expect(specs).toHaveLength(2);
    expect(specs[0]).toEqual({
      type: 'function',
      function: {
        name: 'echo',
        description: 'echo tool',
        parameters: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] },
      },
    });
  });

  test('dispatch catches tool errors and returns structured error', async () => {
    const registry = new ToolRegistry();
    const failing: Tool = {
      name: 'fail',
      description: 'always fails',
      parameters: { type: 'object', properties: {} },
      async execute() {
        throw new Error('boom');
      },
    };
    registry.register(failing);

    const result = await registry.dispatch('fail', {}, { cwd: '/tmp' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('boom');
  });
});
