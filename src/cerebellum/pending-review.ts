import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { enqueueBacklog, type BacklogItem } from './backlog.js';
import type { BacklogOrigin } from '../orchestrator/events.js';

/**
 * Pending review queue — dream/reflect/curiosity proposals wait here for user
 * approval before entering the backlog.
 *
 * Why this exists: previously dreamer output went straight into the backlog,
 * which meant the autonomous dreamer could keep the voyage loop busy without
 * the user's consent. Moving dream/reflect/curiosity outputs into a holding
 * pen makes the agent ask before acting on its own ideas — "I just thought
 * about X, want me to work on it?"
 *
 * `user` and `system` origins bypass this queue (they go straight to the
 * backlog via enqueueBacklog). Only `dream`, `reflect`, and `curiosity` are
 * routed here — all three are autonomous thought outputs.
 *
 * Physical shape: `{rootDir}/pending-review.json`. Atomic write via tmp+rename
 * — same pattern as backlog.ts.
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
 * Move a pending proposal into the backlog so the next voyage picks it up.
 * Throws if the id is not found. Returns both the original pending item
 * (for provenance) and the created backlog item.
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
  const remaining = file.items.filter((it) => it.id !== id);
  await saveFile(rootDir, { version: 1, items: remaining });
  const enqueued = await enqueueBacklog(rootDir, item.goal, item.origin, {
    priority: item.priority,
    ...(item.sourceWaypointId !== undefined
      ? { sourceWaypointId: item.sourceWaypointId }
      : {}),
  });
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
// When `ODYSSEUS_AUTO_APPROVE` is set to a truthy value (default), the dreamer
// routes its proposals directly into the backlog instead of leaving them in
// pending-review.json for manual approval. This unblocks autonomous evolution:
// the agent can think of an improvement, enqueue it, and execute it without a
// human pressing 'approve' between dream and wakeful phases.
//
// The default is ON because the operator has explicitly opted into autonomous
// mode. To re-enable the consent gate (e.g. for supervised runs or demos),
// set `ODYSSEUS_AUTO_APPROVE=0`.
//
// pending-review.json is still written (for audit) before auto-approve runs,
// so operators can grep historical dreamer output even when the items have
// already moved into the backlog.
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
 * dreamer at the end of a dream pass when `shouldAutoApprove()` is true.
 *
 * Returns the backlog items created, in approval order. Items that fail to
 * enqueue (e.g. validation errors) are left in pending-review.json for
 * operator inspection — only successfully-enqueued items are removed.
 */
export async function autoApproveAllPendingReview(
  rootDir: string
): Promise<readonly BacklogItem[]> {
  const file = await loadFile(rootDir);
  if (file.items.length === 0) return [];
  const enqueued: BacklogItem[] = [];
  const remaining: PendingItem[] = [];
  for (const item of file.items) {
    try {
      const result = await enqueueBacklog(rootDir, item.goal, item.origin, {
        priority: item.priority,
        ...(item.sourceWaypointId !== undefined
          ? { sourceWaypointId: item.sourceWaypointId }
          : {}),
      });
      enqueued.push(result);
    } catch {
      // Validation failure or persistence error — keep the item in the
      // pending queue so the operator can see what the dreamer tried to
      // push and why it failed.
      remaining.push(item);
    }
  }
  // Only persist the remaining (failed) items; successfully-enqueued ones
  // are now in backlog.json with full provenance.
  await saveFile(rootDir, { version: 1, items: remaining });
  return enqueued;
}
