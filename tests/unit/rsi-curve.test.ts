/**
 * M3 递归曲线 — RSI 的「R」的可视化数据层：每轮自改一条记录，纵向可读出
 * 适应度是否随自改迭代上升。JSONL 追加、损坏行容错、聚合摘要。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendCurveEntry, readCurve, curveSummary, type CurveEntry } from '../../src/eval/rsi-curve.js';

let path: string;

beforeEach(() => {
  path = join(tmpdir(), `rsi-curve-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jsonl`);
});

afterEach(() => {
  if (existsSync(path)) rmSync(path);
});

function entry(partial: Partial<CurveEntry>): CurveEntry {
  return {
    ts: '2026-11-24T00:00:00Z',
    proposal: 'p',
    verdict: 'improved',
    fitnessBefore: 8,
    ...partial,
  };
}

describe('appendCurveEntry / readCurve — JSONL 追加与容错读取', () => {
  test('append creates the file; read returns entries in order', () => {
    appendCurveEntry(path, entry({ proposal: 'first', fitnessBefore: 8, fitnessAfter: 9, delta: 1, verdict: 'improved' }));
    appendCurveEntry(path, entry({ proposal: 'second', verdict: 'worse' }));
    const curve = readCurve(path);
    expect(curve).toHaveLength(2);
    expect(curve[0]!.proposal).toBe('first');
    expect(curve[1]!.proposal).toBe('second');
  });

  test('corrupt line skipped (partial-write tolerance), valid entries survive', () => {
    appendCurveEntry(path, entry({ proposal: 'good' }));
    // 模拟进程中断的半行写入
    appendFileSync(path, '{"ts":"2026-11-24T00', 'utf8');
    const curve = readCurve(path);
    expect(curve).toHaveLength(1);
    expect(curve[0]!.proposal).toBe('good');
  });
});

describe('curveSummary — 递归曲线聚合', () => {
  test('counts verdicts and reads first→last fitness delta', () => {
    appendCurveEntry(path, entry({ proposal: 'a', verdict: 'improved', fitnessBefore: 7.5, fitnessAfter: 8.2, delta: 0.7 }));
    appendCurveEntry(path, entry({ proposal: 'b', verdict: 'worse', fitnessBefore: 8.2, fitnessAfter: 7.9, delta: -0.3 }));
    appendCurveEntry(path, entry({ proposal: 'c', verdict: 'control-plane-rejected', fitnessBefore: 7.9 }));
    const s = curveSummary(readCurve(path));
    expect(s.cycles).toBe(3);
    expect(s.improved).toBe(1);
    expect(s.worse).toBe(1);
    expect(s.rejected).toBe(1);
    expect(s.firstFitness).toBe(7.5);
    expect(s.lastFitness).toBe(7.9);
    expect(s.netDelta).toBeCloseTo(0.4);
  });

  test('empty curve → zeroed summary', () => {
    const s = curveSummary([]);
    expect(s.cycles).toBe(0);
    expect(s.netDelta).toBe(0);
  });
});
