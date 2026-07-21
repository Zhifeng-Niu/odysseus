import type {
  ReasonCount,
  VoyageStats,
  VoyageStatsSlice,
} from './voyage-stats.js';

/**
 * Markdown rendering for voyage statistics — extracted from
 * voyage-stats.ts (Iteration 55).
 *
 * voyage-stats.ts was at 291 lines (cap 299 — red zone). The markdown
 * formatter block (formatPct, formatTokens, formatReasons, formatSlice,
 * formatVoyageStatsMarkdown) is a clean extraction candidate: it is a
 * pure consumer of the VoyageStats shape, with no overlap with the
 * aggregation logic that computes it.
 *
 * Mirrors the Iter 53 (memory-parse) split: pure shape-to-Markdown
 * transform pulled into a sibling module so the host module shrinks
 * toward its primary responsibility (aggregation).
 *
 * Type-only imports erase at compile time, so the reference back to
 * `./voyage-stats.js` does not create a runtime cycle.
 */

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

/**
 * Render a VoyageStats object as a human-readable markdown block.
 *
 * Output shape (abbreviated):
 *
 *   # Voyage stats
 *
 *   Total waypoints: 12
 *   Outcomes: success=8  failure=3  abandoned=1
 *   Success rate: 67%  |  avg iterations/waypoint: 3.2
 *   Total tokens: input=1.20M  output=45.2k
 *   Avg per waypoint: input=100.0k  output=3.8k
 *
 *   ## Top failure reasons
 *     3  hit maxIterations
 * *
 *   ## Trend (first half vs second half)
 *     First half  (6 waypoints):
 *       success=50%  failure=50%  abandoned=0%
 *       avg iterations=4.0  avg input tokens=120.0k
 *     Second half (6 waypoints):
 *       success=83%  failure=17%  abandoned=0%
 *       avg iterations=2.4  avg input tokens=80.0k
 */
export function formatVoyageStatsMarkdown(stats: VoyageStats): string {
  const lines: string[] = [];
  lines.push('# Voyage stats');
  lines.push('');
  lines.push(`Total waypoints: ${stats.totalWaypoints}`);
  lines.push(
    `Outcomes: success=${stats.outcomes.success}  ` +
      `failure=${stats.outcomes.failure}  ` +
      `abandoned=${stats.outcomes.abandoned}`,
  );
  lines.push(
    `Success rate: ${formatPct(stats.successRate)}  |  ` +
      `avg iterations/waypoint: ${stats.avgIterations.toFixed(1)}`,
  );
  lines.push(
    `Total tokens: input=${formatTokens(stats.totalTokens.input)}  ` +
      `output=${formatTokens(stats.totalTokens.output)}`,
  );
  lines.push(
    `Avg per waypoint: input=${formatTokens(stats.avgTokensPerWaypoint.input)}  ` +
      `output=${formatTokens(stats.avgTokensPerWaypoint.output)}`,
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
