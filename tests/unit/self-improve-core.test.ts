/**
 * M2 RSI runner 核心 — 控制面守卫 + 留优汰劣状态机（依赖全注入）。
 *
 * RSI 安全的第一道闸：自改航点的 diff 若触及控制面
 * （src/cerebellum/orchestrator.ts 及其 dist 产物）→ 强制回滚，无论
 * fitness 多高。能力可改，控制面不可改——「递归自我改进但永不越神」。
 */
import { describe, test, expect } from 'vitest';
import { guardControlPlane } from '../../src/eval/control-plane.js';
import { runSelfImprovementCycle, type SelfImproveDeps } from '../../src/eval/self-improve-core.js';

describe('guardControlPlane — 控制面守卫', () => {
  test('src/cerebellum/orchestrator.ts → blocked', () => {
    const r = guardControlPlane(['src/eval/fitness.ts', 'src/cerebellum/orchestrator.ts']);
    expect(r.blocked).toBe(true);
    expect(r.violations).toContain('src/cerebellum/orchestrator.ts');
  });

  test('dist 编译产物同样受控（dist 已入库，绕过 src 直改 dist 也得挡）', () => {
    const r = guardControlPlane(['dist/cerebellum/orchestrator.js']);
    expect(r.blocked).toBe(true);
  });

  test('普通能力文件 → 放行', () => {
    const r = guardControlPlane(['src/eval/fitness.ts', 'src/tools/bash.ts', 'tests/unit/x.test.ts']);
    expect(r.blocked).toBe(false);
    expect(r.violations).toHaveLength(0);
  });

  test('空 diff → 放行', () => {
    expect(guardControlPlane([]).blocked).toBe(false);
  });
});

// ─── runSelfImprovementCycle — 留优汰劣状态机（deps 全注入）──────────────

interface CycleFixture {
  waypointOutcome: 'success' | 'failure';
  changedFiles: string[];
  fitnessBefore: number;
  fitnessAfter: number;
}

function makeDeps(fx: CycleFixture): {
  deps: SelfImproveDeps;
  reverted: { called: boolean };
  waypointGoal: string | null;
} {
  const reverted = { called: false };
  const waypointGoal: { v: string | null } = { v: null };
  const deps: SelfImproveDeps = {
    runWaypoint: async (goal: string) => {
      waypointGoal.v = goal;
      return { outcome: fx.waypointOutcome, iterationsUsed: 2, failReason: undefined };
    },
    changedFilesSinceCheckpoint: async () => fx.changedFiles,
    revertToCheckpoint: async () => {
      reverted.called = true;
    },
    measure: async () => 0,
  };
  const measure = async (phase: 'before' | 'after'): Promise<number> =>
    phase === 'before' ? fx.fitnessBefore : fx.fitnessAfter;
  // wrap deps.measure to route phases
  let phase: 'before' | 'after' = 'before';
  const depsWithPhases: SelfImproveDeps = {
    ...deps,
    measure: async () => {
      const value = measure(phase);
      phase = phase === 'before' ? 'after' : phase;
      return value;
    },
  };
  return { deps: depsWithPhases, reverted, waypointGoal: waypointGoal.v };
}

describe('runSelfImprovementCycle — 留优汰劣', () => {
  test('改进（delta>0，普通文件）→ keep，不回滚', async () => {
    const fx: CycleFixture = {
      waypointOutcome: 'success',
      changedFiles: ['src/eval/fitness.ts'],
      fitnessBefore: 8.0,
      fitnessAfter: 9.0,
    };
    const { deps, reverted } = makeDeps(fx);
    const r = await runSelfImprovementCycle('改进目标', deps, { controlPlane: true });
    expect(r.verdict).toBe('improved');
    expect(r.delta).toBeCloseTo(1.0);
    expect(reverted.called).toBe(false);
  });

  test('恶化（delta<0）→ 强制回滚 + verdict worse', async () => {
    const fx: CycleFixture = {
      waypointOutcome: 'success',
      changedFiles: ['src/eval/fitness.ts'],
      fitnessBefore: 9.0,
      fitnessAfter: 7.5,
    };
    const { deps, reverted } = makeDeps(fx);
    const r = await runSelfImprovementCycle('恶化目标', deps, { controlPlane: true });
    expect(r.verdict).toBe('worse');
    expect(r.delta).toBeCloseTo(-1.5);
    expect(reverted.called).toBe(true);
  });

  test('触及控制面 → 无论 fitness 多高都回滚 + verdict control-plane-rejected', async () => {
    const fx: CycleFixture = {
      waypointOutcome: 'success',
      changedFiles: ['src/cerebellum/orchestrator.ts'],
      fitnessBefore: 8.0,
      fitnessAfter: 10.0,
    };
    const { deps, reverted } = makeDeps(fx);
    const r = await runSelfImprovementCycle('偷偷改控制面', deps, { controlPlane: true });
    expect(r.verdict).toBe('control-plane-rejected');
    expect(reverted.called).toBe(true);
    expect(r.delta).toBeUndefined();
  });

  test('航点失败 → verdict failure，回滚保险执行', async () => {
    const fx: CycleFixture = {
      waypointOutcome: 'failure',
      changedFiles: [],
      fitnessBefore: 8.0,
      fitnessAfter: 8.0,
    };
    const { deps, reverted } = makeDeps(fx);
    const r = await runSelfImprovementCycle('失败目标', deps, { controlPlane: true });
    expect(r.verdict).toBe('failure');
    expect(r.delta).toBeUndefined();
    expect(reverted.called).toBe(true);
  });
});
