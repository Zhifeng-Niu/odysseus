import type { TraceRecord } from '../trace/jsonl.js';

/**
 * Voyage statistics — aggregates a sequence of trace records into a
 * summary that answers "how is the agent actually doing?".
 *
 * Closes the observability gap surfaced by Iteration 32: the system had
 * rich per-waypoint trace data but no rollup. Without a rollup every
 * retrospective re-derived the same queries (success rate, failure mode
 * distribution, token cost trend). Memory rule `复盘优先读 .odysseus/
 * events.jsonl` (2026-07-19) is only actionable if the log is rolled up
 * into signal — raw events.jsonl is too verbose for a quick read.
 *
 * Pure functions over TraceRecord[]. No I/O. The CLI wrapper at
 * src/scripts/voyage-stats.ts handles file reading.
 */

export type Outcome = TraceRecord['outcome'];

export interface OutcomeCounts {
  readonly success: number;
  readonly failure: number;
  readonly abandoned: number;
}

export interface TokenTotals {
  readonly input: number;
  readonly output: number;
}

export interface ReasonCount {
  readonly reason: string;
  readonly count: number;
}

export interface VoyageStatsSlice {
  readonly waypoints: number;
  readonly successRate: number;
  readonly failureRate: number;
  readonly abandonedRate: number;
  readonly avgIterations: number;
  readonly avgInputTokens: number;
}

export interface VoyageStats {
  readonly totalWaypoints: number;
  readonly outcomes: OutcomeCounts;
  readonly successRate: number;
  readonly totalTokens: TokenTotals;
  readonly avgTokensPerWaypoint: TokenTotals;
  readonly avgIterations: number;
  readonly topFailReasons: readonly ReasonCount[];
  readonly topAbandonedReasons: readonly ReasonCount[];
  readonly trend: TrendComparison | null;
}

export interface TrendComparison {
  readonly firstHalf: VoyageStatsSlice;
  readonly secondHalf: VoyageStatsSlice;
}

const TOP_REASONS_LIMIT = 5;

/**
 * Normalize a fail/abandon reason for aggregation. Long reasons have
 * details that vary per-occurrence ("threshold N", specific tool name,
 * iteration count). Without normalization, each variant is its own
 * bucket and the aggregation loses signal.
 *
 * Strategy: take the prefix before the first delimiter among `:`, `—`,
 * `(`. If no delimiter, take the first 60 chars. Examples:
 *   "hit maxIterations (16) without DONE — agent did not converge"
 *     → "hit maxIterations"
 *   "early termination: agent produced 3 consecutive..."
 *     → "early termination"
 *   "agent emitted [CONVERSATIONAL-DONE]: conversational turn complete..."
 *     → "agent emitted [CONVERSATIONAL-DONE]"
 *   "fetch failed" → "fetch failed"
 */
export function normalizeReason(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '(none)';
  for (const delim of [':', '—', '(']) {
    const idx = trimmed.indexOf(delim);
    if (idx > 0) {
      return trimmed.slice(0, idx).trim();
    }
  }
  return trimmed.length > 60 ? trimmed.slice(0, 60).trim() + '…' : trimmed;
}

function sumTokens(records: readonly TraceRecord[]): TokenTotals {
  let input = 0;
  let output = 0;
  for (const r of records) {
    input += r.tokens_consumed?.input ?? 0;
    output += r.tokens_consumed?.output ?? 0;
  }
  return { input, output };
}

function computeSlice(records: readonly TraceRecord[]): VoyageStatsSlice {
  const n = records.length;
  if (n === 0) {
    return {
      waypoints: 0,
      successRate: 0,
      failureRate: 0,
      abandonedRate: 0,
      avgIterations: 0,
      avgInputTokens: 0,
    };
  }
  const counts = countOutcomes(records);
  const tokens = sumTokens(records);
  const totalIters = records.reduce((sum, r) => sum + (r.iterations_used ?? 0), 0);
  return {
    waypoints: n,
    successRate: counts.success / n,
    failureRate: counts.failure / n,
    abandonedRate: counts.abandoned / n,
    avgIterations: totalIters / n,
    avgInputTokens: tokens.input / n,
  };
}

export function countOutcomes(records: readonly TraceRecord[]): OutcomeCounts {
  let success = 0;
  let failure = 0;
  let abandoned = 0;
  for (const r of records) {
    if (r.outcome === 'success') success += 1;
    else if (r.outcome === 'failure') failure += 1;
    else if (r.outcome === 'abandoned') abandoned += 1;
  }
  return { success, failure, abandoned };
}

function aggregateReasons(
  records: readonly TraceRecord[],
  outcome: Outcome
): readonly ReasonCount[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    if (r.outcome !== outcome) continue;
    const normalized = normalizeReason(r.fail_reason ?? '(none)');
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_REASONS_LIMIT);
}

export function computeVoyageStats(records: readonly TraceRecord[]): VoyageStats {
  const total = records.length;
  const outcomes = countOutcomes(records);
  const tokens = sumTokens(records);
  const totalIters = records.reduce((sum, r) => sum + (r.iterations_used ?? 0), 0);

  let trend: TrendComparison | null = null;
  if (total >= 4) {
    const half = Math.floor(total / 2);
    trend = {
      firstHalf: computeSlice(records.slice(0, half)),
      secondHalf: computeSlice(records.slice(half)),
    };
  }

  return {
    totalWaypoints: total,
    outcomes,
    successRate: total > 0 ? outcomes.success / total : 0,
    totalTokens: tokens,
    avgTokensPerWaypoint: {
      input: total > 0 ? tokens.input / total : 0,
      output: total > 0 ? tokens.output / total : 0,
    },
    avgIterations: total > 0 ? totalIters / total : 0,
    topFailReasons: aggregateReasons(records, 'failure'),
    topAbandonedReasons: aggregateReasons(records, 'abandoned'),
    trend,
  };
}

function formatPct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatReasons(reasons: readonly ReasonCount[]): string {
  if (reasons.length === 0) return '  (none)';
  return reasons
    .map((r) => `  ${String(r.count).padStart(3)}  ${r.reason}`)
    .join('\n');
}

function formatSlice(label: string, slice: VoyageStatsSlice): string {
  return (
    `  ${label} (${slice.waypoints} waypoints):\n` +
    `    success=${formatPct(slice.successRate)}  ` +
    `failure=${formatPct(slice.failureRate)}  ` +
    `abandoned=${formatPct(slice.abandonedRate)}\n` +
    `    avg iterations=${slice.avgIterations.toFixed(1)}  ` +
    `avg input tokens=${formatTokens(slice.avgInputTokens)}`
  );
}

export function formatVoyageStatsMarkdown(stats: VoyageStats): string {
  const lines: string[] = [];
  lines.push('# Voyage stats');
  lines.push('');
  lines.push(`Total waypoints: ${stats.totalWaypoints}`);
  lines.push(
    `Outcomes: success=${stats.outcomes.success}  ` +
      `failure=${stats.outcomes.failure}  ` +
      `abandoned=${stats.outcomes.abandoned}`
  );
  lines.push(
    `Success rate: ${formatPct(stats.successRate)}  |  ` +
      `avg iterations/waypoint: ${stats.avgIterations.toFixed(1)}`
  );
  lines.push(
    `Total tokens: input=${formatTokens(stats.totalTokens.input)}  ` +
      `output=${formatTokens(stats.totalTokens.output)}`
  );
  lines.push(
    `Avg per waypoint: input=${formatTokens(stats.avgTokensPerWaypoint.input)}  ` +
      `output=${formatTokens(stats.avgTokensPerWaypoint.output)}`
  );
  lines.push('');
  lines.push('## Top failure reasons');
  lines.push(formatReasons(stats.topFailReasons));
  lines.push('');
  lines.push('## Top abandoned reasons');
  lines.push(formatReasons(stats.topAbandonedReasons));
  if (stats.trend) {
    lines.push('');
    lines.push('## Trend (first half vs second half)');
    lines.push(formatSlice('First half ', stats.trend.firstHalf));
    lines.push(formatSlice('Second half', stats.trend.secondHalf));
  }
  return lines.join('\n');
}
