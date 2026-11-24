/**
 * M3 递归曲线 — RSI 的「R」的数据层：每轮自改一条 JSONL 记录，纵向读出
 * 适应度是否随自改迭代上升。追加式（同一份 append-only 纪律贯穿 trace/
 * memory/curve），读取容错（半行写入不致命），聚合摘要给报告与人。
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

export interface CurveEntry {
  readonly ts: string;
  readonly proposal: string;
  readonly verdict: string;
  readonly fitnessBefore: number;
  readonly fitnessAfter?: number | undefined;
  readonly delta?: number | undefined;
  readonly commit?: string | undefined;
}

export function appendCurveEntry(path: string, entry: CurveEntry): void {
  appendFileSync(path, JSON.stringify(entry) + '\n', 'utf8');
}

/** 逐行 JSON 解析；损坏行（半行写入）静默跳过——数据完整性优先于报错。 */
export function readCurve(path: string): readonly CurveEntry[] {
  if (!existsSync(path)) return [];
  const out: CurveEntry[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as Partial<CurveEntry>;
      if (typeof parsed.proposal === 'string' && typeof parsed.verdict === 'string') {
        out.push({
          ts: typeof parsed.ts === 'string' ? parsed.ts : '',
          proposal: parsed.proposal,
          verdict: parsed.verdict,
          fitnessBefore: typeof parsed.fitnessBefore === 'number' ? parsed.fitnessBefore : 0,
          ...(typeof parsed.fitnessAfter === 'number' ? { fitnessAfter: parsed.fitnessAfter } : {}),
          ...(typeof parsed.delta === 'number' ? { delta: parsed.delta } : {}),
          ...(typeof parsed.commit === 'string' ? { commit: parsed.commit } : {}),
        });
      }
    } catch {
      // corrupt line — skip
    }
  }
  return out;
}

export interface CurveSummary {
  readonly cycles: number;
  readonly improved: number;
  readonly worse: number;
  readonly neutral: number;
  readonly rejected: number;
  readonly failure: number;
  readonly firstFitness?: number | undefined;
  readonly lastFitness?: number | undefined;
  /** 末条 fitness − 首条 fitness：递归曲线的方向与幅度。 */
  readonly netDelta: number;
}

export function curveSummary(entries: readonly CurveEntry[]): CurveSummary {
  const withFitness = entries.filter((e) => typeof e.fitnessBefore === 'number');
  const byVerdict = (verdict: string): number =>
    entries.filter((e) => e.verdict === verdict).length;
  const first = withFitness[0];
  const last = withFitness[withFitness.length - 1];
  const firstFitness = first?.fitnessBefore;
  const lastFitness =
    last !== undefined && typeof last.fitnessAfter === 'number' ? last.fitnessAfter : last?.fitnessBefore;
  return {
    cycles: entries.length,
    improved: byVerdict('improved'),
    worse: byVerdict('worse'),
    neutral: byVerdict('neutral'),
    rejected: byVerdict('control-plane-rejected'),
    failure: byVerdict('failure'),
    ...(firstFitness !== undefined ? { firstFitness } : {}),
    ...(lastFitness !== undefined ? { lastFitness } : {}),
    netDelta:
      firstFitness !== undefined && lastFitness !== undefined
        ? lastFitness - firstFitness
        : 0,
  };
}
