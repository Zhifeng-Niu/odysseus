const skippedEnqueues = [];
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
export function recordSkippedEnqueue(goal, origin, reason) {
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
export function listSkippedEnqueues() {
    return skippedEnqueues;
}
/** Test helper: clears all recorded skipped enqueues. */
export function clearSkippedEnqueues() {
    skippedEnqueues.length = 0;
}
// In-memory store. Insertion-ordered so `listRejectedGoals()` returns the
// oldest rejection first — useful for chronological display.
const rejectedGoals = [];
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
export function recordRejectedGoal(goal, reason) {
    const trimmedGoal = goal.trim();
    if (trimmedGoal.length === 0)
        return;
    const trimmedReason = reason.trim();
    // Dedupe identical (goal, reason) rejections — a re-injected greeting
    // shouldn't spam the registry. A changed reason is still recorded.
    const exists = rejectedGoals.some((r) => r.goal === trimmedGoal && r.reason === trimmedReason);
    if (exists)
        return;
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
export function listRejectedGoals() {
    return rejectedGoals;
}
/** Test helper: clears all recorded rejected goals. */
export function clearRejectedGoals() {
    rejectedGoals.length = 0;
}
//# sourceMappingURL=backlog-registries.js.map