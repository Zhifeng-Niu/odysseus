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

  // 30s timeout: this single test runs five orchestrator waypoints serially,
  // each paying a real `tsc` syntax-verify pass (~1s apiece warm, multi-second
  // under full-suite concurrency). The default 5s budget times out on loaded
  // machines (observed in the concurrent full-suite run).
  test('five-task mixed suite (P0 acceptance: ≥5 tasks) → 3/5 success', async () => {
    const cases: readonly TaskCase[] = [
      {
        id: 'm1-single-write',
        goal: 'create one module',
        steps: (root) => [
          writeStep(path.join(root, 'm1.ts'), 'export const m1 = 1;'),
          doneStep(),
        ],
        verify: (root) => fs.existsSync(path.join(root, 'm1.ts')),
      },
      {
        id: 'm2-two-writes',
        goal: 'create two modules',
        steps: (root) => [
          writeStep(path.join(root, 'a.ts'), 'export const a = 1;'),
          writeStep(path.join(root, 'b.ts'), 'export const b = 2;'),
          doneStep(),
        ],
        verify: (root) =>
          fs.existsSync(path.join(root, 'a.ts')) && fs.existsSync(path.join(root, 'b.ts')),
      },
      {
        id: 'm3-read-then-write',
        goal: 'overwrite existing file with new content',
        steps: (root) => [
          writeStep(path.join(root, 'c.ts'), 'export const c = 1;'),
          writeStep(path.join(root, 'c.ts'), 'export const c = 99;'),
          doneStep(),
        ],
        verify: (root) =>
          fs.readFileSync(path.join(root, 'c.ts'), 'utf8').includes('export const c = 99;'),
      },
      {
        id: 'm4-type-error',
        goal: 'create intentionally broken module',
        steps: (root) => [
          writeStep(path.join(root, 'm4.ts'), 'export const x: number = "oops";'),
          doneStep(),
        ],
        verify: () => true, // outcome already 'failure' via syntax verify
      },
      {
        id: 'm5-wrong-artifact',
        goal: 'create final.ts',
        steps: (root) => [
          writeStep(path.join(root, 'other.ts'), 'export const other = true;'),
          doneStep(),
        ],
        verify: (root) => fs.existsSync(path.join(root, 'final.ts')), // artifact never created
      },
    ];

    const s = await runTaskSuite(cases);
    expect(s.total).toBe(5); // program.md P0 acceptance line
    expect(s.succeeded).toBe(3);
    expect(s.failed).toBe(2);
    expect(s.successRate).toBeCloseTo(0.6);
    expect(s.errorRate).toBeCloseTo(0.4);
    expect(s.results.map((r) => r.success)).toEqual([true, true, true, false, false]);
    expect(s.results[3]?.outcome).toBe('failure');
    expect(s.results[4]?.outcome).toBe('success'); // waypoint "succeeded"…
    expect(s.results[4]?.artifactOk).toBe(false); // …but artifact check rejects it
    expect(s.totalTokens).toBeGreaterThanOrEqual(15 * 5); // every step bills 15 tokens
  }, 30000);
});
