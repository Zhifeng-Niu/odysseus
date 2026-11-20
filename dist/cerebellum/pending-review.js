import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { enqueueBacklog, listSkippedEnqueues, } from './backlog.js';
const PENDING_FILENAME = 'pending-review.json';
function pendingPath(rootDir) {
    return join(rootDir, PENDING_FILENAME);
}
function generatePendingId() {
    return `pr_${randomBytes(6).toString('hex')}`;
}
/** Shared with pending-review-auto.ts (Iteration 50 extraction). */
export async function loadFile(rootDir) {
    let raw;
    try {
        raw = await readFile(pendingPath(rootDir), 'utf8');
    }
    catch {
        return { version: 1, items: [] };
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed.version !== 1 || !Array.isArray(parsed.items)) {
            return { version: 1, items: [] };
        }
        return { version: 1, items: parsed.items };
    }
    catch {
        return { version: 1, items: [] };
    }
}
/** Shared with pending-review-auto.ts (Iteration 50 extraction). */
export async function saveFile(rootDir, file) {
    const finalPath = pendingPath(rootDir);
    const tmpPath = `${finalPath}.tmp`;
    await mkdir(dirname(finalPath), { recursive: true });
    const payload = JSON.stringify(file, null, 2) + '\n';
    await writeFile(tmpPath, payload, 'utf8');
    await rename(tmpPath, finalPath);
}
/**
 * Drop a dream/reflect proposal into the pending queue. The user must call
 * `approvePendingReview` to move it into the backlog, or `rejectPendingReview`
 * to discard it.
 */
export async function enqueuePendingReview(rootDir, goal, origin, options) {
    const trimmed = goal.trim();
    if (trimmed.length === 0) {
        throw new Error('pending review goal cannot be empty');
    }
    const file = await loadFile(rootDir);
    const item = {
        id: options?.id ?? generatePendingId(),
        goal: trimmed,
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
    await saveFile(rootDir, nextFile);
    return item;
}
function defaultPriorityForOrigin(origin) {
    // Mirror backlog.ts defaultPriorityForOrigin so the priority the user
    // sees in the pending queue matches what would have been used in backlog.
    switch (origin) {
        case 'reflect':
            return 75;
        case 'curiosity':
            return 90;
        case 'dream':
            return 100;
    }
}
export async function listPendingReview(rootDir) {
    const file = await loadFile(rootDir);
    return [...file.items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export async function sizePendingReview(rootDir) {
    const file = await loadFile(rootDir);
    return file.items.length;
}
/**
 * Typed error thrown by `approvePendingReview` when `enqueueBacklog` filtered
 * the item via one of its dedup checks. Lets callers distinguish "user tried
 * to approve something the system refused to re-enqueue" from "enqueueBacklog
 * threw unexpectedly". The pending item is NOT removed from pending-review.json
 * when this fires, so the operator can still see and manually reject it.
 */
export class PendingReviewFilteredError extends Error {
    pendingItem;
    reason;
    constructor(pendingItem, reason) {
        super(`pending review item "${pendingItem.goal}" filtered by enqueueBacklog: ${reason}`);
        this.name = 'PendingReviewFilteredError';
        this.pendingItem = pendingItem;
        this.reason = reason;
    }
}
/**
 * Move a pending proposal into the backlog. Throws if id not found.
 *
 * Iteration 23 — outbox ordering. Original code saved the reduced
 * pending-review.json BEFORE calling enqueueBacklog, so any failure mode
 * (thrown error OR phantom dedup return) lost the item: no longer in
 * pending, never reached backlog. Now we enqueue first, save only after
 * verified success. Phantom dedup is detected via listSkippedEnqueues
 * side channel and surfaced as PendingReviewFilteredError.
 */
export async function approvePendingReview(rootDir, id) {
    const file = await loadFile(rootDir);
    const item = file.items.find((it) => it.id === id);
    if (item === undefined) {
        throw new Error(`pending review item not found: ${id}`);
    }
    const skippedBefore = listSkippedEnqueues().length;
    const enqueued = await enqueueBacklog(rootDir, item.goal, item.origin, {
        priority: item.priority,
        ...(item.sourceWaypointId !== undefined
            ? { sourceWaypointId: item.sourceWaypointId }
            : {}),
    });
    const skippedAfter = listSkippedEnqueues().length;
    if (skippedAfter > skippedBefore) {
        // Phantom return — enqueueBacklog filtered via dedup. Don't remove
        // from pending; surface to caller as typed error.
        const lastSkip = listSkippedEnqueues()[skippedAfter - 1];
        throw new PendingReviewFilteredError(item, lastSkip.reason);
    }
    // Success — now safe to remove. If this save fails after enqueue wrote
    // to backlog, we get a benign double-entry (item in both files) —
    // strictly better than losing the item.
    const remaining = file.items.filter((it) => it.id !== id);
    await saveFile(rootDir, { version: 1, items: remaining });
    return { pending: item, backlog: enqueued };
}
/**
 * Discard a pending proposal without acting on it. Returns true if an item
 * was removed.
 */
export async function rejectPendingReview(rootDir, id) {
    const file = await loadFile(rootDir);
    const remaining = file.items.filter((it) => it.id !== id);
    if (remaining.length === file.items.length)
        return false;
    await saveFile(rootDir, { version: 1, items: remaining });
    return true;
}
// Re-export moved symbols (Iteration 50 extraction) so existing importers
// (dreamer, orchestrator, tests) do not need to know about the internal
// split. Same pattern as backlog.ts re-exporting backlog-enqueue.js (Iter
// 49) and self-monitor.ts re-exporting self-monitor-patterns.js (Iter 48).
export { shouldAutoApprove, autoApproveAllPendingReview, } from './pending-review-auto.js';
//# sourceMappingURL=pending-review.js.map