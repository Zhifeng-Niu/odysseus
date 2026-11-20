import { isCompleted, getCompletedGoals } from './completedGoals.js';
import { isSeedExhausted } from './seedAttempts.js';
import { recordSkippedEnqueue } from './backlog-registries.js';
import { MAX_RETRY_ATTEMPTS, getRetryCount, incrementRetryCounter, isRetryExhausted, } from './retry-counter.js';
import { findFuzzyDuplicate } from './fuzzy-dedup.js';
import { loadBacklogFile, saveBacklogFile, generateBacklogId, defaultPriorityForOrigin, } from './backlog.js';
/**
 * Enqueue path for the backlog — extracted from backlog.ts (Iteration 49)
 * because enqueueBacklog had grown to ~110 lines with three pre-flight
 * checks (isSeedExhausted, isRetryExhausted, isCompleted) + dedup +
 * the enqueue audit trail. That block is a self-contained policy
 * module over storage primitives in backlog.ts.
 *
 * The dedup gates exist to prevent the dreamer/reflection loop from
 * endlessly re-enqueueing flaky or already-done work. They are correct
 * for autonomous-origin items (dream, reflect, curiosity, system, plan).
 * User-origin items bypass them — see the comment in enqueueBacklog.
 */
/**
 * Build a phantom BacklogItem for a dedup-blocked enqueue. The item is
 * returned to the caller but NOT written to disk. All four dedup gates
 * share this shape.
 */
function phantomItem(trimmedGoal, origin, options) {
    return {
        id: options?.id ?? generateBacklogId(),
        goal: trimmedGoal,
        origin,
        priority: options?.priority ?? defaultPriorityForOrigin(origin),
        createdAt: options?.createdAt ?? new Date().toISOString(),
        ...(options?.sourceWaypointId !== undefined
            ? { sourceWaypointId: options.sourceWaypointId }
            : {}),
    };
}
export async function enqueueBacklog(rootDir, goal, origin, options) {
    const trimmedGoal = goal.trim();
    if (trimmedGoal.length === 0) {
        throw new Error('backlog goal cannot be empty');
    }
    // Iteration 18 — user-origin items bypass every dedup check. The dedup
    // gates exist to prevent the dreamer/reflection loop from endlessly
    // re-enqueueing flaky or already-done work. But when origin === 'user',
    // the item is an explicit request from the operator. Silently dropping
    // it because the same string was seen before breaks the agent's most
    // fundamental contract: when a user sends input, the agent MUST respond.
    if (origin === 'user') {
        return enqueueUserOrigin(rootDir, trimmedGoal, options);
    }
    // Dedup gate 1: seed-exhausted (MAX_SEED_ATTEMPTS reached).
    if (isSeedExhausted(trimmedGoal)) {
        recordSkippedEnqueue(trimmedGoal, origin, 'seed-exhausted');
        return phantomItem(trimmedGoal, origin, options);
    }
    // Dedup gate 2: retry-exhausted (per-goal retry counter exceeded).
    if (isRetryExhausted(trimmedGoal)) {
        console.warn(`[backlog] blocking re-seed: retry counter exhausted (${getRetryCount(trimmedGoal)}/${MAX_RETRY_ATTEMPTS}) for goal: "${trimmedGoal}"`);
        recordSkippedEnqueue(trimmedGoal, origin, 'retry-exhausted');
        return phantomItem(trimmedGoal, origin, options);
    }
    // Dedup gate 3: already-completed (exact/substring match via
    // completedGoals registry). Prevents re-seeding done work.
    if (isCompleted(trimmedGoal)) {
        recordSkippedEnqueue(trimmedGoal, origin, 'already-completed');
        return phantomItem(trimmedGoal, origin, options);
    }
    // Dedup gate 4: fuzzy-duplicate (Levenshtein ratio ≥ 0.85 against
    // recently completed goals). Catches near-duplicates that exact/
    // substring matching misses — e.g. "add retry logik to glm" after
    // "add retry logic to glm" shipped. Only checks completed goals, NOT
    // in-progress backlog items — the retry mechanism intentionally
    // re-enqueues the same goal string, so checking against queued items
    // would break it. Runs last because it's O(N×M×K) vs O(1)/O(N) above.
    {
        const existingGoals = new Set();
        for (const cg of getCompletedGoals()) {
            existingGoals.add(cg.description);
        }
        if (findFuzzyDuplicate(trimmedGoal, existingGoals) !== null) {
            recordSkippedEnqueue(trimmedGoal, origin, 'fuzzy-duplicate');
            return phantomItem(trimmedGoal, origin, options);
        }
    }
    const file = await loadBacklogFile(rootDir);
    const item = {
        id: options?.id ?? generateBacklogId(),
        goal: trimmedGoal,
        origin,
        priority: options?.priority ?? defaultPriorityForOrigin(origin),
        createdAt: options?.createdAt ?? new Date().toISOString(),
        ...(options?.sourceWaypointId !== undefined
            ? { sourceWaypointId: options.sourceWaypointId }
            : {}),
    };
    const nextFile = {
        version: 1,
        items: [...file.items, item],
    };
    await saveBacklogFile(rootDir, nextFile);
    // Iteration 24 — increment the retry counter AFTER save succeeds. The
    // original code incremented before save, so a failed save (disk full,
    // permissions) would bump the counter without the item landing in the
    // queue — three such failures and isRetryExhausted would silently block
    // all future enqueues of this goal, permanently freezing the agent.
    incrementRetryCounter(trimmedGoal);
    return item;
}
/**
 * User-origin enqueue path — bypasses all dedup checks.
 *
 * See the comment at the top of `enqueueBacklog` for the rationale. This
 * helper still increments the retry counter (informational, not a gate)
 * but always writes to the backlog file.
 */
async function enqueueUserOrigin(rootDir, trimmedGoal, options) {
    const file = await loadBacklogFile(rootDir);
    const item = {
        id: options?.id ?? generateBacklogId(),
        goal: trimmedGoal,
        origin: 'user',
        priority: options?.priority ?? defaultPriorityForOrigin('user'),
        createdAt: options?.createdAt ?? new Date().toISOString(),
        ...(options?.sourceWaypointId !== undefined
            ? { sourceWaypointId: options.sourceWaypointId }
            : {}),
    };
    const nextFile = {
        version: 1,
        items: [...file.items, item],
    };
    await saveBacklogFile(rootDir, nextFile);
    incrementRetryCounter(trimmedGoal);
    return item;
}
//# sourceMappingURL=backlog-enqueue.js.map