/**
 * P0 评测层 — batched task suite over the REAL orchestrator with scripted
 * providers: success rate / error rate / token cost / latency per suite.
 * Mirrors the e2e-task-completion fixture patterns (proven deterministic).
 */
import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runTaskSuite, type TaskCase } from '../../src/eval/task-suite.js';
import type { LLMCompletion } from '../../src/llm/provider.js';

let callSeq = 0;
function writeStep(filePath: string, content: string): LLMCompletion {
  callSeq += 1;
  return {
    content: '',
    model: 'scripted',
    usage: { inputTokens: 10, outputTokens: 5 },
    finishReason: 'tool_calls',
    toolCalls: [
      {
        id: `call_${callSeq}`,
        type: 'function',
        function: { name: 'file-write', arguments: JSON.stringify({ path: filePath, content }) },
      },
    ],
  };
}

function doneStep(): LLMCompletion {
  return {
    content: 'DONE',
    model: 'scripted',
    usage: { inputTokens: 10, outputTokens: 5 },
    finishReason: 'stop',
  };
}

describe('runTaskSuite — batched task-completion metrics', () => {
  test('1 success + 1 verify-failure case → rates, tokens, latency, per-case fields', async () => {
    const cases: readonly TaskCase[] = [
      {
        id: 't1-good-write',
        goal: 'create good.ts exporting ok = true',
        steps: (root) => [
          writeStep(path.join(root, 'good.ts'), 'export const ok = true;'),
          doneStep(),
        ],
        verify: (root) =>
          fs.readFileSync(path.join(root, 'good.ts'), 'utf8').includes('export const ok = true;'),
      },
      {
        id: 't2-broken-write',
        goal: 'create intentionally broken code',
        steps: (root) => [
          writeStep(path.join(root, 'broken.ts'), 'export const v: number = "type error";'),
          doneStep(),
        ],
        verify: () => false,
      },
    ];

    const s = await runTaskSuite(cases);

    expect(s.results.map((r) => r.id)).toEqual(['t1-good-write', 't2-broken-write']);
    expect(s.total).toBe(2);
    expect(s.succeeded).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.successRate).toBeCloseTo(0.5);
    expect(s.errorRate).toBeCloseTo(0.5);
    expect(s.totalTokens).toBeGreaterThan(0);
    expect(s.avgLatencyMs).toBeGreaterThanOrEqual(0);

    expect(s.results[0]?.outcome).toBe('success');
    expect(s.results[0]?.success).toBe(true);
    expect(s.results[0]?.tokens).toBeGreaterThan(0);
    expect(s.results[1]?.outcome).toBe('failure'); // syntax verify rejects the broken file
    expect(s.results[1]?.success).toBe(false);
  });

  test('empty suite → zeroed summary, no NaN', async () => {
    const s = await runTaskSuite([]);
    expect(s.total).toBe(0);
    expect(s.successRate).toBe(0);
    expect(s.errorRate).toBe(0);
    expect(s.avgLatencyMs).toBe(0);
    expect(s.totalTokens).toBe(0);
  });
});
