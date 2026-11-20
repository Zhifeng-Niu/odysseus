import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { incrementSeedAttempt } from './seedAttempts.js';
export { recordSkippedEnqueue, listSkippedEnqueues, clearSkippedEnqueues, recordRejectedGoal, listRejectedGoals, clearRejectedGoals, } from './backlog-registries.js';
const BACKLOG_FILENAME = 'backlog.json';
// Iteration 45 extracted the retry-counter block to retry-counter.ts
// (mirrors seedAttempts.ts). Re-export here so existing imports from
// backlog.ts keep working — same pattern as planner.ts re-exporting
// planner-policy.js (Iter 42) and curiosity.ts re-exporting
// curiosity-prompt.js (Iter 44).
export { MAX_RETRY_ATTEMPTS, getRetryCount, incrementRetryCounter, isRetryExhausted, clearRetryCounters, } from './retry-counter.js';
function backlogPath(rootDir) {
    return join(rootDir, BACKLOG_FILENAME);
}
/** Shared with backlog-enqueue.ts (Iteration 49 extraction). */
export function generateBacklogId() {
    return `bl_${randomBytes(6).toString('hex')}`;
}
/** Shared with backlog-enqueue.ts (Iteration 49 extraction). */
export async function loadBacklogFile(rootDir) {
    let raw;
    try {
        raw = await readFile(backlogPath(rootDir), 'utf8');
    }
    catch {
        return { version: 1, items: [] };
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed.version !== 1 || !Array.isArray(parsed.items)) {
            // Corrupt or unknown version — start fresh, do not throw.
            // Production-grade migration would go here; YAGNI for spike.
            return { version: 1, items: [] };
        }
        return { version: 1, items: parsed.items };
    }
    catch {
        return { version: 1, items: [] };
    }
}
/**
 * Atomic write strategy: write to `backlog.json.tmp` then rename. POSIX
 * rename is atomic so a crash mid-write never leaves a half-written file.
 *
 * Shared with backlog-enqueue.ts (Iteration 49 extraction).
 */
export async function saveBacklogFile(rootDir, file) {
    const finalPath = backlogPath(rootDir);
    const tmpPath = `${finalPath}.tmp`;
    await mkdir(dirname(finalPath), { recursive: true });
    const payload = JSON.stringify(file, null, 2) + '\n';
    await writeFile(tmpPath, payload, 'utf8');
    await rename(tmpPath, finalPath);
}
/**
 * Sort comparator: priority ascending, then createdAt ascending. Stable so
 * items with equal priority preserve their insertion order.
 */
function byPriorityThenTime(a, b) {
    if (a.priority !== b.priority)
        return a.priority - b.priority;
    return a.createdAt.localeCompare(b.createdAt);
}
// Re-export moved symbol (Iteration 49 extraction) so existing importers
// (orchestrator, pending-review, dreamer, curiosity, tests) do not need
// to know about the internal split. Same pattern as planner.ts re-exporting
// planner-policy.js (Iter 42), curiosity.ts re-exporting curiosity-prompt.js
// (Iter 44), backlog.ts re-exporting retry-counter.js (Iter 45), and
// self-monitor.ts re-exporting self-monitor-patterns.js (Iter 48).
export { enqueueBacklog } from './backlog-enqueue.js';
// ---------------------------------------------------------------------------
// Skipped-enqueue registry — observability for silently-dropped enqueues.
// (Implementation moved to backlog-registries.ts in Iteration 39.)
// ---------------------------------------------------------------------------
/**
 * Default priority by origin. Lower = higher priority.
 *
 * - `user` (50): user-initiated work always preempts autonomous work.
 * - `plan` (50): planner-decomposed sub-tasks of a user goal. Same urgency
 *   as the user goal that spawned them — the agent committed to this plan,
 *   so it preempts reflect/dream/curiosity the same way the original user
 *   goal would have. Priority matches `user` rather than sitting between
 *   user and reflect because plan steps ARE user-intent, just structured.
 * - `reflect` (75): failure-driven reflections are urgent — the agent
 *   shouldn't repeat the mistake.
 * - `curiosity` (90): forward-looking exploration of aspirations. Preempts
 *   idle dreaming (lower priority than fixing failures, but higher than
 *   abstract dream proposals).
 * - `dream` (100): exploratory work, no urgency.
 * - `system` (100): bookkeeping; same as dream.
 *
 * Shared with backlog-enqueue.ts (Iteration 49 extraction).
 */
export function defaultPriorityForOrigin(origin) {
    switch (origin) {
        case 'user':
        case 'plan':
            return 50;
        case 'reflect':
            return 75;
        case 'curiosity':
            return 90;
        case 'perception':
            // Environment state changes are worth handling soon but rarely
            // urgent — above dreams, below reflection on failures.
            return 95;
        case 'dream':
        case 'system':
            return 100;
    }
}
export async function dequeueBacklog(rootDir) {
    const file = await loadBacklogFile(rootDir);
    if (file.items.length === 0)
        return null;
    const sorted = [...file.items].sort(byPriorityThenTime);
    const next = sorted[0];
    const remaining = file.items.filter((it) => it.id !== next.id);
    await saveBacklogFile(rootDir, { version: 1, items: remaining });
    // Iteration 24 — increment the seed counter AFTER save succeeds. The
    // original code incremented before save, so a failed save would bump the
    // counter without actually dequeuing — three such failures and the goal
    // would be permanently blocked by isSeedExhausted, even though it never
    // left the queue. Outbox ordering: mutate durable state first, then the
    // in-memory counter that depends on it.
    incrementSeedAttempt(next.goal);
    return next;
}
export async function peekBacklog(rootDir) {
    const file = await loadBacklogFile(rootDir);
    if (file.items.length === 0)
        return null;
    const sorted = [...file.items].sort(byPriorityThenTime);
    return sorted[0];
}
export async function sizeBacklog(rootDir) {
    const file = await loadBacklogFile(rootDir);
    return file.items.length;
}
export async function listBacklog(rootDir) {
    const file = await loadBacklogFile(rootDir);
    return [...file.items].sort(byPriorityThenTime);
}
/**
 * Remove a specific item by id. Returns true if an item was removed.
 * Used when an item becomes obsolete (e.g. superseded by a user injection).
 */
export async function removeBacklogItem(rootDir, id) {
    const file = await loadBacklogFile(rootDir);
    const remaining = file.items.filter((it) => it.id !== id);
    if (remaining.length === file.items.length)
        return false;
    await saveBacklogFile(rootDir, { version: 1, items: remaining });
    return true;
}
// ---------------------------------------------------------------------------
// Rejected-goal registry — traceability for abandoned goals.
// (Implementation moved to backlog-registries.ts in Iteration 39.)
// ---------------------------------------------------------------------------
//# sourceMappingURL=backlog.js.map