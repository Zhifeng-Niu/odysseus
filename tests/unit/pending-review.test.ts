import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  enqueuePendingReview,
  listPendingReview,
  sizePendingReview,
  approvePendingReview,
  rejectPendingReview,
  shouldAutoApprove,
  autoApproveAllPendingReview,
} from '../../src/cerebellum/pending-review.js';
import {
  clearRetryCounters,
  listSkippedEnqueues,
  clearSkippedEnqueues,
  listBacklog,
} from '../../src/cerebellum/backlog.js';
import { markCompleted, clearCompletedGoals } from '../../src/cerebellum/completedGoals.js';

/**
 * pending-review.ts — dreamer/reflect/curiosity proposals wait here for
 * explicit user approval (or auto-approval when ODYSSEUS_AUTO_APPROVE is
 * truthy, the default).
 *
 * This module has 14 exports but no dedicated test file prior to
 * Iteration 22 — coverage came only via voyage-loop integration tests.
 * These unit tests lock the contract: enqueue/list/size/approve/reject,
 * auto-approve env-var gating, corrupt-file resilience, and the
 * autoApproveAllPendingReview "leave failed items in queue" guarantee.
 */
describe('pending-review — basic enqueue/list/size', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'ody-pr-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('enqueue writes item with default priority per origin', async () => {
    const dream = await enqueuePendingReview(rootDir, 'dream task', 'dream');
    const reflect = await enqueuePendingReview(rootDir, 'reflect task', 'reflect');
    const curiosity = await enqueuePendingReview(rootDir, 'curiosity task', 'curiosity');

    expect(dream.priority).toBe(100);
    expect(reflect.priority).toBe(75);
    expect(curiosity.priority).toBe(90);
  });

  test('enqueue rejects empty goal', async () => {
    await expect(enqueuePendingReview(rootDir, '', 'dream')).rejects.toThrow(/empty/);
    await expect(enqueuePendingReview(rootDir, '   ', 'dream')).rejects.toThrow(/empty/);
  });

  test('list returns items in createdAt chronological order', async () => {
    const first = await enqueuePendingReview(
      rootDir,
      'first',
      'dream',
      { createdAt: '2026-07-20T10:00:00.000Z' }
    );
    const second = await enqueuePendingReview(
      rootDir,
      'second',
      'dream',
      { createdAt: '2026-07-19T10:00:00.000Z' }
    );
    const third = await enqueuePendingReview(
      rootDir,
      'third',
      'dream',
      { createdAt: '2026-07-21T10:00:00.000Z' }
    );

    const list = await listPendingReview(rootDir);
    // sorted by createdAt ascending — second is oldest
    expect(list.map((i) => i.goal)).toEqual([second.goal, first.goal, third.goal]);
  });

  test('size counts items in the file', async () => {
    expect(await sizePendingReview(rootDir)).toBe(0);
    await enqueuePendingReview(rootDir, 'one', 'dream');
    await enqueuePendingReview(rootDir, 'two', 'dream');
    expect(await sizePendingReview(rootDir)).toBe(2);
  });

  test('id format is pr_<12 hex>', async () => {
    const item = await enqueuePendingReview(rootDir, 'check id', 'dream');
    expect(item.id).toMatch(/^pr_[0-9a-f]{12}$/);
  });

  test('explicit options override defaults (id, priority, createdAt, sourceWaypointId)', async () => {
    const item = await enqueuePendingReview(rootDir, 'pinned', 'dream', {
      id: 'pr_fixed',
      priority: 10,
      createdAt: '2026-01-01T00:00:00.000Z',
      sourceWaypointId: 'wp_abc',
    });
    expect(item.id).toBe('pr_fixed');
    expect(item.priority).toBe(10);
    expect(item.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(item.sourceWaypointId).toBe('wp_abc');
  });

  test('persists to pending-review.json with version 1', async () => {
    await enqueuePendingReview(rootDir, 'persisted', 'dream');
    const raw = await readFile(join(rootDir, 'pending-review.json'), 'utf8');
    expect(raw).toContain('"version": 1');
    expect(raw).toContain('persisted');
  });
});

describe('pending-review — corrupt file resilience', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'ody-pr-c-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('corrupt JSON is treated as empty queue', async () => {
    await writeFile(join(rootDir, 'pending-review.json'), '{not valid json', 'utf8');
    expect(await sizePendingReview(rootDir)).toBe(0);
    // Subsequent enqueue should still work (overwrites the corrupt file).
    const item = await enqueuePendingReview(rootDir, 'fresh', 'dream');
    expect(item.id).toMatch(/^pr_/);
  });

  test('wrong version is treated as empty queue', async () => {
    await writeFile(
      join(rootDir, 'pending-review.json'),
      JSON.stringify({ version: 99, items: [{ id: 'stale', goal: 'x', origin: 'dream', priority: 1, createdAt: 'x' }] }),
      'utf8'
    );
    expect(await sizePendingReview(rootDir)).toBe(0);
  });

  test('missing file is treated as empty queue (not an error)', async () => {
    expect(await sizePendingReview(rootDir)).toBe(0);
    expect(await listPendingReview(rootDir)).toEqual([]);
  });
});

describe('pending-review — approve / reject', () => {
  let rootDir: string;

  beforeEach(async () => {
    clearRetryCounters();
    rootDir = await mkdtemp(join(tmpdir(), 'ody-pr-ar-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('approve moves item to backlog and removes from pending', async () => {
    const item = await enqueuePendingReview(rootDir, 'will approve', 'dream');
    expect(await sizePendingReview(rootDir)).toBe(1);

    const result = await approvePendingReview(rootDir, item.id);
    expect(result.pending.id).toBe(item.id);
    expect(result.backlog.goal).toBe('will approve');
    expect(result.backlog.origin).toBe('dream');

    expect(await sizePendingReview(rootDir)).toBe(0);
  });

  test('approve preserves priority + sourceWaypointId on the enqueued backlog item', async () => {
    const item = await enqueuePendingReview(rootDir, 'provenance', 'curiosity', {
      priority: 42,
      sourceWaypointId: 'wp_xyz',
    });
    const result = await approvePendingReview(rootDir, item.id);
    expect(result.backlog.priority).toBe(42);
    expect(result.backlog.sourceWaypointId).toBe('wp_xyz');
  });

  test('approve throws on unknown id', async () => {
    await expect(approvePendingReview(rootDir, 'pr_doesnotexist')).rejects.toThrow(
      /not found/
    );
  });

  test('reject removes item and returns true', async () => {
    const item = await enqueuePendingReview(rootDir, 'will reject', 'dream');
    const removed = await rejectPendingReview(rootDir, item.id);
    expect(removed).toBe(true);
    expect(await sizePendingReview(rootDir)).toBe(0);
  });

  test('reject returns false for unknown id (no error)', async () => {
    const removed = await rejectPendingReview(rootDir, 'pr_doesnotexist');
    expect(removed).toBe(false);
  });
});

describe('pending-review — shouldAutoApprove (env var)', () => {
  const originalValue = process.env.ODYSSEUS_AUTO_APPROVE;

  afterEach(() => {
    // Restore — vitest's vi.resetAll() would also clear this, but explicit
    // restore is safer for parallel test workers.
    if (originalValue === undefined) {
      delete process.env.ODYSSEUS_AUTO_APPROVE;
    } else {
      process.env.ODYSSEUS_AUTO_APPROVE = originalValue;
    }
  });

  test('defaults to true when env var is absent', () => {
    delete process.env.ODYSSEUS_AUTO_APPROVE;
    expect(shouldAutoApprove()).toBe(true);
  });

  test('defaults to true when env var is empty string', () => {
    process.env.ODYSSEUS_AUTO_APPROVE = '';
    expect(shouldAutoApprove()).toBe(true);
  });

  test('returns false on explicit opt-out (0, false, no)', () => {
    for (const v of ['0', 'false', 'no']) {
      process.env.ODYSSEUS_AUTO_APPROVE = v;
      expect(shouldAutoApprove()).toBe(false);
    }
  });

  test('returns true on any other value (1, true, yes, on)', () => {
    for (const v of ['1', 'true', 'yes', 'on']) {
      process.env.ODYSSEUS_AUTO_APPROVE = v;
      expect(shouldAutoApprove()).toBe(true);
    }
  });
});

describe('pending-review — autoApproveAllPendingReview', () => {
  let rootDir: string;

  beforeEach(async () => {
    clearRetryCounters();
    clearSkippedEnqueues();
    clearCompletedGoals();
    rootDir = await mkdtemp(join(tmpdir(), 'ody-pr-auto-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('returns empty array and no-ops when queue is empty', async () => {
    const result = await autoApproveAllPendingReview(rootDir);
    expect(result).toEqual([]);
    expect(await sizePendingReview(rootDir)).toBe(0);
  });

  test('moves all valid items to backlog and clears pending', async () => {
    await enqueuePendingReview(rootDir, 'task one', 'dream');
    await enqueuePendingReview(rootDir, 'task two', 'reflect');
    await enqueuePendingReview(rootDir, 'task three', 'curiosity');

    const enqueued = await autoApproveAllPendingReview(rootDir);
    expect(enqueued).toHaveLength(3);
    expect(enqueued.map((i) => i.goal)).toEqual(
      expect.arrayContaining(['task one', 'task two', 'task three'])
    );

    // Pending queue should be empty after auto-approve.
    expect(await sizePendingReview(rootDir)).toBe(0);
  });

  test('preserves priority + origin when moving to backlog', async () => {
    await enqueuePendingReview(rootDir, 'pinned', 'reflect', {
      priority: 30,
      sourceWaypointId: 'wp_pin',
    });

    const [item] = await autoApproveAllPendingReview(rootDir);
    expect(item).toBeDefined();
    expect(item!.goal).toBe('pinned');
    expect(item!.origin).toBe('reflect');
    expect(item!.priority).toBe(30);
    expect(item!.sourceWaypointId).toBe('wp_pin');
  });

  test('leaves failed items in pending queue (does not silently drop)', async () => {
    // This is the critical guarantee: if enqueueBacklog throws for any item,
    // that item stays in pending-review.json so the operator can inspect it.
    // We simulate failure by writing a pending-review.json where one item has
    // an empty goal (which would pass file validation but fail enqueueBacklog).
    //
    // However: enqueuePendingReview itself rejects empty goals. So we craft
    // the failing item by writing the JSON directly with a whitespace-only
    // goal that trim() returns zero-length for.
    await writeFile(
      join(rootDir, 'pending-review.json'),
      JSON.stringify({
        version: 1,
        items: [
          { id: 'pr_good', goal: 'good goal', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
          { id: 'pr_bad', goal: '   ', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:01.000Z' },
        ],
      }),
      'utf8'
    );

    const enqueued = await autoApproveAllPendingReview(rootDir);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.goal).toBe('good goal');

    // The bad item stays in pending for inspection.
    const remaining = await listPendingReview(rootDir);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe('pr_bad');
  });

  test('leaves dedup-filtered items in pending queue (does not silently drop)', async () => {
    // Iteration 22 — the throwing-item test above only catches the try/catch
    // branch. There's a second silent-loss path: enqueueBacklog returns a
    // *phantom* BacklogItem when one of its three dedup checks fires (already-
    // completed, retry-exhausted, seed-exhausted). The phantom has the right
    // shape so autoApproveAllPendingReview pushes it to `enqueued` and removes
    // the pending item — but backlog.json never gets written. The item is
    // lost in transit.
    //
    // Fix shape: detect the phantom by observing listSkippedEnqueues()
    // growing across the enqueueBacklog call. If it grew, the enqueue was
    // filtered — leave the item in pending so the operator can see it.
    //
    // Reproduce via the already-completed check: mark a goal complete, then
    // try to auto-approve a pending proposal for the same goal.
    markCompleted('done goal', 'prior voyage waypoint');

    await writeFile(
      join(rootDir, 'pending-review.json'),
      JSON.stringify({
        version: 1,
        items: [
          { id: 'pr_fresh', goal: 'fresh goal', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
          { id: 'pr_done', goal: 'done goal', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:01.000Z' },
        ],
      }),
      'utf8'
    );

    const enqueued = await autoApproveAllPendingReview(rootDir);

    // Fresh item should pass through normally.
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.goal).toBe('fresh goal');

    // The dedup-filtered item must NOT appear in backlog.
    const backlogItems = await listBacklog(rootDir);
    expect(backlogItems.find((i) => i.goal === 'done goal')).toBeUndefined();

    // And it MUST remain visible in pending-review.json — the operator needs
    // to see what the dreamer proposed and why it wasn't actioned. Silently
    // dropping it would make dreamer output unattributable.
    const remaining = await listPendingReview(rootDir);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe('pr_done');

    // The skipped-enqueue registry should have recorded the reason.
    const skips = listSkippedEnqueues();
    expect(skips.some((s) => s.goal === 'done goal' && s.reason === 'already-completed')).toBe(true);
  });
});
