import { readFileSync } from 'node:fs';
import { readTrace, type TraceRecord } from '../trace/jsonl.js';

/**
 * Voyage log — recent voyage summaries injected at waypoint start so the
 * agent remembers what it already tried across voyage boundaries.
 *
 * Each voyage's trace records are aggregated into a VoyageSummary
 * (voyage_id, waypoints with goal/outcome/fail_reason, total iterations,
 * success/failure counts, start/end ts). The most recent N summaries are
 * formatted as markdown and prepended to the engineer system prompt.
 *
 * Closes the "no continuous working memory across voyages" limitation
 * (self-model aspiration #4, 2026-07-21). The full voyage-internal state
 * (every tool call, every partial result) still resets each voyage —
 * but the *outline* of recent work now persists.
 *
 * Backward compatibility: trace records written before 2026-07-21
 * (Iteration 10) lack `voyage_id`. They are bucketed into a single
 * synthetic voyage named `voy_legacy` so the summary still renders.
 */

/** Maximum number of voyages to inject by default. */
export const DEFAULT_VOYAGE_SUMMARY_LIMIT = 5;

export interface VoyageWaypoint {
  readonly id: string;
  readonly goal: string;
  readonly outcome: TraceRecord['outcome'];
  readonly failReason: string | null;
  readonly iterationsUsed: number;
  readonly ts: string;
}

export interface VoyageSummary {
  readonly voyageId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly waypoints: readonly VoyageWaypoint[];
  readonly successCount: number;
  readonly failureCount: number;
  readonly abandonedCount: number;
  readonly totalIterations: number;
}

/**
 * Group trace records by voyage_id and return VoyageSummary objects in
 * reverse chronological order (most recent first). Records lacking
 * voyage_id are bucketed into a single `voy_legacy` group so old traces
 * still produce a useful summary.
 *
 * `maxSummaries` caps the returned array length. The most recent N
 * voyages are kept; older ones are dropped silently.
 */
export async function loadRecentVoyageSummaries(
  tracePath: string,
  maxSummaries: number = DEFAULT_VOYAGE_SUMMARY_LIMIT
): Promise<VoyageSummary[]> {
  const records = await readTrace(tracePath);
  return buildSummaries(records, maxSummaries);
}

/**
 * Sync version for use inside the strategy systemPrompt getter (which
 * must stay synchronous — see strategy.ts). Reads trace.jsonl with
 * readFileSync and parses line-by-line. Returns [] on missing file or
 * parse errors so callers degrade gracefully.
 */
export function loadRecentVoyageSummariesSync(
  tracePath: string,
  maxSummaries: number = DEFAULT_VOYAGE_SUMMARY_LIMIT
): VoyageSummary[] {
  let raw: string;
  try {
    raw = readFileSync(tracePath, 'utf8');
  } catch {
    return [];
  }
  const records: TraceRecord[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      records.push(JSON.parse(line) as TraceRecord);
    } catch {
      // Skip malformed line — same tolerance as readTrace.
    }
  }
  return buildSummaries(records, maxSummaries);
}

function buildSummaries(
  records: readonly TraceRecord[],
  maxSummaries: number
): VoyageSummary[] {
  if (records.length === 0) return [];

  // Bucket records by voyage_id, preserving insertion order within each
  // bucket. Use a Map so iteration order matches first-seen order, which
  // for an append-only trace equals chronological order.
  const buckets = new Map<string, TraceRecord[]>();
  for (const record of records) {
    const key = record.voyage_id ?? 'voy_legacy';
    const existing = buckets.get(key);
    if (existing === undefined) {
      buckets.set(key, [record]);
    } else {
      existing.push(record);
    }
  }

  const summaries: VoyageSummary[] = [];
  for (const [voyageId, group] of buckets) {
    summaries.push(summarize(voyageId, group));
  }

  // Reverse-chronological: voyages that ended most recently first. The
  // legacy bucket (if any) sorts last because its records are the oldest.
  summaries.sort((a, b) => b.endedAt.localeCompare(a.endedAt));

  return summaries.slice(0, maxSummaries);
}

function summarize(voyageId: string, records: readonly TraceRecord[]): VoyageSummary {
  const waypoints: VoyageWaypoint[] = records.map((r) => ({
    id: r.waypoint_id,
    goal: r.goal,
    outcome: r.outcome,
    failReason: r.fail_reason,
    iterationsUsed: r.iterations_used,
    ts: r.ts,
  }));

  let successCount = 0;
  let failureCount = 0;
  let abandonedCount = 0;
  let totalIterations = 0;
  for (const r of records) {
    if (r.outcome === 'success') successCount += 1;
    else if (r.outcome === 'failure') failureCount += 1;
    else if (r.outcome === 'abandoned') abandonedCount += 1;
    totalIterations += r.iterations_used;
  }

  const tsStrings = records.map((r) => r.ts).sort();
  const startedAt = tsStrings[0] ?? '';
  const endedAt = tsStrings[tsStrings.length - 1] ?? '';

  return {
    voyageId,
    startedAt,
    endedAt,
    waypoints,
    successCount,
    failureCount,
    abandonedCount,
    totalIterations,
  };
}

/**
 * Render voyage summaries as a markdown block suitable for injection
 * into a system prompt. Returns the empty string for an empty list so
 * callers can skip the section entirely when there is no history.
 *
 * Output shape (abbreviated):
 *
 *   ## Recent voyages
 *
 *   ### voy_abc123 (2 waypoints: 1 success, 1 failure)
 *   - [success] add retry to llm provider (3 iter)
 *   - [failure] refactor cerebellum — FAIL: tsc errored on strict mode (5 iter)
 *
 *   ### voy_def456 (1 waypoint: 1 success)
 *   - [success] fix typo in readme (1 iter)
 */
export function formatVoyageSummariesMarkdown(summaries: readonly VoyageSummary[]): string {
  if (summaries.length === 0) return '';

  const sections: string[] = ['## Recent voyages'];
  for (const s of summaries) {
    const counts: string[] = [];
    if (s.successCount > 0) counts.push(`${s.successCount} success`);
    if (s.failureCount > 0) counts.push(`${s.failureCount} failure`);
    if (s.abandonedCount > 0) counts.push(`${s.abandonedCount} abandoned`);
    const countsLabel = counts.length > 0 ? counts.join(', ') : 'no waypoints';

    const lines: string[] = [
      `### ${s.voyageId} (${s.waypoints.length} waypoints: ${countsLabel})`,
    ];
    for (const wp of s.waypoints) {
      const iter = `(${wp.iterationsUsed} iter)`;
      const fail = wp.failReason !== null ? ` — FAIL: ${truncate(wp.failReason, 120)}` : '';
      lines.push(`- [${wp.outcome}] ${truncate(wp.goal, 160)} ${iter}${fail}`);
    }
    sections.push(lines.join('\n'));
  }
  return sections.join('\n\n');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
