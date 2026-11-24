/**
 * M1 fitness 函数 — RSI 的适应度度量衡。
 *
 * measureFitness(cwd, {runners?}) 返回复合适应度：scripted 任务套件成功率
 * （确定性度量编排器/工具机器自身——scripted provider 驱动真实 orchestrator，
 * 自改触及任何机器组件都会反映在成功率上）+ 单元套件绿灯。score 0-10。
 * runners 可注入 → 测试零子进程零网络零 live。
 */
import { describe, test, expect } from 'vitest';
import { measureFitness, type FitnessRunners } from '../../src/eval/fitness.js';

function fakeRunners(successRate: number, unitPassed = true): FitnessRunners {
  return {
    runScriptedSuite: async () => ({
      total: 15,
      succeeded: Math.round(15 * successRate),
      successRate,
    }),
    runUnitSuite: async () => unitPassed,
  };
}

describe('measureFitness — RSI 适应度', () => {
  test('全绿世界：15/15 + 单元套件过 → score 10', async () => {
    const r = await measureFitness('/any', { runners: fakeRunners(1) });
    expect(r.scriptedSuccessRate).toBe(1);
    expect(r.unitPassed).toBe(true);
    expect(r.score).toBe(10);
  });

  test('14/15 成功率 → 分数按比例下降（8×rate + 2×unit）', async () => {
    const r = await measureFitness('/any', { runners: fakeRunners(14 / 15) });
    expect(r.scriptedSuccessRate).toBeCloseTo(14 / 15);
    expect(r.score).toBeCloseTo(8 * (14 / 15) + 2, 5);
    expect(r.score).toBeGreaterThan(9);
    expect(r.score).toBeLessThan(10);
  });

  test('单元套件失败 → 重罚（score ≤ 8，无论 scripted 多高）', async () => {
    const r = await measureFitness('/any', { runners: fakeRunners(1, false) });
    expect(r.unitPassed).toBe(false);
    expect(r.score).toBeLessThanOrEqual(8);
  });

  test('零成功世界 → score 2（只剩单元绿灯）', async () => {
    const r = await measureFitness('/any', { runners: fakeRunners(0) });
    expect(r.score).toBe(2);
  });

  test('成功率单调 → 分数单调（RSI 曲线的数学前提）', async () => {
    const low = await measureFitness('/any', { runners: fakeRunners(0.6) });
    const high = await measureFitness('/any', { runners: fakeRunners(0.93) });
    expect(high.score).toBeGreaterThan(low.score);
  });
});
