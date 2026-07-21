import type { TraceRecord } from '../trace/jsonl.js';
import type { ExplorationOutcome } from './exploration-log.js';
import { normalizeGoal } from './dreamer-dedup.js';

/**
 * Exploration feedback loop — closes self-model aspiration #3
 * ("Exploration-outcome feedback loop: demote for N voyages after 3
 * failures; mark closed when shipped").
 *
 * Extracted from exploration-log.ts (Iteration 48) to keep that file
 * under the 260-line size cap. Same extraction pattern as dreamer.ts →
 * dreamer-dedup.ts / extract-json.ts / prompts.ts.
 *
 * The feedback loop gives curiosity a closed-loop signal: instead of
 * re-deciding from scratch each voyage, the agent sees which past
 * explorations have repeatedly failed (→ demote, skip) and which have
 * shipped (→ mark closed, do not re-propose).
 */

/**
 * Threshold: after this many consecutive failures for the same goal
 * (normalized), the exploration is considered "demoted" and the LLM is
 * told to skip it.
 */
export const DEMOTION_FAILURE_THRESHOLD = 3;

/**
 * Per-exploration outcome stats aggregated across all trace records for
 * a given normalized goal.
 */
export interface ExplorationStats {
  /** Normalized goal key (for correlation). */
  readonly goalKey: string;
  /** Human-readable sample of the goal text. */
  readonly goalSample: string;
  readonly totalAttempts: number;
  readonly successCount: number;
  readonly failureCount: number;
  /** Consecutive failures counting backward from the most recent attempt. */
  readonly consecutiveFailures: number;
  /** True when the most recent attempt succeeded. */
  readonly lastSucceeded: boolean;
  /** True when consecutiveFailures >= DEMOTION_FAILURE_THRESHOLD. */
  readonly demoted: boolean;
}

/**
 * Compute per-exploration stats from a list of exploration outcomes.
 * Each exploration is matched against the full trace to count total
 * attempts, successes, failures, and consecutive failures.
 *
 * The "consecutive failures" count walks trace records for the same
 * normalized goal in reverse-chronological order, counting failures
 * until a non-failure (success or abandoned) is encountered.
 *
 * Returns stats only for explorations that have at least one trace
 * match — explorations that were never executed carry no feedback
 * signal and are omitted.
 */
export function computeExplorationStats(
  outcomes: readonly ExplorationOutcome[],
  trace: readonly TraceRecord[],
): ExplorationStats[] {
  // Index trace records by normalized goal, preserving chronological order.
  const traceByGoal = new Map<string, TraceRecord[]>();
  for (const r of trace) {
    if (r.goal.trim().length === 0) continue;
    const key = normalizeGoal(r.goal);
    if (key.length === 0) continue;
    const existing = traceByGoal.get(key);
    if (existing === undefined) {
      traceByGoal.set(key, [r]);
    } else {
      existing.push(r);
    }
  }

  const stats: ExplorationStats[] = [];
  const seen = new Set<string>();
  for (const o of outcomes) {
    const key = normalizeGoal(o.exploration.goal);
    if (key.length === 0 || seen.has(key)) continue;
    const records = traceByGoal.get(key);
    if (records === undefined) continue; // never executed — no stats
    seen.add(key);

    // Sort chronologically (oldest first) for consecutive-failure walk.
    const sorted = [...records].sort((a, b) => a.ts.localeCompare(b.ts));
    let successCount = 0;
    let failureCount = 0;
    for (const r of sorted) {
      if (r.outcome === 'success') successCount += 1;
      else if (r.outcome === 'failure') failureCount += 1;
    }

    // Walk backward from most recent, counting consecutive failures.
    let consecutiveFailures = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i]!.outcome === 'failure') {
        consecutiveFailures += 1;
      } else {
        break;
      }
    }

    const lastSucceeded = sorted[sorted.length - 1]!.outcome === 'success';
    stats.push({
      goalKey: key,
      goalSample: o.exploration.goal,
      totalAttempts: sorted.length,
      successCount,
      failureCount,
      consecutiveFailures,
      lastSucceeded,
      demoted: consecutiveFailures >= DEMOTION_FAILURE_THRESHOLD,
    });
  }
  return stats;
}

/**
 * Render exploration stats as a guidance block for the curiosity prompt.
 * Only renders entries that carry actionable signal: demoted explorations
 * (skip these) and recently-succeeded explorations (mark as closed).
 *
 * Returns '' when no stats carry signal so callers can skip the section.
 *
 * Output shape:
 *
 *   ### Exploration feedback
 *   - DEMOTED (3 consecutive failures): add workWaypointCounter — skip for now, pick a different aspiration
 *   - SHIPPED (succeeded): extract json helper — aspiration closed, do not re-propose
 */
export function formatExplorationFeedback(stats: readonly ExplorationStats[]): string {
  const signal = stats.filter((s) => s.demoted || s.lastSucceeded);
  if (signal.length === 0) return '';

  const lines: string[] = ['### Exploration feedback'];
  for (const s of signal) {
    if (s.demoted) {
      lines.push(
        `- DEMOTED (${s.consecutiveFailures} consecutive failures): ${truncate(s.goalSample, 100)} — skip for now, pick a different aspiration`,
      );
    } else if (s.lastSucceeded) {
      lines.push(
        `- SHIPPED (succeeded): ${truncate(s.goalSample, 100)} — aspiration closed, do not re-propose`,
      );
    }
  }
  return lines.join('\n');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
