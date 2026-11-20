/**
 * In-memory registry of how many times each goal description has been
 * seeded for waypoint execution (via enqueueBacklog → dequeueBacklog →
 * runWaypoint). After MAX_SEED_ATTEMPTS (3), further re-seeding is blocked
 * regardless of outcome — success, failure, and abandonment all count.
 *
 * This prevents the dreamer/reflection loop from endlessly re-enqueueing
 * the same flaky goal that never converges.
 *
 * Keying uses a normalized hash of the goal description (lowercased,
 * non-alphanumeric stripped) so that "add retry" and "Add Retry" share
 * the same counter.
 */
/** Maximum number of times a goal may be seeded before being blocked. */
export const MAX_SEED_ATTEMPTS = 3;
const seedAttempts = new Map();
/**
 * Normalize a goal description into a hash key. Lowercases, strips all
 * non-alphanumeric characters, and trims whitespace. This is intentionally
 * aggressive — "add retry to glm" and "Add Retry to GLM!" map to the same
 * key, which is the desired behavior for preventing re-seeding loops.
 */
export function hashGoal(goal) {
    return goal
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim();
}
/**
 * Returns the number of times `goal` has been attempted (dequeued for
 * waypoint execution). Returns 0 if never attempted.
 */
export function getSeedAttemptCount(goal) {
    return seedAttempts.get(hashGoal(goal)) ?? 0;
}
/**
 * Increments the attempt counter for `goal` and returns the new count.
 * Called when a goal is dequeued from the backlog for waypoint execution.
 */
export function incrementSeedAttempt(goal) {
    const key = hashGoal(goal);
    const count = (seedAttempts.get(key) ?? 0) + 1;
    seedAttempts.set(key, count);
    return count;
}
/**
 * Returns true if `goal` has been attempted MAX_SEED_ATTEMPTS or more
 * times and should no longer be re-seeded into the backlog.
 */
export function isSeedExhausted(goal) {
    return getSeedAttemptCount(goal) >= MAX_SEED_ATTEMPTS;
}
/** Test helper: clears all seed attempt counters. */
export function clearSeedAttempts() {
    seedAttempts.clear();
}
//# sourceMappingURL=seedAttempts.js.map