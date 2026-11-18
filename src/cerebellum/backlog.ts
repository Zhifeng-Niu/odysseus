import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { BacklogOrigin } from '../orchestrator/events.js';
import { incrementSeedAttempt } from './seedAttempts.js';

// Re-export the in-memory registries (Iteration 39 extraction) for
// interface stability. orchestrator.ts and pending-review.ts import
// these symbols from backlog.ts; we keep the re-export here so those
// callers don't need to change. New callers should import directly from
// './backlog-registries.js'.
export type {
  SkipReason,
  SkippedEnqueue,
  RejectedGoal,
} from './backlog-registries.js';
export {
  recordSkippedEnqueue,
  listSkippedEnqueues,
  clearSkippedEnqueues,
  recordRejectedGoal,
  listRejectedGoals,
  clearRejectedGoals,
} from './backlog-registries.js';

/**
 * Backlog queue — the agent's "short-term working memory".
 *
 * Where memory/ is the long-term cortex (write-once, read-many), the backlog
 * is the workspace scratchpad: dreams and reflections enqueue candidate
 * work items, the voyage loop dequeues them one at a time as the seed goal
 * for the next waypoint.
 *
 * Physical shape: a single JSON file at `{rootDir}/backlog.json`. Small N
 * (expected < 100) makes read-modify-rewrite cheaper than JSONL parsing.
 *
 * Concurrency: not safe for multi-writer. The Orchestrator is the only
 * writer in the spike; if that changes, swap to a real queue (SQLite,
 * Redis, etc).
 */

export interface BacklogItem {
  /** Stable identifier; format: `bl_<12 hex>` for grep-ability. */
  readonly id: string;
  /** Goal text used verbatim as the seed prompt for the next waypoint. */
  readonly goal: string;
  /** Where this item came from — drives UI provenance display. */
  readonly origin: BacklogOrigin;
  /**
   * Priority for dequeue ordering. LOWER number = HIGHER priority.
   * Default 100; user-injected items get 50, dreams get 100, reflections
   * on failures get 75.
   */
  readonly priority: number;
  readonly createdAt: string; // ISO 8601
  /** Waypoint that produced this item, if any (provenance). */
  readonly sourceWaypointId?: string;
}

/**
 * Internal storage shape — exported only because backlog-enqueue.ts
 * (Iteration 49 extraction) needs to construct one for saveBacklogFile.
 * Not part of the public backlog API; new callers should not depend on
 * this shape.
 */
export interface BacklogFile {
  readonly version: 1;
  readonly items: BacklogItem[];
}

const BACKLOG_FILENAME = 'backlog.json';

// Iteration 45 extracted the retry-counter block to retry-counter.ts
// (mirrors seedAttempts.ts). Re-export here so existing imports from
// backlog.ts keep working — same pattern as planner.ts re-exporting
// planner-policy.js (Iter 42) and curiosity.ts re-exporting
// curiosity-prompt.js (Iter 44).
export {
  MAX_RETRY_ATTEMPTS,
  getRetryCount,
  incrementRetryCounter,
  isRetryExhausted,
  clearRetryCounters,
} from './retry-counter.js';
import {
  MAX_RETRY_ATTEMPTS,
  getRetryCount,
  incrementRetryCounter,
  isRetryExhausted,
} from './retry-counter.js';

function backlogPath(rootDir: string): string {
  return join(rootDir, BACKLOG_FILENAME);
}

/** Shared with backlog-enqueue.ts (Iteration 49 extraction). */
export function generateBacklogId(): string {
  return `bl_${randomBytes(6).toString('hex')}`;
}

/** Shared with backlog-enqueue.ts (Iteration 49 extraction). */
export async function loadBacklogFile(rootDir: string): Promise<BacklogFile> {
  let raw: string;
  try {
    raw = await readFile(backlogPath(rootDir), 'utf8');
  } catch {
    return { version: 1, items: [] };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<BacklogFile>;
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) {
      // Corrupt or unknown version — start fresh, do not throw.
      // Production-grade migration would go here; YAGNI for spike.
      return { version: 1, items: [] };
    }
    return { version: 1, items: parsed.items as BacklogItem[] };
  } catch {
    return { version: 1, items: [] };
  }
}

/**
 * Atomic write strategy: write to `backlog.json.tmp` then rename. POSIX
 * rename is atomic so a crash mid-write never leaves a half-written file.
 *
 * Shared with backlog-enqueue.ts (Iteration 49 extraction).
 */
export async function saveBacklogFile(rootDir: string, file: BacklogFile): Promise<void> {
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
function byPriorityThenTime(a: BacklogItem, b: BacklogItem): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.createdAt.localeCompare(b.createdAt);
}

export interface EnqueueOptions {
  readonly priority?: number;
  readonly sourceWaypointId?: string;
  readonly id?: string;
  readonly createdAt?: string;
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
export function defaultPriorityForOrigin(origin: BacklogOrigin): number {
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

export async function dequeueBacklog(rootDir: string): Promise<BacklogItem | null> {
  const file = await loadBacklogFile(rootDir);
  if (file.items.length === 0) return null;
  const sorted = [...file.items].sort(byPriorityThenTime);
  const next = sorted[0]!;
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

export async function peekBacklog(rootDir: string): Promise<BacklogItem | null> {
  const file = await loadBacklogFile(rootDir);
  if (file.items.length === 0) return null;
  const sorted = [...file.items].sort(byPriorityThenTime);
  return sorted[0]!;
}

export async function sizeBacklog(rootDir: string): Promise<number> {
  const file = await loadBacklogFile(rootDir);
  return file.items.length;
}

export async function listBacklog(rootDir: string): Promise<BacklogItem[]> {
  const file = await loadBacklogFile(rootDir);
  return [...file.items].sort(byPriorityThenTime);
}

/**
 * Remove a specific item by id. Returns true if an item was removed.
 * Used when an item becomes obsolete (e.g. superseded by a user injection).
 */
export async function removeBacklogItem(rootDir: string, id: string): Promise<boolean> {
  const file = await loadBacklogFile(rootDir);
  const remaining = file.items.filter((it) => it.id !== id);
  if (remaining.length === file.items.length) return false;
  await saveBacklogFile(rootDir, { version: 1, items: remaining });
  return true;
}

// ---------------------------------------------------------------------------
// Rejected-goal registry — traceability for abandoned goals.
// (Implementation moved to backlog-registries.ts in Iteration 39.)
// ---------------------------------------------------------------------------
