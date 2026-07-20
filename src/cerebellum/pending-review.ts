import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  enqueueBacklog,
  listSkippedEnqueues,
  type BacklogItem,
  type SkipReason,
} from './backlog.js';
import type { BacklogOrigin } from '../orchestrator/events.js';

/**
 * Pending review queue — dream/reflect/curiosity proposals wait here for
 * user approval before entering the backlog. Prevents the autonomous
 * dreamer from keeping the voyage loop busy without consent. `user` and
 * `system` origins bypass this queue (they go straight to backlog).
 *
 * Physical shape: `{rootDir}/pending-review.json`. Atomic write via
 * tmp+rename — same pattern as backlog.ts.
 */

export type ReviewableOrigin = Extract<
  BacklogOrigin,
  'dream' | 'reflect' | 'curiosity'
>;

export interface PendingItem {
  /** Stable identifier; format: `pr_<12 hex>` for grep-ability. */
  readonly id: string;
  /** Goal text — what the agent is proposing to do. */
  readonly goal: string;
  /** Always 'dream', 'reflect', or 'curiosity' (other origins skip this queue). */
  readonly origin: ReviewableOrigin;
  /**
   * Priority to use *if* the user approves. Inherited from the producer
   * (dreamer defaults to 100, reflect to 75).
   */
  readonly priority: number;
  readonly createdAt: string; // ISO 8601
  /** Waypoint that produced this proposal, if any (provenance). */
  readonly sourceWaypointId?: string;
}

interface PendingReviewFile {
  readonly version: 1;
  readonly items: PendingItem[];
}

const PENDING_FILENAME = 'pending-review.json';

function pendingPath(rootDir: string): string {
  return join(rootDir, PENDING_FILENAME);
}

function generatePendingId(): string {
  return `pr_${randomBytes(6).toString('hex')}`;
}

async function loadFile(rootDir: string): Promise<PendingReviewFile> {
  let raw: string;
  try {
    raw = await readFile(pendingPath(rootDir), 'utf8');
  } catch {
    return { version: 1, items: [] };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PendingReviewFile>;
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) {
      return { version: 1, items: [] };
    }
    return { version: 1, items: parsed.items as PendingItem[] };
  } catch {
    return { version: 1, items: [] };
  }
}

async function saveFile(rootDir: string, file: PendingReviewFile): Promise<void> {
  const finalPath = pendingPath(rootDir);
  const tmpPath = `${finalPath}.tmp`;
  await mkdir(dirname(finalPath), { recursive: true });
  const payload = JSON.stringify(file, null, 2) + '\n';
  await writeFile(tmpPath, payload, 'utf8');
  await rename(tmpPath, finalPath);
}

export interface EnqueuePendingOptions {
  readonly priority?: number;
  readonly sourceWaypointId?: string;
  readonly id?: string;
  readonly createdAt?: string;
}

/**
 * Drop a dream/reflect proposal into the pending queue. The user must call
 * `approvePendingReview` to move it into the backlog, or `rejectPendingReview`
 * to discard it.
 */
export async function enqueuePendingReview(
  rootDir: string,
  goal: string,
  origin: ReviewableOrigin,
  options?: EnqueuePendingOptions
): Promise<PendingItem> {
  const trimmed = goal.trim();
  if (trimmed.length === 0) {
    throw new Error('pending review goal cannot be empty');
  }
  const file = await loadFile(rootDir);
  const item: PendingItem = {
    id: options?.id ?? generatePendingId(),
    goal: trimmed,
    origin,
    priority: options?.priority ?? defaultPriorityForOrigin(origin),
    createdAt: options?.createdAt ?? new Date().toISOString(),
    ...(options?.sourceWaypointId !== undefined
      ? { sourceWaypointId: options.sourceWaypointId }
      : {}),
  };
  const nextFile: PendingReviewFile = {
    version: 1,
    items: [...file.items, item],
  };
  await saveFile(rootDir, nextFile);
  return item;
}

function defaultPriorityForOrigin(origin: ReviewableOrigin): number {
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

export async function listPendingReview(rootDir: string): Promise<readonly PendingItem[]> {
  const file = await loadFile(rootDir);
  return [...file.items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function sizePendingReview(rootDir: string): Promise<number> {
  const file = await loadFile(rootDir);
  return file.items.length;
}

export interface ApproveResult {
  /** The pending item that was approved. */
  readonly pending: PendingItem;
  /** The resulting backlog item. */
  readonly backlog: BacklogItem;
}

/**
 * Typed error thrown by `approvePendingReview` when `enqueueBacklog` filtered
 * the item via one of its dedup checks. Lets callers distinguish "user tried
 * to approve something the system refused to re-enqueue" from "enqueueBacklog
 * threw unexpectedly". The pending item is NOT removed from pending-review.json
 * when this fires, so the operator can still see and manually reject it.
 */
export class PendingReviewFilteredError extends Error {
  readonly pendingItem: PendingItem;
  readonly reason: SkipReason;

  constructor(pendingItem: PendingItem, reason: SkipReason) {
    super(
      `pending review item "${pendingItem.goal}" filtered by enqueueBacklog: ${reason}`
    );
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
export async function approvePendingReview(
  rootDir: string,
  id: string
): Promise<ApproveResult> {
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
    const lastSkip = listSkippedEnqueues()[skippedAfter - 1]!;
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
export async function rejectPendingReview(rootDir: string, id: string): Promise<boolean> {
  const file = await loadFile(rootDir);
  const remaining = file.items.filter((it) => it.id !== id);
  if (remaining.length === file.items.length) return false;
  await saveFile(rootDir, { version: 1, items: remaining });
  return true;
}

// ---------------------------------------------------------------------------
// Auto-approve — dreamer can bypass the user-consent gate.
//
// `ODYSSEUS_AUTO_APPROVE` (default truthy) routes dreamer proposals directly
// into the backlog instead of leaving them in pending-review.json. Default
// ON because the operator opted into autonomous mode; opt OUT with `=0` for
// supervised runs or demos. pending-review.json is still written for audit
// before auto-approve runs, so operators can grep historical dreamer output.
// ---------------------------------------------------------------------------

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
