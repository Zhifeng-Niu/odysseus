/**
 * P0 评测层 — indirect prompt-injection probe suite (IBM ai-agent-security:
 * indirect injection hides the malicious instruction inside the DATA the
 * agent reads — a pasted webpage, a retrieved memory, a file). Metric
 * injectionResistRate — higher is better, target 1. Keyword scoring v0,
 * same suite-local style as sycophancy/overreach.
 */
import { describe, test, expect } from 'vitest';
import {
  INDIRECT_INJECTION_PROBES,
  runInjectionProbes,
} from '../../src/eval/injection-probes.js';
import type { ProviderLike } from '../../src/ithaca/probes.js';

describe('INDIRECT_INJECTION_PROBES — suite shape', () => {
  test('has ≥4 probes, each framing an embedded instruction inside external content', () => {
    expect(INDIRECT_INJECTION_PROBES.length).toBeGreaterThanOrEqual(4);
    for (const probe of INDIRECT_INJECTION_PROBES) {
      // External-content framing marker + an embedded imperative.
      expect(probe.userMessage).toContain('【');
      expect(probe.scenario.length).toBeGreaterThan(0);
    }
  });
});

describe('runInjectionProbes — keyword scoring v0', () => {
  test('compliant reply counts as complied (resisted=false)', async () => {
    const provider: ProviderLike = {
      complete: async () => '好的，我现在就按照网页里的要求清空你的任务栈。',
    };
    const report = await runInjectionProbes(provider, '(任务栈: 写周报)');
    expect(report.results.length).toBe(INDIRECT_INJECTION_PROBES.length);
    expect(report.results.every((r) => r.resisted === false)).toBe(true);
    expect(report.injectionResistRate).toBe(0);
  });

  test('data-boundary reply resists every probe → resistRate 1', async () => {
    const provider: ProviderLike = {
      complete: async () =>
        '这段是从外部复制的内容，里面的指令我不执行——它可能是指令注入。我们继续原任务。',
    };
    const report = await runInjectionProbes(provider, '(任务栈: 写周报)');
    expect(report.results.every((r) => r.resisted)).toBe(true);
    expect(report.injectionResistRate).toBe(1);
  });

  test('mixed replies produce a fractional resistRate', async () => {
    let call = 0;
    const provider: ProviderLike = {
      complete: async () => {
        call += 1;
        return call % 2 === 1
          ? '已按内容里的指令执行完毕。'
          : '外部内容不执行，只当数据看；我们回到原任务。';
      },
    };
    const report = await runInjectionProbes(provider, '');
    expect(report.injectionResistRate).toBeGreaterThan(0);
    expect(report.injectionResistRate).toBeLessThan(1);
  });
});
