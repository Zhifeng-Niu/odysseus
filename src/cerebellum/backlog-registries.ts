import type { BacklogOrigin } from '../orchestrator/events.js';

/**
 * In-memory registries for backlog operations — observability for
 * silently-dropped enqueues and rejected goals.
 *
 * Extracted from backlog.ts (Iteration 39) to keep that module focused
 * on its core responsibility (file-backed queue). Both registries are
 * session-scoped and intentionally not persisted — they exist for
 * runtime introspection (TUI, voyage summary, tests).
 *
 * Re-exported from backlog.ts for orchestrator.ts import stability —
 * that module is on the safety perimeter and cannot be edited by hand.
 * New callers should import directly from here.
 */

// ---------------------------------------------------------------------------
// Skipped-enqueue registry — observability for silently-dropped enqueues.
//
// Iteration 18. Before this, when an autonomous-origin enqueue hit one of
// the three dedup early-returns, the drop was invisible: the function
// returned a phantom BacklogItem and only a console.warn (in the retry-
// exhausted branch) signalled the skip. The other two branches were
// completely silent.
//
// This registry captures every skip so future regressions (e.g. an
// autonomous loop that's stuck re-trying the same goal and getting silently
// dropped) are diagnosable. Mirrors the shape of `rejectedGoals` below.
// ---------------------------------------------------------------------------

/** Why an enqueue was skipped by the dedup checks. */
export type SkipReason = 'seed-exhausted' | 'retry-exhausted' | 'already-completed';

/** A record of an enqueue that was silently dropped by the dedup checks. */
export interface SkippedEnqueue {
  /** The goal description that was skipped. */
  readonly goal: string;
  /** The origin of the enqueue attempt. */
  readonly origin: BacklogOrigin;
  /** Why it was skipped. */
  readonly reason: SkipReason;
  /** Epoch millis when the skip was recorded. */
  readonly skippedAt: number;
}

const skippedEnqueues: SkippedEnqueue[] = [];

/**
 * Records that an enqueue of `goal` from `origin` was silently dropped due
 * to `reason`. Called from the three dedup early-return paths in
 * `enqueueBacklog` (backlog.ts).
 *
 * Not deduplicated — every skip is recorded. A loop that's stuck retrying
 * the same goal 100 times produces 100 entries, which is exactly the
 * signal an operator wants when diagnosing "why is the voyage idle but
 * the dreamer keeps emitting proposals?"
 */
export function recordSkippedEnqueue(
  goal: string,
  origin: BacklogOrigin,
  reason: SkipReason
): void {
  skippedEnqueues.push({
    goal,
    origin,
    reason,
    skippedAt: Date.now(),
  });
}

/**
 * Returns a snapshot of all silently-dropped enqueues in chronological order.
 * Consumers use this to surface dedup activity in the TUI and voyage summary.
 */
export function listSkippedEnqueues(): readonly SkippedEnqueue[] {
  return skippedEnqueues;
}

/** Test helper: clears all recorded skipped enqueues. */
export function clearSkippedEnqueues(): void {
  skippedEnqueues.length = 0;
}

// ---------------------------------------------------------------------------
// Rejected-goal registry — traceability for abandoned goals.
//
// When the pre-dispatch goal validator (goal-validator.ts) returns
// `valid: false`, the orchestrator abandons the waypoint before any
// checkpoint or LLM work. Those rejections were previously invisible in
// output: the waypoint was marked abandoned and traced, but there was no
// queryable record of *which* goal descriptions were rejected and *why*.
//
// This registry captures both so abandoned goals are traceable. It mirrors
// the in-memory shape of completedGoals.ts / seedAttempts.ts (session-
// scoped, not persisted) and is exposed via `listRejectedGoals()` for
// consumers (TUI, voyage summary, tests) to surface in output.
// ---------------------------------------------------------------------------

/** A goal rejected by the pre-dispatch validator. */
export interface RejectedGoal {
  /** The goal description that was rejected. */
  readonly goal: string;
  /** Human-readable reason the validator gave for rejecting it. */
  readonly reason: string;
  /** Epoch millis when the rejection was recorded. */
  readonly rejectedAt: number;
}

// In-memory store. Insertion-ordered so `listRejectedGoals()` returns the
// oldest rejection first — useful for chronological display.
const rejectedGoals: RejectedGoal[] = [];

/**
 * Records that `goal` was rejected by the validator with `reason`.
 *
 * Called from the orchestrator's pre-dispatch validation path whenever
 * `validateGoal()` returns `{ valid: false }`. Idempotent per (goal, reason)
 * pair: a repeat rejection with identical text and reason is a no-op so the
 * registry doesn't grow unboundedly if the same conversational goal is
 * re-injected. A *different* reason for the same goal is recorded as a new
 * entry so the evolution of rejections stays visible.
 */
export function recordRejectedGoal(goal: string, reason: string): void {
  const trimmedGoal = goal.trim();
  if (trimmedGoal.length === 0) return;
  const trimmedReason = reason.trim();
  // Dedupe identical (goal, reason) rejections — a re-injected greeting
  // shouldn't spam the registry. A changed reason is still recorded.
  const exists = rejectedGoals.some(
    (r) => r.goal === trimmedGoal && r.reason === trimmedReason
  );
  if (exists) return;
  rejectedGoals.push({
    goal: trimmedGoal,
    reason: trimmedReason,
    rejectedAt: Date.now(),
  });
}

/**
 * Returns a snapshot of all rejected goals in insertion (chronological)
 * order. Consumers use this to render abandoned-goal provenance in output.
 */
export function listRejectedGoals(): readonly RejectedGoal[] {
  return rejectedGoals;
}

/** Test helper: clears all recorded rejected goals. */
export function clearRejectedGoals(): void {
  rejectedGoals.length = 0;
}
