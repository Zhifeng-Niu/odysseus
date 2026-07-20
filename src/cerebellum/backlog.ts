import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { BacklogOrigin } from '../orchestrator/events.js';
import { isCompleted } from './completedGoals.js';
import { isSeedExhausted, incrementSeedAttempt } from './seedAttempts.js';

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
import { recordSkippedEnqueue } from './backlog-registries.js';

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

interface BacklogFile {
  readonly version: 1;
  readonly items: BacklogItem[];
}

const BACKLOG_FILENAME = 'backlog.json';

// ---------------------------------------------------------------------------
// Per-goal retry counter — blocks re-seeding after MAX_RETRY_ATTEMPTS
// enqueues.  Uses a normalised hash of the goal description as key so that
// minor wording differences ("add retry" vs "Add Retry!") share the same
// counter.
// ---------------------------------------------------------------------------

const MAX_RETRY_ATTEMPTS = 3;
const retryCounters: Map<string, number> = new Map();

/** Normalise a goal description into a stable hash key. */
function hashGoalDescription(goal: string): string {
  return goal
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/** Returns how many times `goal` has been enqueued (including the current call). */
export function getRetryCount(goal: string): number {
  return retryCounters.get(hashGoalDescription(goal)) ?? 0;
}

/** Increments the retry counter for `goal` and returns the new value. */
export function incrementRetryCounter(goal: string): number {
  const key = hashGoalDescription(goal);
  const count = (retryCounters.get(key) ?? 0) + 1;
  retryCounters.set(key, count);
  return count;
}

/**
 * Returns true when `goal` has already been enqueued more than
 * MAX_RETRY_ATTEMPTS times and should no longer be re-seeded.
 */
export function isRetryExhausted(goal: string): boolean {
  return getRetryCount(goal) > MAX_RETRY_ATTEMPTS;
}

/** Test helper: clears all retry counters. */
export function clearRetryCounters(): void {
  retryCounters.clear();
}

function backlogPath(rootDir: string): string {
  return join(rootDir, BACKLOG_FILENAME);
}

function generateBacklogId(): string {
  return `bl_${randomBytes(6).toString('hex')}`;
}

async function loadBacklogFile(rootDir: string): Promise<BacklogFile> {
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
 */
async function saveBacklogFile(rootDir: string, file: BacklogFile): Promise<void> {
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

export async function enqueueBacklog(
  rootDir: string,
  goal: string,
  origin: BacklogOrigin,
  options?: EnqueueOptions
): Promise<BacklogItem> {
  const trimmedGoal = goal.trim();
  if (trimmedGoal.length === 0) {
    throw new Error('backlog goal cannot be empty');
  }
  // Iteration 18 — user-origin items bypass every dedup check.
  //
  // The three checks below (isSeedExhausted, isRetryExhausted, isCompleted)
  // exist to prevent the dreamer/reflection loop from endlessly re-enqueueing
  // flaky or already-done work. They are correct for autonomous-origin items
  // (dream, reflect, curiosity, system, plan).
  //
  // But when origin === 'user', the item is an explicit, intentional request
  // from the operator. Silently dropping it because the same string was seen
  // before breaks the agent's most fundamental contract: when a user sends
  // input, the agent MUST respond. Without this bypass, resending "你好" or
  // any prior message causes enqueueBacklog to return a phantom item without
  // writing to the file, peekBacklog returns null on the next tick, and
  // voyage-idle fires immediately — the user sees zero response. From their
  // perspective the agent has died.
  //
  // If the user re-sends the exact same goal, that is itself signal: either
  // the prior response was unsatisfying, or they lost track of state. Either
  // way the agent must produce another waypoint. The dedup machinery stays
  // in place for autonomous origins.
  if (origin === 'user') {
    return enqueueUserOrigin(rootDir, trimmedGoal, options);
  }

  // Block re-seeding when this goal has already been attempted
  // MAX_SEED_ATTEMPTS times regardless of outcome (success/failure/abandon).
  if (isSeedExhausted(trimmedGoal)) {
    recordSkippedEnqueue(trimmedGoal, origin, 'seed-exhausted');
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
  // Block re-seeding when the per-goal retry counter (tracked in this
  // module) has exceeded MAX_RETRY_ATTEMPTS enqueues.
  if (isRetryExhausted(trimmedGoal)) {
    console.warn(
      `[backlog] blocking re-seed: retry counter exhausted (${getRetryCount(trimmedGoal)}/${MAX_RETRY_ATTEMPTS}) for goal: "${trimmedGoal}"`
    );
    recordSkippedEnqueue(trimmedGoal, origin, 'retry-exhausted');
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
  // Skip enqueueing when this goal has already been recorded as completed by
  // markCompleted — prevents the voyage loop from re-seeding done work.
  if (isCompleted(trimmedGoal)) {
    recordSkippedEnqueue(trimmedGoal, origin, 'already-completed');
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
  const file = await loadBacklogFile(rootDir);
  const item: BacklogItem = {
    id: options?.id ?? generateBacklogId(),
    goal: trimmedGoal,
    origin,
    priority: options?.priority ?? defaultPriorityForOrigin(origin),
    createdAt: options?.createdAt ?? new Date().toISOString(),
    ...(options?.sourceWaypointId !== undefined
      ? { sourceWaypointId: options.sourceWaypointId }
      : {}),
  };
  const nextFile: BacklogFile = {
    version: 1,
    items: [...file.items, item],
  };
  await saveBacklogFile(rootDir, nextFile);
  // Iteration 24 — increment the retry counter AFTER save succeeds. The
  // original code incremented before save, so a failed save (disk full,
  // permissions) would bump the counter without the item landing in the
  // queue — three such failures and isRetryExhausted would silently block
  // all future enqueues of this goal, permanently freezing the agent on
  // a goal that was never actually queued.
  incrementRetryCounter(trimmedGoal);
  return item;
}

/**
 * User-origin enqueue path — bypasses all dedup checks.
 *
 * See the comment at the top of `enqueueBacklog` for the rationale: the
 * dedup registry is for autonomous-loop protection, not for filtering user
 * input. This helper still increments the retry counter (so the autonomous
 * loops can observe "this goal has been seen N times" via getRetryCount)
 * but always writes to the backlog file.
 *
 * The retry counter increment is informational here, not a gate — a user
 * resending the same input 50 times should still get 50 waypoints. The
 * counter just lets other modules see the activity.
 */
async function enqueueUserOrigin(
  rootDir: string,
  trimmedGoal: string,
  options?: EnqueueOptions
): Promise<BacklogItem> {
  const file = await loadBacklogFile(rootDir);
  const item: BacklogItem = {
    id: options?.id ?? generateBacklogId(),
    goal: trimmedGoal,
    origin: 'user',
    priority: options?.priority ?? defaultPriorityForOrigin('user'),
    createdAt: options?.createdAt ?? new Date().toISOString(),
    ...(options?.sourceWaypointId !== undefined
      ? { sourceWaypointId: options.sourceWaypointId }
      : {}),
  };
  const nextFile: BacklogFile = {
    version: 1,
    items: [...file.items, item],
  };
  await saveBacklogFile(rootDir, nextFile);
  // Iteration 24 — increment after save succeeds (see enqueueBacklog fix).
  incrementRetryCounter(trimmedGoal);
  return item;
}

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
 */
function defaultPriorityForOrigin(origin: BacklogOrigin): number {
  switch (origin) {
    case 'user':
    case 'plan':
      return 50;
    case 'reflect':
      return 75;
    case 'curiosity':
      return 90;
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
