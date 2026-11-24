/**
 * M1 fitness 函数 — RSI 的适应度度量衡。
 *
 * score 合成：scripted 任务套件成功率（确定性度量编排器/工具机器自身——
 * scripted provider 驱动真实 orchestrator + tools + verify，自改触及任何
 * 机器组件都会反映在成功率上）×8 + 单元套件绿灯 ×2 → 0-10。
 *
 * 单调性是 RSI 曲线的数学前提：成功率升 ⇒ score 升。
 * runners 可注入：测试零子进程零网络零 live；真实 runner 由 scripts 接。
 */
import type { TaskSuiteSummary } from './task-suite.js';

export interface FitnessRunners {
  runScriptedSuite(): Promise<Pick<TaskSuiteSummary, 'total' | 'succeeded' | 'successRate'>>;
  runUnitSuite(): Promise<boolean>;
}

export interface FitnessReport {
  readonly scriptedSuccessRate: number;
  readonly unitPassed: boolean;
  /** 8 × scriptedSuccessRate + 2 × unitPassed → 0-10，单调于成功率。 */
  readonly score: number;
}

export interface FitnessOptions {
  /** 注入 runners（测试）；缺省跑真实 scripted 套件 + 单元套件。 */
  readonly runners?: FitnessRunners;
}

export async function measureFitness(
  cwd: string,
  options: FitnessOptions = {}
): Promise<FitnessReport> {
  void cwd; // 预留：未来 fitness 可含 cwd 特定探针；当前任务集与 cwd 无关

  const runners = options.runners ?? defaultRunners();
  const suite = await runners.runScriptedSuite();
  const unitPassed = await runners.runUnitSuite();

  const scriptedSuccessRate =
    suite.total > 0 ? suite.succeeded / suite.total : 0;
  const score = 8 * scriptedSuccessRate + (unitPassed ? 2 : 0);

  return { scriptedSuccessRate, unitPassed, score };
}

function defaultRunners(): FitnessRunners {
  return {
    runScriptedSuite: async () => {
      // 循环引用规避：task-suite ↔ fitness 不互相 import 运行时符号，
      // dynamic import 保延迟加载。
      const { runTaskSuite: run } = await import('./task-suite.js');
      const { BASELINE_TASKS: tasks } = await import('./baseline-tasks.js');
      return run(tasks);
    },
    runUnitSuite: async () => {
      const { execFileNoThrow } = await import('../util/exec.js');
      const r = await execFileNoThrow('npx', ['vitest', 'run', '--passWithNoTests'], {
        cwd: process.cwd(),
        timeoutMs: 180_000,
      });
      return r.exitCode === 0;
    },
  };
}

// 类型再导出：scripts 侧（self-improve）引用同一形状，避免散落定义。
export type { TaskSuiteSummary };
