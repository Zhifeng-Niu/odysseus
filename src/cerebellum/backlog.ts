import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { BacklogOrigin } from '../orchestrator/events.js';
import { isCompleted } from './completedGoals.js';
import { isSeedExhausted, incrementSeedAttempt } from './seedAttempts.js';

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
  // Block re-seeding when this goal has already been attempted
  // MAX_SEED_ATTEMPTS times regardless of outcome (success/failure/abandon).
  if (isSeedExhausted(trimmedGoal)) {
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
  // Track this enqueue in the per-goal retry counter.
  incrementRetryCounter(trimmedGoal);
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
  return item;
}

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
  // Count this dequeue as a seed attempt so the exhaustion counter
  // tracks how many times the goal has been dispatched for execution.
  incrementSeedAttempt(next.goal);
  const remaining = file.items.filter((it) => it.id !== next.id);
  await saveBacklogFile(rootDir, { version: 1, items: remaining });
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
//
// When the pre-dispatch goal validator (goal-validator.ts) returns
// `valid: false`, the orchestrator abandons the waypoint before any
// checkpoint or LLM work. Those rejections were previously invisible in
// output: the waypoint was marked abandoned and traced, but there was no
// queryable record of *which* goal descriptions were rejected and *why*.
//
// This registry captures both so abandoned goals are traceable. It mirrors
// the in-memory shape of completedGoals.ts / seedAttempts.ts (session-
// scoped, not persisted) and is exposed via `listRejectedGoals()` for
// consumers (TUI, voyage summary, tests) to surface in output.
// ---------------------------------------------------------------------------

/** A goal rejected by the pre-dispatch validator. */
export interface RejectedGoal {
  /** The goal description that was rejected. */
  readonly goal: string;
  /** Human-readable reason the validator gave for rejecting it. */
  readonly reason: string;
  /** Epoch millis when the rejection was recorded. */
  readonly rejectedAt: number;
}

// In-memory store. Insertion-ordered so `listRejectedGoals()` returns the
// oldest rejection first — useful for chronological display.
const rejectedGoals: RejectedGoal[] = [];

/**
 * Records that `goal` was rejected by the validator with `reason`.
 *
 * Called from the orchestrator's pre-dispatch validation path whenever
 * `validateGoal()` returns `{ valid: false }`. Idempotent per (goal, reason)
 * pair: a repeat rejection with identical text and reason is a no-op so the
 * registry doesn't grow unboundedly if the same conversational goal is
 * re-injected. A *different* reason for the same goal is recorded as a new
 * entry so the evolution of rejections stays visible.
 */
export function recordRejectedGoal(goal: string, reason: string): void {
  const trimmedGoal = goal.trim();
  if (trimmedGoal.length === 0) return;
  const trimmedReason = reason.trim();
  // Dedupe identical (goal, reason) rejections — a re-injected greeting
  // shouldn't spam the registry. A changed reason is still recorded.
  const exists = rejectedGoals.some(
    (r) => r.goal === trimmedGoal && r.reason === trimmedReason
  );
  if (exists) return;
  rejectedGoals.push({
    goal: trimmedGoal,
    reason: trimmedReason,
    rejectedAt: Date.now(),
  });
}

/**
 * Returns a snapshot of all rejected goals in insertion (chronological)
 * order. Consumers use this to render abandoned-goal provenance in output.
 */
export function listRejectedGoals(): readonly RejectedGoal[] {
  return rejectedGoals;
}

/** Test helper: clears all recorded rejected goals. */
export function clearRejectedGoals(): void {
  rejectedGoals.length = 0;
}
