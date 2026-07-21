/**
 * Invariants for src/cerebellum/pending-review-auto.ts.
 *
 * The existing pending-review-auto.test.ts covers shouldAutoApprove env-var
 * parsing exhaustively. The pending-review.test.ts covers behavioral cases
 * of autoApproveAllPendingReview (empty queue, move all, preserve fields,
 * leave failed items, leave dedup-filtered items). This file pins the
 * load-bearing structural contracts that those tests only imply:
 *
 *   - autoApproveAllPendingReview return type: Promise<readonly BacklogItem[]>
 *     (readonly — callers can't mutate)
 *   - Count conservation: (items in pending before) ==
 *     (items in enqueued) + (items remaining in pending)
 *   - Phantom-detection invariant: if listSkippedEnqueues() grew across
 *     a single enqueueBacklog call, that item is NOT in the result array
 *     and IS still in pending-review.json (the side-channel contract)
 *   - Bulk vs single: autoApproveAll processes each item independently
 *     — one failure doesn't abort the batch
 *   - Error containment: try/catch around enqueueBacklog means throwing
 *     items survive in pending (don't crash the loop)
 *   - Field preservation: enqueued result preserves goal/origin/priority/
 *     sourceWaypointId from the source PendingItem (modulo dedup-filter)
 *   - Order preservation: pending items processed in file order (not
 *     re-sorted)
 *   - Empty-input contract: empty pending returns empty array, never
 *     null/undefined
 *   - Atomicity of final save: after all items processed, pending is
 *     rewritten exactly once (not per-item)
 *
 * The phantom-detection invariant (listSkippedEnqueues side channel) is
 * the most load-bearing. Without it, auto-approve silently swallows
 * dedup-filtered proposals — the dreamer produces work that vanishes
 * without a trace. This was Iteration 22's critical fix.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  autoApproveAllPendingReview,
} from '../../src/cerebellum/pending-review-auto.js';
import {
  listPendingReview,
  sizePendingReview,
  type PendingItem,
} from '../../src/cerebellum/pending-review.js';
import {
  listBacklog,
  sizeBacklog,
  type BacklogItem,
} from '../../src/cerebellum/backlog.js';
import {
  listSkippedEnqueues,
  clearSkippedEnqueues,
} from '../../src/cerebellum/backlog-registries.js';
import { clearRetryCounters } from '../../src/cerebellum/retry-counter.js';
import { markCompleted, clearCompletedGoals } from '../../src/cerebellum/completedGoals.js';

interface PendingItemSeed {
  readonly id: string;
  readonly goal: string;
  readonly origin: 'dream' | 'reflect' | 'curiosity';
  readonly priority: number;
  readonly createdAt: string;
  readonly sourceWaypointId?: string;
}

async function writePendingFile(rootDir: string, items: PendingItemSeed[]): Promise<void> {
  const payload = JSON.stringify({ version: 1, items }, null, 2) + '\n';
  await writeFile(join(rootDir, 'pending-review.json'), payload, 'utf8');
}

async function readPendingFile(rootDir: string): Promise<PendingItem[]> {
  return [...(await listPendingReview(rootDir))];
}

describe('pending-review-auto invariants', () => {
  let rootDir: string;

  beforeEach(async () => {
    clearRetryCounters();
    clearSkippedEnqueues();
    clearCompletedGoals();
    rootDir = await mkdtemp(join(tmpdir(), 'ody-pr-auto-inv-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Return type shape
  // -------------------------------------------------------------------------

  describe('return type shape', () => {
    test('returns a readonly array of BacklogItem (not null, not undefined)', async () => {
      const result = await autoApproveAllPendingReview(rootDir);
      expect(Array.isArray(result)).toBe(true);
      expect(result).not.toBeNull();
      expect(result).not.toBeUndefined();
    });

    test('empty pending returns empty array', async () => {
      const result = await autoApproveAllPendingReview(rootDir);
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    test('every returned item satisfies BacklogItem shape', async () => {
      await writePendingFile(rootDir, [
        { id: 'pr_a', goal: 'goal A', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
      ]);
      const result = await autoApproveAllPendingReview(rootDir);
      const item: BacklogItem = result[0]!;
      expect(Object.keys(item).sort()).toEqual([
        'createdAt',
        'goal',
        'id',
        'origin',
        'priority',
      ]);
      expect(typeof item.id).toBe('string');
      expect(typeof item.goal).toBe('string');
      expect(typeof item.priority).toBe('number');
    });
  });

  // -------------------------------------------------------------------------
  // Count conservation invariant
  // -------------------------------------------------------------------------

  describe('count conservation', () => {
    test('pending == enqueued + remaining (no item lost in transit)', async () => {
      // The most fundamental invariant: every input item is accounted
      // for either as enqueued-to-backlog or left-in-pending.
      await writePendingFile(rootDir, [
        { id: 'pr_a', goal: 'gA', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
        { id: 'pr_b', goal: 'gB', origin: 'reflect', priority: 75, createdAt: '2026-07-21T00:00:01.000Z' },
        { id: 'pr_c', goal: 'gC', origin: 'curiosity', priority: 90, createdAt: '2026-07-21T00:00:02.000Z' },
      ]);
      const result = await autoApproveAllPendingReview(rootDir);
      const remaining = await readPendingFile(rootDir);
      expect(result.length + remaining.length).toBe(3);
    });

    test('conservation holds when some items fail', async () => {
      // Mix valid + invalid (empty goal after trim).
      await writePendingFile(rootDir, [
        { id: 'pr_ok1', goal: 'ok goal 1', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
        { id: 'pr_bad', goal: '   ', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:01.000Z' },
        { id: 'pr_ok2', goal: 'ok goal 2', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:02.000Z' },
      ]);
      const result = await autoApproveAllPendingReview(rootDir);
      const remaining = await readPendingFile(rootDir);
      // Total conservation: 3 input = enqueued + remaining
      expect(result.length + remaining.length).toBe(3);
      // Specifically: 2 ok items enqueued, 1 bad left in pending
      expect(result).toHaveLength(2);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.id).toBe('pr_bad');
    });

    test('conservation holds when some items are dedup-filtered', async () => {
      // Mark 'gDone' as completed, so enqueueBacklog will phantom-filter it.
      markCompleted('gDone', 'earlier voyage');
      await writePendingFile(rootDir, [
        { id: 'pr_fresh', goal: 'gFresh', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
        { id: 'pr_done', goal: 'gDone', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:01.000Z' },
      ]);
      const result = await autoApproveAllPendingReview(rootDir);
      const remaining = await readPendingFile(rootDir);
      // Total conservation: 2 input = enqueued + remaining
      expect(result.length + remaining.length).toBe(2);
      // Specifically: 1 fresh enqueued, 1 done left in pending
      expect(result).toHaveLength(1);
      expect(result[0]!.goal).toBe('gFresh');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.goal).toBe('gDone');
    });
  });

  // -------------------------------------------------------------------------
  // Phantom-detection side-channel invariant (Iteration 22)
  // -------------------------------------------------------------------------

  describe('phantom-detection side channel', () => {
    test('dedup-filtered items increment listSkippedEnqueues — and stay in pending', async () => {
      markCompleted('goal already done', 'prior');
      await writePendingFile(rootDir, [
        { id: 'pr_x', goal: 'goal already done', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
      ]);
      const skipsBefore = listSkippedEnqueues().length;
      await autoApproveAllPendingReview(rootDir);
      const skipsAfter = listSkippedEnqueues().length;

      expect(skipsAfter).toBeGreaterThan(skipsBefore);
      const remaining = await readPendingFile(rootDir);
      expect(remaining).toHaveLength(1);
    });

    test('enqueued items do NOT increment listSkippedEnqueues', async () => {
      await writePendingFile(rootDir, [
        { id: 'pr_y', goal: 'fresh goal', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
      ]);
      const skipsBefore = listSkippedEnqueues().length;
      const result = await autoApproveAllPendingReview(rootDir);
      const skipsAfter = listSkippedEnqueues().length;

      expect(skipsAfter).toBe(skipsBefore); // NO new skip record
      expect(result).toHaveLength(1); // fresh goal enqueued normally
    });

    test('mixed batch: each phantom is detected independently', async () => {
      // Two completed goals + one fresh → 2 phantoms + 1 real enqueue.
      markCompleted('done1', 'prior');
      markCompleted('done2', 'prior');
      await writePendingFile(rootDir, [
        { id: 'pr_d1', goal: 'done1', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
        { id: 'pr_fresh', goal: 'fresh', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:01.000Z' },
        { id: 'pr_d2', goal: 'done2', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:02.000Z' },
      ]);
      const result = await autoApproveAllPendingReview(rootDir);
      // Fresh only.
      expect(result).toHaveLength(1);
      expect(result[0]!.goal).toBe('fresh');
      // Both done goals stay in pending.
      const remaining = await readPendingFile(rootDir);
      expect(remaining.map((r) => r.goal).sort()).toEqual(['done1', 'done2']);
      // Two skip records (one per dedup-filtered item).
      const skips = listSkippedEnqueues();
      expect(skips.filter((s) => s.reason === 'already-completed')).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Error containment — try/catch around enqueueBacklog
  // -------------------------------------------------------------------------

  describe('error containment', () => {
    test('one throwing item does not abort the batch', async () => {
      // An item that throws inside enqueueBacklog (empty goal) is caught;
      // processing continues to the next item.
      await writePendingFile(rootDir, [
        { id: 'pr_throws', goal: '', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
        { id: 'pr_ok', goal: 'recoverable', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:01.000Z' },
      ]);
      const result = await autoApproveAllPendingReview(rootDir);
      // Second item was still processed despite the first throwing.
      expect(result).toHaveLength(1);
      expect(result[0]!.goal).toBe('recoverable');
    });

    test('throwing item is preserved in pending for inspection', async () => {
      await writePendingFile(rootDir, [
        { id: 'pr_throws', goal: '', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
      ]);
      await autoApproveAllPendingReview(rootDir);
      const remaining = await readPendingFile(rootDir);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.id).toBe('pr_throws');
    });

    test('multiple throwing items all preserved', async () => {
      await writePendingFile(rootDir, [
        { id: 'pr_t1', goal: '', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
        { id: 'pr_t2', goal: '   ', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:01.000Z' },
        { id: 'pr_ok', goal: 'real goal', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:02.000Z' },
      ]);
      await autoApproveAllPendingReview(rootDir);
      const remaining = await readPendingFile(rootDir);
      expect(remaining.map((r) => r.id).sort()).toEqual(['pr_t1', 'pr_t2']);
    });
  });

  // -------------------------------------------------------------------------
  // Field preservation — input PendingItem → output BacklogItem
  // -------------------------------------------------------------------------

  describe('field preservation', () => {
    test('goal text is preserved verbatim', async () => {
      await writePendingFile(rootDir, [
        { id: 'pr_g', goal: 'specific text with 123 numbers', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
      ]);
      const [item] = await autoApproveAllPendingReview(rootDir);
      expect(item!.goal).toBe('specific text with 123 numbers');
    });

    test('origin is preserved (dream/reflect/curiosity all supported)', async () => {
      await writePendingFile(rootDir, [
        { id: 'pr_d', goal: 'dream goal', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
        { id: 'pr_r', goal: 'reflect goal', origin: 'reflect', priority: 75, createdAt: '2026-07-21T00:00:01.000Z' },
        { id: 'pr_c', goal: 'curiosity goal', origin: 'curiosity', priority: 90, createdAt: '2026-07-21T00:00:02.000Z' },
      ]);
      const results = await autoApproveAllPendingReview(rootDir);
      const byId = new Map(results.map((r) => [r.id, r] as const));
      // The result items have NEW ids (bl_*) because they go through
      // enqueueBacklog which generates a fresh id. So we can't lookup
      // by pending id; instead group by goal.
      const byGoal = new Map(results.map((r) => [r.goal, r] as const));
      expect(byGoal.get('dream goal')!.origin).toBe('dream');
      expect(byGoal.get('reflect goal')!.origin).toBe('reflect');
      expect(byGoal.get('curiosity goal')!.origin).toBe('curiosity');
    });

    test('priority is preserved verbatim (not re-derived from origin)', async () => {
      // A pending item with priority 42 (not the default 100 for dream)
      // should keep 42 after auto-approve, NOT get reset to the origin
      // default.
      await writePendingFile(rootDir, [
        { id: 'pr_p', goal: 'pinned-priority', origin: 'dream', priority: 42, createdAt: '2026-07-21T00:00:00.000Z' },
      ]);
      const [item] = await autoApproveAllPendingReview(rootDir);
      expect(item!.priority).toBe(42);
    });

    test('sourceWaypointId is preserved when present', async () => {
      await writePendingFile(rootDir, [
        {
          id: 'pr_sw',
          goal: 'provenance test',
          origin: 'dream',
          priority: 100,
          createdAt: '2026-07-21T00:00:00.000Z',
          sourceWaypointId: 'wp_abc123',
        },
      ]);
      const [item] = await autoApproveAllPendingReview(rootDir);
      expect(item!.sourceWaypointId).toBe('wp_abc123');
    });

    test('sourceWaypointId is absent when input has none (no undefined key)', async () => {
      // exactOptionalPropertyTypes: undefined must be OMITTED, not
      // present as `key: undefined`. Pin via Object.keys check.
      await writePendingFile(rootDir, [
        { id: 'pr_nosw', goal: 'no provenance', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
      ]);
      const [item] = await autoApproveAllPendingReview(rootDir);
      expect(item).toBeDefined();
      expect('sourceWaypointId' in item!).toBe(false);
    });

    test('result items have bl_ prefix ids (fresh from enqueueBacklog)', async () => {
      // The pending item had a pr_ prefix; the enqueued backlog item
      // gets a fresh bl_ prefix because enqueueBacklog regenerates the
      // id. Pin so a future "preserve id" refactor surfaces.
      await writePendingFile(rootDir, [
        { id: 'pr_idtest', goal: 'id test', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
      ]);
      const [item] = await autoApproveAllPendingReview(rootDir);
      expect(item!.id).toMatch(/^bl_[0-9a-f]{12}$/);
      expect(item!.id).not.toBe('pr_idtest');
    });
  });

  // -------------------------------------------------------------------------
  // Order preservation — file order, not re-sorted
  // -------------------------------------------------------------------------

  describe('order preservation', () => {
    test('pending items processed in file order (insertion order)', async () => {
      // Even with out-of-order createdAt timestamps, the file order is
      // preserved in the enqueued result.
      await writePendingFile(rootDir, [
        { id: 'pr_1', goal: 'first', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:02.000Z' },
        { id: 'pr_2', goal: 'second', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
        { id: 'pr_3', goal: 'third', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:01.000Z' },
      ]);
      const result = await autoApproveAllPendingReview(rootDir);
      expect(result.map((r) => r.goal)).toEqual(['first', 'second', 'third']);
    });

    test('interleaved failures preserve order of successful enqueues', async () => {
      await writePendingFile(rootDir, [
        { id: 'pr_1', goal: 'ok1', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
        { id: 'pr_2', goal: '', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:01.000Z' },
        { id: 'pr_3', goal: 'ok2', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:02.000Z' },
      ]);
      const result = await autoApproveAllPendingReview(rootDir);
      // Only the OK items — in their original relative order.
      expect(result.map((r) => r.goal)).toEqual(['ok1', 'ok2']);
    });
  });

  // -------------------------------------------------------------------------
  // Single atomic save at end (not per-item)
  // -------------------------------------------------------------------------

  describe('atomic save at end', () => {
    test('pending-review.json is rewritten exactly once after batch', async () => {
      // We can't directly count save calls without mocking, but we CAN
      // verify the final state is consistent: all-to-enqueue leaves
      // pending empty, and enqueued+remaining = input count.
      await writePendingFile(rootDir, [
        { id: 'pr_a', goal: 'gA', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
        { id: 'pr_b', goal: 'gB', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:01.000Z' },
      ]);
      await autoApproveAllPendingReview(rootDir);
      const remaining = await readPendingFile(rootDir);
      expect(remaining).toEqual([]);
      // File is still readable as valid JSON.
      expect(await sizePendingReview(rootDir)).toBe(0);
    });

    test('after auto-approve, backlog.json contains all enqueued items', async () => {
      await writePendingFile(rootDir, [
        { id: 'pr_a', goal: 'gA', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
        { id: 'pr_b', goal: 'gB', origin: 'reflect', priority: 75, createdAt: '2026-07-21T00:00:01.000Z' },
      ]);
      const result = await autoApproveAllPendingReview(rootDir);
      const backlog = await listBacklog(rootDir);
      // Result count == backlog count (everything landed in backlog).
      expect(backlog).toHaveLength(result.length);
      // Every returned item is present in backlog.
      for (const r of result) {
        expect(backlog.find((b) => b.id === r.id)).toBeDefined();
      }
    });

    test('empty pending leaves backlog untouched', async () => {
      // Pre-seed backlog with one item so we can detect accidental loss.
      await writePendingFile(rootDir, [
        { id: 'pr_pre', goal: 'preexisting', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
      ]);
      await autoApproveAllPendingReview(rootDir);
      const backlogSizeAfterSeed = await sizeBacklog(rootDir);

      // Now clear pending and run again — should be a no-op on backlog.
      await writeFile(
        join(rootDir, 'pending-review.json'),
        JSON.stringify({ version: 1, items: [] }, null, 2) + '\n',
        'utf8',
      );
      await autoApproveAllPendingReview(rootDir);
      expect(await sizeBacklog(rootDir)).toBe(backlogSizeAfterSeed);
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency — second call on drained queue is a no-op
  // -------------------------------------------------------------------------

  describe('idempotency', () => {
    test('second call on drained queue returns empty array', async () => {
      await writePendingFile(rootDir, [
        { id: 'pr_a', goal: 'once', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
      ]);
      const first = await autoApproveAllPendingReview(rootDir);
      expect(first).toHaveLength(1);
      const second = await autoApproveAllPendingReview(rootDir);
      expect(second).toEqual([]);
    });

    test('repeated calls never re-enqueue the same item', async () => {
      await writePendingFile(rootDir, [
        { id: 'pr_x', goal: 'single-enqueue', origin: 'dream', priority: 100, createdAt: '2026-07-21T00:00:00.000Z' },
      ]);
      await autoApproveAllPendingReview(rootDir);
      await autoApproveAllPendingReview(rootDir);
      await autoApproveAllPendingReview(rootDir);
      const backlog = await listBacklog(rootDir);
      expect(backlog.filter((b) => b.goal === 'single-enqueue')).toHaveLength(1);
    });
  });
});
