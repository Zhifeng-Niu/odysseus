import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { BacklogOrigin } from '../orchestrator/events.js';
import { isCompleted } from './completedGoals.js';

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
 * - `reflect` (75): failure-driven reflections are urgent — the agent
 *   shouldn't repeat the mistake.
 * - `dream` (100): exploratory work, no urgency.
 * - `system` (100): bookkeeping; same as dream.
 */
function defaultPriorityForOrigin(origin: BacklogOrigin): number {
  switch (origin) {
    case 'user':
      return 50;
    case 'reflect':
      return 75;
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
