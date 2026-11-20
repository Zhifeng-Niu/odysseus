/**
 * In-memory registry of how many times each goal description has been
 * enqueued into the backlog. After MAX_RETRY_ATTEMPTS (3) enqueues,
 * further enqueues are blocked at the API surface (enqueueBacklog throws
 * or returns null depending on caller).
 *
 * This is the *enqueue-side* counterpart to seedAttempts.ts. The two
 * counters complement each other:
 *   - retry-counter:  how many times has this goal been ENQUEUED?
 *   - seedAttempts:   how many times has this goal been DEQUEUED for
 *                     waypoint execution?
 * A goal can be enqueued once but never dequeued (operator kills the
 * voyage), or dequeued multiple times if it was re-enqueued. Both
 * counters exist to bound the dreamer/reflection loop from both ends.
 *
 * Keying uses a normalized hash of the goal description (lowercased,
 * non-alphanumeric stripped) so that "add retry" and "Add Retry" share
 * the same counter. The hash is identical to seedAttempts.ts:hashGoal
 * by design — both registries see the same goal space.
 *
 * Iteration 45 (2026-07-21) extracted this block from backlog.ts
 * (403 → 360 lines). Pure in-memory state, no I/O — tests can reset
 * via clearRetryCounters() between cases.
 */
/** Maximum number of times a goal may be enqueued before being blocked. */
export const MAX_RETRY_ATTEMPTS = 3;
const retryCounters = new Map();
/**
 * Normalize a goal description into a hash key. Lowercases, strips all
 * non-alphanumeric characters, and trims whitespace. Same algorithm as
 * seedAttempts.ts:hashGoal — if you change one, change the other.
 */
export function hashGoalDescription(goal) {
    return goal
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim();
}
/** Returns how many times `goal` has been enqueued (including the current call). */
export function getRetryCount(goal) {
    return retryCounters.get(hashGoalDescription(goal)) ?? 0;
}
/** Increments the retry counter for `goal` and returns the new value. */
export function incrementRetryCounter(goal) {
    const key = hashGoalDescription(goal);
    const count = (retryCounters.get(key) ?? 0) + 1;
    retryCounters.set(key, count);
    return count;
}
/**
 * Returns true when `goal` has already been enqueued more than
 * MAX_RETRY_ATTEMPTS times and should no longer be re-seeded.
 */
export function isRetryExhausted(goal) {
    return getRetryCount(goal) > MAX_RETRY_ATTEMPTS;
}
/** Test helper: clears all retry counters. */
export function clearRetryCounters() {
    retryCounters.clear();
}
//# sourceMappingURL=retry-counter.js.map