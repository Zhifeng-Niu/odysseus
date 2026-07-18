import { describe, test, expect } from 'vitest';
import { buildSystemPrompt } from '../../src/agent/prompt.js';
import { AgentContext } from '../../src/agent/context.js';

describe('agent layer', () => {
  test('buildSystemPrompt includes mission and tool list', () => {
    const prompt = buildSystemPrompt({
      mission: 'Iterate on Odysseus spike',
      availableTools: ['file-read', 'file-write', 'file-edit', 'git'],
    });
    expect(prompt).toContain('Odysseus');
    expect(prompt).toContain('file-read');
    expect(prompt).toContain('file-write');
  });

  test('AgentContext stores and retrieves messages', () => {
    const ctx = new AgentContext({ mission: 'test' });
    ctx.append({ role: 'user', content: 'hi' });
    ctx.append({ role: 'assistant', content: 'hello' });
    const messages = ctx.messages();
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'user', content: 'hi' });
  });

  test('AgentContext does not mutate underlying array on append', () => {
    const ctx = new AgentContext({ mission: 'test' });
    ctx.append({ role: 'user', content: 'a' });
    const before = ctx.messages();
    ctx.append({ role: 'user', content: 'b' });
    expect(before).toHaveLength(1);
    expect(ctx.messages()).toHaveLength(2);
  });
});
