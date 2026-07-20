import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  enqueueBacklog,
  dequeueBacklog,
  peekBacklog,
  sizeBacklog,
  listBacklog,
  removeBacklogItem,
  getRetryCount,
  incrementRetryCounter,
  isRetryExhausted,
  clearRetryCounters,
  listSkippedEnqueues,
  clearSkippedEnqueues,
} from '../../src/cerebellum/backlog.js';
import {
  markCompleted,
  clearCompletedGoals,
} from '../../src/cerebellum/completedGoals.js';
import {
  incrementSeedAttempt,
  clearSeedAttempts,
  getSeedAttemptCount,
} from '../../src/cerebellum/seedAttempts.js';

describe('backlog queue', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'ody-bl-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('enqueue assigns default priority by origin (user=50, reflect=75, dream=100)', async () => {
    const user = await enqueueBacklog(rootDir, 'u', 'user');
    const reflect = await enqueueBacklog(rootDir, 'r', 'reflect');
    const dream = await enqueueBacklog(rootDir, 'd', 'dream');
    expect(user.priority).toBe(50);
    expect(reflect.priority).toBe(75);
    expect(dream.priority).toBe(100);
  });

  test('dequeue returns highest-priority (lowest number) first', async () => {
    await enqueueBacklog(rootDir, 'dream item', 'dream');
    await enqueueBacklog(rootDir, 'user item', 'user');
    await enqueueBacklog(rootDir, 'reflect item', 'reflect');

    const first = await dequeueBacklog(rootDir);
    expect(first?.goal).toBe('user item');

    const second = await dequeueBacklog(rootDir);
    expect(second?.goal).toBe('reflect item');

    const third = await dequeueBacklog(rootDir);
    expect(third?.goal).toBe('dream item');
  });

  test('equal priority preserves FIFO (insertion) order', async () => {
    // Three dream items — all priority 100.
    await enqueueBacklog(rootDir, 'first', 'dream');
    await enqueueBacklog(rootDir, 'second', 'dream');
    await enqueueBacklog(rootDir, 'third', 'dream');

    const first = await dequeueBacklog(rootDir);
    expect(first?.goal).toBe('first');

    const second = await dequeueBacklog(rootDir);
    expect(second?.goal).toBe('second');
  });

  test('peek returns next item without removing it', async () => {
    await enqueueBacklog(rootDir, 'visible', 'user');
    const beforePeek = await sizeBacklog(rootDir);
    expect(beforePeek).toBe(1);

    const peeked = await peekBacklog(rootDir);
    expect(peeked?.goal).toBe('visible');

    const afterPeek = await sizeBacklog(rootDir);
    expect(afterPeek).toBe(1); // still there
  });

  test('dequeue on empty queue returns null (not an error)', async () => {
    const result = await dequeueBacklog(rootDir);
    expect(result).toBeNull();
  });

  test('explicit priority overrides origin default', async () => {
    const item = await enqueueBacklog(rootDir, 'pinned dream', 'dream', {
      priority: 10,
    });
    expect(item.priority).toBe(10);

    // Should dequeue before user (default 50).
    await enqueueBacklog(rootDir, 'user item', 'user');
    const next = await dequeueBacklog(rootDir);
    expect(next?.goal).toBe('pinned dream');
  });

  test('empty goal throws (cannot enqueue void)', async () => {
    await expect(enqueueBacklog(rootDir, '', 'user')).rejects.toThrow(/empty/);
    await expect(enqueueBacklog(rootDir, '   ', 'user')).rejects.toThrow(/empty/);
  });

  test('listBacklog returns all items sorted by priority then time', async () => {
    await enqueueBacklog(rootDir, 'c-dream', 'dream');
    await enqueueBacklog(rootDir, 'a-user', 'user');
    await enqueueBacklog(rootDir, 'b-reflect', 'reflect');

    const list = await listBacklog(rootDir);
    expect(list.map((i) => i.goal)).toEqual(['a-user', 'b-reflect', 'c-dream']);
  });

  test('removeBacklogItem removes by id, returns false for unknown id', async () => {
    const item = await enqueueBacklog(rootDir, 'will remove', 'user');
    const removed = await removeBacklogItem(rootDir, item.id);
    expect(removed).toBe(true);
    expect(await sizeBacklog(rootDir)).toBe(0);

    const missing = await removeBacklogItem(rootDir, 'bl_doesnotexist');
    expect(missing).toBe(false);
  });

  test('persistence survives across calls (writes to JSON file)', async () => {
    await enqueueBacklog(rootDir, 'persisted', 'user');
    const raw = await readFile(join(rootDir, 'backlog.json'), 'utf8');
    expect(raw).toContain('persisted');
    expect(raw).toContain('"version": 1');
  });

  test('item id and createdAt are preserved when explicit', async () => {
    const item = await enqueueBacklog(rootDir, 'pinned', 'user', {
      id: 'bl_fixed',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(item.id).toBe('bl_fixed');
    expect(item.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  test('sourceWaypointId provenance round-trips', async () => {
    const item = await enqueueBacklog(rootDir, 'post-mortem', 'reflect', {
      sourceWaypointId: 'wp_failed001',
    });
    expect(item.sourceWaypointId).toBe('wp_failed001');

    const dequeued = await dequeueBacklog(rootDir);
    expect(dequeued?.sourceWaypointId).toBe('wp_failed001');
  });

  test('corrupt JSON file is treated as empty queue (not an error)', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(rootDir, 'backlog.json'), '{not valid json', 'utf8');
    const size = await sizeBacklog(rootDir);
    expect(size).toBe(0);
    // Subsequent enqueue should work (overwrites the corrupt file).
    const item = await enqueueBacklog(rootDir, 'fresh start', 'user');
    expect(item.id).toMatch(/^bl_/);
  });
});

// ---------------------------------------------------------------------------
// Retry counter — pure unit tests
// ---------------------------------------------------------------------------
describe('retry counter', () => {
  beforeEach(() => {
    clearRetryCounters();
  });

  test('starts at zero for an unseen goal', () => {
    expect(getRetryCount('add login page')).toBe(0);
  });

  test('increments and returns the new count', () => {
    expect(incrementRetryCounter('add login page')).toBe(1);
    expect(incrementRetryCounter('add login page')).toBe(2);
    expect(incrementRetryCounter('add login page')).toBe(3);
  });

  test('tracks different goals independently', () => {
    incrementRetryCounter('goal A');
    incrementRetryCounter('goal A');
    incrementRetryCounter('goal B');
    expect(getRetryCount('goal A')).toBe(2);
    expect(getRetryCount('goal B')).toBe(1);
  });

  test('clearRetryCounters resets all counters to zero', () => {
    incrementRetryCounter('goal A');
    incrementRetryCounter('goal B');
    clearRetryCounters();
    expect(getRetryCount('goal A')).toBe(0);
    expect(getRetryCount('goal B')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isRetryExhausted
// ---------------------------------------------------------------------------
describe('isRetryExhausted', () => {
  beforeEach(() => {
    clearRetryCounters();
  });

  test('returns false when count is below the threshold', () => {
    incrementRetryCounter('fix bug');
    expect(isRetryExhausted('fix bug')).toBe(false);
  });

  test('returns false when count equals the threshold (3)', () => {
    incrementRetryCounter('fix bug');
    incrementRetryCounter('fix bug');
    incrementRetryCounter('fix bug');
    expect(isRetryExhausted('fix bug')).toBe(false);
  });

  test('returns true when count exceeds the threshold (4)', () => {
    incrementRetryCounter('fix bug');
    incrementRetryCounter('fix bug');
    incrementRetryCounter('fix bug');
    incrementRetryCounter('fix bug');
    expect(isRetryExhausted('fix bug')).toBe(true);
  });

  test('normalises goal text — punctuation and casing are ignored', () => {
    incrementRetryCounter('Add Retry Logic!');
    incrementRetryCounter('add retry logic');
    incrementRetryCounter('ADD-RETRY-LOGIC');
    incrementRetryCounter('addretrylogic');
    // All four map to the same key, so count is 4 → exhausted
    expect(isRetryExhausted('add retry logic')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration: enqueue blocks re-seed after 3 attempts
// ---------------------------------------------------------------------------
describe('enqueueBacklog – retry counter blocks re-seed after 3 attempts', () => {
  let rootDir: string;

  beforeEach(async () => {
    clearRetryCounters();
    rootDir = await mkdtemp(join(tmpdir(), 'ody-bl-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('enqueues a goal successfully on the first 4 attempts', async () => {
    for (let i = 0; i < 4; i++) {
      await enqueueBacklog(rootDir, 'fix the login bug', 'dream');
    }
    expect(await sizeBacklog(rootDir)).toBe(4);
  });

  test('does not enqueue on the 5th attempt — returns item but backlog stays at 4', async () => {
    for (let i = 0; i < 4; i++) {
      await enqueueBacklog(rootDir, 'fix the login bug', 'dream');
    }
    const item = await enqueueBacklog(rootDir, 'fix the login bug', 'dream');
    // The function still returns a BacklogItem (silent drop), but the file
    // should not have grown.
    expect(item).toBeDefined();
    expect(item.goal).toBe('fix the login bug');
    expect(await sizeBacklog(rootDir)).toBe(4);
  });

  test('counts enqueue calls across different wordings of the same goal', async () => {
    await enqueueBacklog(rootDir, 'Fix the login bug!', 'dream');
    await enqueueBacklog(rootDir, 'fix the login bug', 'dream');
    await enqueueBacklog(rootDir, 'FIX-THE-LOGIN-BUG', 'dream');
    await enqueueBacklog(rootDir, 'fixthe loginbug', 'dream');
    // All four normalise to the same key, so count is 4 — still allowed.
    expect(await sizeBacklog(rootDir)).toBe(4);

    // Fifth enqueue (different wording, same normalised key) → blocked.
    const item = await enqueueBacklog(rootDir, 'fix the login Bug', 'dream');
    expect(item).toBeDefined();
    expect(await sizeBacklog(rootDir)).toBe(4);
  });

  test('allows a different goal to be enqueued after the first goal is exhausted', async () => {
    // Exhaust "goal A" (5 attempts: 4 succeed, 5th blocked)
    for (let i = 0; i < 5; i++) {
      await enqueueBacklog(rootDir, 'goal A', 'dream');
    }
    expect(await sizeBacklog(rootDir)).toBe(4); // only 4 enqueued

    // "goal B" should still work
    await enqueueBacklog(rootDir, 'goal B', 'dream');
    expect(await sizeBacklog(rootDir)).toBe(5);
  });

  test('retry counter is incremented by enqueue, not by dequeue', async () => {
    await enqueueBacklog(rootDir, 'track dequeue', 'dream');
    expect(getRetryCount('track dequeue')).toBe(1);

    await dequeueBacklog(rootDir);
    // Dequeue does NOT touch the retry counter (it touches seedAttempts).
    expect(getRetryCount('track dequeue')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Iteration 18 — user-origin items bypass every dedup check.
//
// Bug: resending a prior message (e.g. "你好" twice) caused enqueueBacklog
// to silently drop the item via isCompleted / isSeedExhausted /
// isRetryExhausted. The backlog stayed empty, peekBacklog returned null,
// and voyage-idle fired immediately — the user saw zero response.
//
// Fix: origin === 'user' bypasses all three checks. User input MUST always
// produce a waypoint. The dedup registry stays in place for autonomous
// origins (dream, reflect, curiosity, system, plan).
//
// Also adds a skipped-enqueue registry so future regressions of the
// autonomous-path drops are diagnosable.
// ---------------------------------------------------------------------------
describe('Iteration 18 — user-origin bypasses dedup checks', () => {
  let rootDir: string;

  beforeEach(async () => {
    clearRetryCounters();
    clearCompletedGoals();
    clearSeedAttempts();
    clearSkippedEnqueues();
    rootDir = await mkdtemp(join(tmpdir(), 'ody-bl-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('user-origin enqueues even when isCompleted returns true', async () => {
    // Simulate "你好" having been completed in a prior voyage.
    markCompleted('你好', 'prior voyage responded with greeting');
    expect(await sizeBacklog(rootDir)).toBe(0);

    // User resends the same message — must still enqueue.
    const item = await enqueueBacklog(rootDir, '你好', 'user');
    expect(item.goal).toBe('你好');
    expect(await sizeBacklog(rootDir)).toBe(1);

    // The skipped registry must NOT record this — user-origin skips are
    // impossible by construction. If this entry appears, the bypass is
    // broken.
    expect(listSkippedEnqueues()).toHaveLength(0);
  });

  test('user-origin enqueues even when isSeedExhausted returns true', async () => {
    // Exhaust the seed counter — autonomous origins would be blocked.
    incrementSeedAttempt('refactor this');
    incrementSeedAttempt('refactor this');
    incrementSeedAttempt('refactor this');

    // User re-request must still enqueue.
    const item = await enqueueBacklog(rootDir, 'refactor this', 'user');
    expect(item.goal).toBe('refactor this');
    expect(await sizeBacklog(rootDir)).toBe(1);
    expect(listSkippedEnqueues()).toHaveLength(0);
  });

  test('user-origin enqueues even when isRetryExhausted returns true', async () => {
    // Exhaust the retry counter — autonomous origins would be blocked.
    for (let i = 0; i < 5; i++) {
      incrementRetryCounter('add login page');
    }

    // User re-request must still enqueue.
    const item = await enqueueBacklog(rootDir, 'add login page', 'user');
    expect(item.goal).toBe('add login page');
    expect(await sizeBacklog(rootDir)).toBe(1);
    expect(listSkippedEnqueues()).toHaveLength(0);
  });

  test('user-origin enqueues when ALL THREE dedup checks would trip', async () => {
    // Make every check return true simultaneously.
    markCompleted('fix bug', 'done');
    incrementSeedAttempt('fix bug');
    incrementSeedAttempt('fix bug');
    incrementSeedAttempt('fix bug');
    for (let i = 0; i < 5; i++) {
      incrementRetryCounter('fix bug');
    }

    // User input must still enqueue.
    const item = await enqueueBacklog(rootDir, 'fix bug', 'user');
    expect(item.goal).toBe('fix bug');
    expect(await sizeBacklog(rootDir)).toBe(1);
    expect(listSkippedEnqueues()).toHaveLength(0);
  });

  test('user-origin still increments the retry counter (informational)', async () => {
    // The retry counter is a per-goal activity signal. A user resending
    // the same input 50 times should produce 50 increments — so other
    // modules can observe the activity. The counter is informational for
    // user-origin, NOT a gate.
    expect(getRetryCount('repeat me')).toBe(0);
    await enqueueBacklog(rootDir, 'repeat me', 'user');
    expect(getRetryCount('repeat me')).toBe(1);
    await enqueueBacklog(rootDir, 'repeat me', 'user');
    expect(getRetryCount('repeat me')).toBe(2);
  });

  test('dream-origin is still deduped (no regression on autonomous path)', async () => {
    // Sanity: the bypass is user-only. Autonomous origins must still hit
    // every dedup check exactly as before.
    markCompleted('dream goal', 'done');
    const item = await enqueueBacklog(rootDir, 'dream goal', 'dream');
    // Returns phantom item but does NOT write.
    expect(item).toBeDefined();
    expect(await sizeBacklog(rootDir)).toBe(0);
    // And the skip IS recorded — that's the observability signal.
    const skipped = listSkippedEnqueues();
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.goal).toBe('dream goal');
    expect(skipped[0]!.origin).toBe('dream');
    expect(skipped[0]!.reason).toBe('already-completed');
  });

  test('skipped registry records all three skip reasons distinctly', async () => {
    // Trigger each dedup path with a different autonomous origin.
    markCompleted('completed-goal', 'done');
    incrementSeedAttempt('seed-exhausted-goal');
    incrementSeedAttempt('seed-exhausted-goal');
    incrementSeedAttempt('seed-exhausted-goal');
    for (let i = 0; i < 5; i++) {
      incrementRetryCounter('retry-exhausted-goal');
    }

    await enqueueBacklog(rootDir, 'completed-goal', 'dream');
    await enqueueBacklog(rootDir, 'seed-exhausted-goal', 'reflect');
    await enqueueBacklog(rootDir, 'retry-exhausted-goal', 'curiosity');

    const skipped = listSkippedEnqueues();
    expect(skipped).toHaveLength(3);
    const reasons = new Set(skipped.map((s) => s.reason));
    expect(reasons).toEqual(
      new Set(['already-completed', 'seed-exhausted', 'retry-exhausted'])
    );
  });

  test('user-origin preserves sourceWaypointId when provided', async () => {
    // The bypass path must still honor all EnqueueOptions.
    const item = await enqueueBacklog(rootDir, 'user with provenance', 'user', {
      sourceWaypointId: 'wp_abc123',
      id: 'bl_fixed',
      priority: 25,
    });
    expect(item.sourceWaypointId).toBe('wp_abc123');
    expect(item.id).toBe('bl_fixed');
    expect(item.priority).toBe(25);

    const dequeued = await dequeueBacklog(rootDir);
    expect(dequeued?.sourceWaypointId).toBe('wp_abc123');
    expect(dequeued?.priority).toBe(25);
  });
});

describe('Iteration 24 — counter drift on save failure (outbox ordering)', () => {
  let rootDir: string;

  beforeEach(async () => {
    clearRetryCounters();
    clearCompletedGoals();
    clearSeedAttempts();
    clearSkippedEnqueues();
    rootDir = await mkdtemp(join(tmpdir(), 'ody-bl-cd-'));
  });

  afterEach(async () => {
    // Restore writable in case a test failed mid-block.
    await chmod(rootDir, 0o755).catch(() => undefined);
    await rm(rootDir, { recursive: true, force: true });
  });

  test('enqueueBacklog does NOT increment retry counter when save throws', async () => {
    // The original code called incrementRetryCounter BEFORE saveBacklogFile.
    // If save threw, the counter was already bumped — after 3 such failures,
    // isRetryExhausted would return true and silently block all future
    // enqueues. The fix moves the increment AFTER successful save.
    //
    // We force save to throw by making rootDir read-only after creation.
    await chmod(rootDir, 0o555);
    await expect(enqueueBacklog(rootDir, 'blocked', 'user')).rejects.toThrow();
    expect(getRetryCount('blocked')).toBe(0);
  });

  test('dequeueBacklog does NOT increment seed counter when save throws', async () => {
    // Same pattern as enqueue: seed counter must only count actual
    // dequeues, not failed save attempts. Original code mutated the
    // counter before saveBacklogFile — fix reorders.
    //
    // Seed an item first (while dir is writable), THEN make it read-only
    // and try to dequeue.
    await enqueueBacklog(rootDir, 'queued', 'user');
    await chmod(rootDir, 0o555);
    await expect(dequeueBacklog(rootDir)).rejects.toThrow();
    expect(getSeedAttemptCount('queued')).toBe(0);
  });
});
