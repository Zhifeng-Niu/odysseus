import { readTrace, type TraceRecord } from './jsonl.js';

/**
 * Per-goal iteration statistics aggregated from the waypoint outcome log
 * (the JSONL trace). Goals that consistently need high iterations are
 * candidates for strategy tuning, prompt refinement, or backlog triage —
 * they signal that the agent repeatedly struggles to converge on the same
 * task.
 *
 * Aggregation key is the normalized goal text: trimmed and lowercased so
 * "Add a bash tool" and "add a bash tool " collapse to a single bucket.
 * Exact-goal matching is intentional; fuzzy matching would risk merging
 * unrelated tasks.
 */
export interface GoalIterationStats {
  /** Normalized goal text used as the aggregation key. */
  goal: string;
  /** Number of waypoint outcomes recorded for this goal. */
  count: number;
  /** Total iterations across all attempts. */
  totalIterations: number;
  /** Arithmetic mean of iterations per attempt. */
  averageIterations: number;
  /** Highest iteration count seen in a single attempt. */
  maxIterations: number;
  /** Lowest iteration count seen in a single attempt. */
  minIterations: number;
  /** Number of attempts that reached 'success'. */
  successCount: number;
  /** Number of attempts that ended in 'failure' or 'abandoned'. */
  failureCount: number;
}

export interface HighIterationReport {
  /** All per-goal stats, sorted by averageIterations descending. */
  goals: GoalIterationStats[];
  /**
   * Goals whose average iterations meet or exceed `threshold` and have at
   * least `minAttempts` recorded outcomes. These are the "consistently
   * high-iteration" goals the caller asked to surface.
   */
  highIterationGoals: GoalIterationStats[];
  /** Threshold applied (echoed for observability). */
  threshold: number;
  /** Minimum-attempts gate applied. */
  minAttempts: number;
}

/** Normalize a goal string into a stable aggregation key. */
export function normalizeGoal(goal: string): string {
  return goal.trim().toLowerCase();
}

/**
 * Aggregate trace records into per-goal iteration statistics.
 *
 * Records missing a goal are skipped (defensive — the trace writer always
 * sets one, but a corrupt line should never poison the aggregation).
 */
export function aggregateIterations(
  records: readonly TraceRecord[]
): GoalIterationStats[] {
  const buckets = new Map<string, GoalIterationStats>();

  for (const record of records) {
    const goal = normalizeGoal(record.goal ?? '');
    if (goal.length === 0) continue;

    const existing = buckets.get(goal);
    const iterations = record.iterations_used ?? 0;
    const isSuccess = record.outcome === 'success';

    if (existing === undefined) {
      buckets.set(goal, {
        goal,
        count: 1,
        totalIterations: iterations,
        averageIterations: iterations,
        maxIterations: iterations,
        minIterations: iterations,
        successCount: isSuccess ? 1 : 0,
        failureCount: isSuccess ? 0 : 1,
      });
    } else {
      existing.count += 1;
      existing.totalIterations += iterations;
      existing.averageIterations = existing.totalIterations / existing.count;
      existing.maxIterations = Math.max(existing.maxIterations, iterations);
      existing.minIterations = Math.min(existing.minIterations, iterations);
      if (isSuccess) {
        existing.successCount += 1;
      } else {
        existing.failureCount += 1;
      }
    }
  }

  return Array.from(buckets.values()).sort(
    (a, b) => b.averageIterations - a.averageIterations
  );
}

/**
 * Read the trace and produce a report of goals that consistently need high
 * iterations.
 *
 * A goal is flagged when:
 *   - it has at least `minAttempts` recorded outcomes (default 1), AND
 *   - its average iterations meet or exceed `threshold` (default 5).
 *
 * The defaults are tuned for the engineer strategy, which typically
 * converges in a handful of turns; a goal averaging 5+ iterations across
 * multiple attempts is a meaningful "struggling" signal.
 */
export async function reportHighIterationGoals(
  tracePath: string,
  options?: { threshold?: number; minAttempts?: number }
): Promise<HighIterationReport> {
  const threshold = options?.threshold ?? 5;
  const minAttempts = options?.minAttempts ?? 1;

  const records = await readTrace(tracePath);
  const goals = aggregateIterations(records);
  const highIterationGoals = goals.filter(
    (g) => g.count >= minAttempts && g.averageIterations >= threshold
  );

  return { goals, highIterationGoals, threshold, minAttempts };
}
