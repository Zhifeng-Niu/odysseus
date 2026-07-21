import {
  enqueueBacklog,
  listSkippedEnqueues,
  type BacklogItem,
} from './backlog.js';
import {
  type PendingItem,
  loadFile,
  saveFile,
} from './pending-review.js';

/**
 * Auto-approve policy for the pending-review queue — extracted from
 * pending-review.ts (Iteration 50).
 *
 * `ODYSSEUS_AUTO_APPROVE` (default truthy) routes dreamer proposals
 * directly into the backlog instead of leaving them in pending-review.json.
 * Default ON because the operator opted into autonomous mode; opt OUT with
 * `=0` for supervised runs or demos. pending-review.json is still written
 * for audit before auto-approve runs, so operators can grep historical
 * dreamer output.
 *
 * This module is a sibling to pending-review.ts, mirroring the pattern
 * established in Iter 42 (planner → planner-policy), Iter 47 (dreamer →
 * dreamer-prompt), Iter 48 (self-monitor → self-monitor-patterns), Iter 49
 * (backlog → backlog-enqueue): extract a cohesive policy concern to its
 * own file so the original module shrinks toward pure CRUD.
 */

/**
 * Returns true when dreamer output should bypass pending-review and go
 * straight to the backlog. Defaults to true (autonomous mode) when the env
 * var is absent — operators must explicitly opt OUT with `=0`.
 */
export function shouldAutoApprove(): boolean {
  const v = process.env.ODYSSEUS_AUTO_APPROVE;
  if (v === undefined || v === '') return true;
  return v !== '0' && v !== 'false' && v !== 'no';
}

/**
 * Move every pending proposal into the backlog in one pass. Called by the
 * dreamer when `shouldAutoApprove()` is true. Items that fail to enqueue
 * (validation errors OR dedup-filtered phantom returns) are left in
 * pending-review.json — only items that truly landed in backlog.json are
 * removed.
 */
export async function autoApproveAllPendingReview(
  rootDir: string
): Promise<readonly BacklogItem[]> {
  const file = await loadFile(rootDir);
  if (file.items.length === 0) return [];
  const enqueued: BacklogItem[] = [];
  const remaining: PendingItem[] = [];
  for (const item of file.items) {
    // Iteration 22 — enqueueBacklog's dedup paths return a phantom
    // BacklogItem (right shape, never persisted) + call recordSkippedEnqueue.
    // Observe that side channel: if it grew across the call, the enqueue
    // was filtered — keep the item in pending so the dreamer's proposal
    // stays visible to the operator.
    const skippedBefore = listSkippedEnqueues().length;
    try {
      const result = await enqueueBacklog(rootDir, item.goal, item.origin, {
        priority: item.priority,
        ...(item.sourceWaypointId !== undefined
          ? { sourceWaypointId: item.sourceWaypointId }
          : {}),
      });
      const skippedAfter = listSkippedEnqueues().length;
      if (skippedAfter > skippedBefore) {
        remaining.push(item);
        continue;
      }
      enqueued.push(result);
    } catch {
      remaining.push(item);
    }
  }
  await saveFile(rootDir, { version: 1, items: remaining });
  return enqueued;
}
