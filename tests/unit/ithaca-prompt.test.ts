/**
 * Ithaca prompt injection — protected core reaches every reasoning turn.
 *
 * The protected core is the user's task stack / values / identity. It must
 * ride along with the system prompt (after the mission line) whenever
 * non-empty, and never inject anything when empty.
 */

import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../src/agent/prompt.js';

const ITHACA_BLOCK = 'ITHACA CORE — 用户的任务栈与锚点\n任务栈:\n- 论文周五截止';

describe('buildSystemPrompt — ithaca injection', () => {
  it('injects the ithaca block after the mission when provided', () => {
    const prompt = buildSystemPrompt({
      mission: 'iterate on the spike',
      availableTools: ['bash'],
      ithaca: ITHACA_BLOCK,
    });
    expect(prompt).toContain('ITHACA CORE');
    expect(prompt).toContain('论文周五截止');
    expect(prompt.indexOf('ITHACA CORE')).toBeGreaterThan(prompt.indexOf('Your mission'));
  });

  it('injects nothing when ithaca is absent', () => {
    const prompt = buildSystemPrompt({ mission: 'iterate on the spike', availableTools: [] });
    expect(prompt).not.toContain('ITHACA CORE');
  });

  it('injects nothing when ithaca is an empty string', () => {
    const prompt = buildSystemPrompt({
      mission: 'iterate on the spike',
      availableTools: [],
      ithaca: '',
    });
    expect(prompt).not.toContain('ITHACA CORE');
  });
});
