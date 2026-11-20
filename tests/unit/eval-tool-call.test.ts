/**
 * P0 评测层 — rule-based function-calling verdicts (IBM ai-agent-evaluation
 * metric family: wrong name / malformed json / hallucinated param /
 * missing param / wrong type / disallowed value). Pure functions over a
 * (name, argsJson) pair + ToolSpec list — no LLM, no network, deterministic.
 */
import { describe, test, expect } from 'vitest';
import { evaluateToolCall, summarizeToolCalls } from '../../src/eval/tool-call-eval.js';
import type { ToolSpec } from '../../src/llm/provider.js';

const SPECS: readonly ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'file-write',
      description: 'write a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
          mode: { type: 'string', enum: ['overwrite', 'append'] },
          retries: { type: 'integer' },
        },
        required: ['path', 'content'],
      },
    },
  },
];

describe('evaluateToolCall — five rule verdicts + ok', () => {
  test('ok: well-formed call matching the schema', () => {
    const args = JSON.stringify({ path: 'a.ts', content: 'x', mode: 'append', retries: 2 });
    expect(evaluateToolCall('file-write', args, SPECS)).toBe('ok');
  });

  test('wrong-name: tool not in specs', () => {
    expect(evaluateToolCall('file-wriet', '{}', SPECS)).toBe('wrong-name');
  });

  test('malformed-json: arguments not parseable', () => {
    expect(evaluateToolCall('file-write', '{path:}', SPECS)).toBe('malformed-json');
  });

  test('hallucinated-param: key absent from schema properties', () => {
    const args = JSON.stringify({ path: 'a', content: 'b', encoding: 'utf8' });
    expect(evaluateToolCall('file-write', args, SPECS)).toBe('hallucinated-param');
  });

  test('missing-param: required key absent', () => {
    expect(evaluateToolCall('file-write', JSON.stringify({ path: 'a' }), SPECS)).toBe('missing-param');
  });

  test('wrong-type: integer param receives a string', () => {
    const args = JSON.stringify({ path: 'a', content: 'b', retries: 'two' });
    expect(evaluateToolCall('file-write', args, SPECS)).toBe('wrong-type');
  });

  test('disallowed-value: enum violation', () => {
    const args = JSON.stringify({ path: 'a', content: 'b', mode: 'truncate' });
    expect(evaluateToolCall('file-write', args, SPECS)).toBe('disallowed-value');
  });

  test('verdict precedence: wrong-name wins over malformed json', () => {
    expect(evaluateToolCall('nope', '{bad', SPECS)).toBe('wrong-name');
  });
});

describe('summarizeToolCalls — counts and rates', () => {
  test('aggregates counts, per-verdict rates, and error rate', () => {
    const verdicts = ['ok', 'ok', 'wrong-name', 'missing-param'] as const;
    const s = summarizeToolCalls(verdicts);
    expect(s.total).toBe(4);
    expect(s.counts['ok']).toBe(2);
    expect(s.counts['wrong-name']).toBe(1);
    expect(s.rates['wrong-name']).toBeCloseTo(0.25);
    expect(s.errorRate).toBeCloseTo(0.5); // non-ok share
  });

  test('zero total yields zero rates, no NaN', () => {
    const s = summarizeToolCalls([]);
    expect(s.total).toBe(0);
    expect(s.errorRate).toBe(0);
    expect(s.rates['ok']).toBe(0);
  });
});
