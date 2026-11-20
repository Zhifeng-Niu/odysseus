/**
 * Goal de-duplication helpers used by the dreamer to filter backlog items.
 *
 * Two layers of defense against backlog pollution:
 *   1. buildSucceededGoalSet — exact-match refusal of goals that have already
 *      shipped successfully (prevents "add retry" re-seeding once it lands).
 *   2. isDuplicateGoal — Jaccard token-overlap check that catches reworded
 *      variants ("add retry to glm" vs "add retry logic to glm provider").
 *
 * Extracted from dreamer.ts in Iteration 36 to keep that file under the
 * CLAUDE.md 300-line cap. Pure functions, no I/O, no LLM calls. Tests in
 * tests/unit/dreamer.test.ts under 'dreamer dedup helpers'.
 */
/** Normalize a goal for de-duplication: lowercase, strip punctuation, collapse whitespace. */
export function normalizeGoal(goal) {
    return goal
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
/** Tokenize a goal for Jaccard comparison. Drops 1-char tokens (noise). */
function goalTokens(goal) {
    const tokens = normalizeGoal(goal)
        .split(' ')
        .filter((t) => t.length > 1);
    return new Set(tokens);
}
/**
 * Decide whether `newGoal` duplicates any goal in `existing`. Two strategies:
 *
 *   1. Exact match after normalization (catches whitespace/case variants).
 *   2. Jaccard token similarity ≥ 0.5 (catches reworded variants like
 *      "add retry to glm" vs "add retry logic to glm provider").
 *
 * Threshold of 0.5 is deliberately low — false positives are cheaper than
 * false negatives in a self-evolution backlog (better to skip one good item
 * than to enqueue five near-duplicates that all execute the same change).
 */
export function isDuplicateGoal(newGoal, existing) {
    const normalized = normalizeGoal(newGoal);
    if (normalized.length === 0)
        return false;
    if (existing.has(normalized))
        return true;
    const newTokens = goalTokens(newGoal);
    if (newTokens.size === 0)
        return false;
    for (const raw of existing) {
        const existingNorm = normalizeGoal(raw);
        if (existingNorm === normalized)
            return true;
        const existingTokens = goalTokens(raw);
        if (existingTokens.size === 0)
            continue;
        let intersection = 0;
        for (const t of newTokens) {
            if (existingTokens.has(t))
                intersection += 1;
        }
        const union = new Set([...newTokens, ...existingTokens]).size;
        if (union === 0)
            continue;
        if (intersection / union >= 0.5)
            return true;
    }
    return false;
}
/**
 * Build the set of goals already completed successfully. The dreamer refuses
 * to re-enqueue anything in this set, so the backlog cannot accumulate
 * "add retry", "add retry logic", "add a retry", ... variants across dreams.
 */
export function buildSucceededGoalSet(trace) {
    const set = new Set();
    for (const r of trace) {
        if (r.outcome === 'success' && r.goal.trim().length > 0) {
            set.add(r.goal);
        }
    }
    return set;
}
//# sourceMappingURL=dreamer-dedup.js.map