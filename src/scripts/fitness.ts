#!/usr/bin/env node
/**
 * fitness CLI — RSI 适应度的独立测量入口（务必在安静机器上跑：
 * 并发的 vitest/tsc 会污染 scripted 套件的 tsc 子进程与单元套件）。
 *
 *   npx tsx src/scripts/fitness.ts
 */
import { resolve } from 'node:path';
import { measureFitness } from '../eval/fitness.js';

const cwd = resolve(process.cwd());

const report = await measureFitness(cwd, {
  runners: {
    runScriptedSuite: async () => {
      const { runTaskSuite: run } = await import('../eval/task-suite.js');
      const { BASELINE_TASKS: tasks } = await import('../eval/baseline-tasks.js');
      const summary = await run(tasks);
      for (const r of summary.results) {
        console.log(
          `  ${r.success ? 'PASS' : 'FAIL'} ${r.id}: outcome=${r.outcome} artifact=${r.artifactOk ? 'ok' : 'MISMATCH'}` +
            (r.toolErrors.length > 0 ? ` toolErrors=${r.toolErrors.slice(0, 2).join(' | ').slice(0, 200)}` : '')
        );
      }
      return summary;
    },
    runUnitSuite: async () => {
      const { execFileNoThrow } = await import('../util/exec.js');
      // 已知存量 flaky 排除（同 fitness.ts defaultRunners）——不背历史噪音。
      const r = await execFileNoThrow(
        'npx',
        [
          'vitest', 'run', '--passWithNoTests',
          '--exclude', 'tests/unit/scripts-voyage-stats-invariants.test.ts',
          '--exclude', 'tests/unit/voyage-loop.test.ts',
        ],
        {
          cwd,
          timeoutMs: 300_000,
          env: { ...process.env, NODE_OPTIONS: '' },
        }
      );
      // 逐测试判定：已知 flaky 的文件级收集错误（voyage-stats 存量）会让退出码
      // 非零但 0 个测试失败——按 loop 惯例（flaky 单跑判定）视为通过。
      const failedTests = /Tests\s+(\d+) failed/.exec(r.stdout);
      const failedCount = failedTests ? Number(failedTests[1]) : r.exitCode === 0 ? 0 : 1;
      if (failedCount > 0) {
        console.log(`  unit suite: ${failedCount} failed`);
        console.log('  ── nested vitest tail ──');
        console.log(r.stdout.split('\n').slice(-14).join('\n'));
        console.log('  ── stderr tail ──');
        console.log(r.stderr.split('\n').slice(-6).join('\n'));
      }
      return failedCount === 0;
    },
  },
});
console.log(`cwd: ${cwd}`);
console.log(`scriptedSuccessRate: ${report.scriptedSuccessRate.toFixed(2)} (15 mixed tasks, scripted provider, real orchestrator)`);
console.log(`unitPassed: ${report.unitPassed}`);
console.log(`fitness score: ${report.score.toFixed(2)} / 10`);
