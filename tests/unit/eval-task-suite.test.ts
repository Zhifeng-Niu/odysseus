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
  // 30s timeout: orchestrator waypoints with real `tsc` verify passes run
  // multi-second under full-suite concurrency (same rationale as the
  // five-task suite below). Default 5s times out on loaded machines.
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
  }, 30000);

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

describe('runTaskSuite — 10-task capability (M3 acceptance)', () => {
  // Mixed difficulty at scale: 2 ts-cases pay real tsc verify; 8 non-ts
  // cases skip the syntax pass fast (no .ts changes → nothing to check).
  // Proves the harness scales to the ≥10 live baseline without timing out.
  test('ten mixed tasks → all succeed, summary scales', async () => {
    const cases: TaskCase[] = [];
    for (let i = 0; i < 10; i++) {
      const isTs = i === 0 || i === 5; // exactly two ts-cases
      const fileName = isTs ? `mod-${i}.ts` : `notes-${i}.md`;
      const marker = `payload-${i}`;
      // ts-cases must carry VALID TypeScript — the syntax layer correctly
      // rejects bare identifiers (this caught the test's own first draft).
      const content = isTs ? `export const payload${i} = '${marker}';\n` : `${marker}\n`;
      cases.push({
        id: `scale-${i}`,
        goal: `创建文件 ${fileName}，内容包含一行：${marker}`,
        steps: (root) => [
          writeStep(path.join(root, fileName), content),
          doneStep(),
        ],
        verify: (root) =>
          fs.readFileSync(path.join(root, fileName), 'utf8').includes(marker),
      });
    }
    const s = await runTaskSuite(cases);
    expect(s.total).toBe(10);
    expect(s.succeeded).toBe(10);
    expect(s.successRate).toBeCloseTo(1);
    expect(s.totalTokens).toBeGreaterThanOrEqual(15 * 20); // 2 steps × 15 tokens × 10
  }, 60000);
});

describe('runTaskSuite — life-domain tasks with artifact acceptance (M4)', () => {
  test('life tasks verify through the declared acceptance.json (not tsc)', async () => {
    const life = (id: string, file: string, marker: string): TaskCase => ({
      id,
      goal: `写 ${file}，内容包含「${marker}」`,
      verifyLayers: ['progress', 'artifact'],
      acceptance: { checks: [{ path: file, contains: marker }] },
      steps: (root) => [
        writeStep(path.join(root, file), `${marker}\n`),
        doneStep(),
      ],
      verify: (root) =>
        fs.readFileSync(path.join(root, file), 'utf8').includes(marker),
    });
    const cases: TaskCase[] = [
      life('life-weekly', 'weekly-report.md', '本周完成基线扩样'),
      life('life-expense', 'expenses.csv', '日期,金额,说明'),
      life('life-reminder', 'reminders.md', '提醒一：跑步'),
    ];
    const s = await runTaskSuite(cases);
    expect(s.total).toBe(3);
    expect(s.succeeded).toBe(3);
    expect(s.successRate).toBeCloseTo(1);
    // Fast: no tsc (non-ts files) — proves the artifact layer carries these.
  }, 60000);

  test('artifact miss fails a life task through the gate', async () => {
    const cases: TaskCase[] = [
      {
        id: 'life-miss',
        goal: 'write report.md with 周报',
        verifyLayers: ['progress', 'artifact'],
        acceptance: { checks: [{ path: 'report.md', contains: '周报' }] },
        steps: (root) => [
          writeStep(path.join(root, 'report.md'), '不相干的内容'),
          doneStep(),
        ],
        verify: () => false,
      },
    ];
    const s = await runTaskSuite(cases);
    expect(s.succeeded).toBe(0);
    expect(s.results[0]?.outcome).toBe('failure'); // artifact gate caught it
  });
});

describe('BASELINE_TASKS — M4 scale + life coverage', () => {
  test('has ≥15 tasks and every life task declares acceptance', async () => {
    const { BASELINE_TASKS } = await import('../../src/eval/baseline-tasks.js');
    expect(BASELINE_TASKS.length).toBeGreaterThanOrEqual(15);
    const lifeTasks = BASELINE_TASKS.filter((t) => t.acceptance !== undefined);
    expect(lifeTasks.length).toBeGreaterThanOrEqual(5);
    for (const task of lifeTasks) {
      expect(task.verifyLayers).toEqual(['progress', 'artifact']);
      expect((task.acceptance?.checks.length ?? 0)).toBeGreaterThan(0);
    }
  });
});
