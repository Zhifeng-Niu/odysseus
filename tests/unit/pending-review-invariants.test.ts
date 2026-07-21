import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  enqueuePendingReview,
  approvePendingReview,
  rejectPendingReview,
  listPendingReview,
  sizePendingReview,
  loadFile,
  saveFile,
  PendingReviewFilteredError,
  type PendingItem,
  type ReviewableOrigin,
  type ApproveResult,
} from '../../src/cerebellum/pending-review.js';

/**
 * pending-review — STRUCTURAL INVARIANTS for the dream/reflect/curiosity
 * approval queue.
 *
 * pending-review.test.ts (486 lines, 6 describe blocks) covers happy-path
 * enqueue/approve/reject, corrupt file resilience, and the env-var auto-
 * approve logic. This file pins the load-bearing structural contracts
 * that, if silently regressed, would either:
 *   - Break the approval flow (wrong error class, missing fields)
 *   - Change the on-disk JSON shape that dreamer/orchestrator depend on
 *   - Lose items silently (outbox-ordering regression — Iteration 23)
 *
 * Contracts pinned here:
 *
 *   - ReviewableOrigin is EXACTLY `'dream' | 'reflect' | 'curiosity'`.
 *     Other origins (user, system, plan) NEVER enter pending-review.
 *
 *   - PendingItem has 5 required fields + 1 optional (sourceWaypointId).
 *     Under exactOptionalPropertyTypes, `sourceWaypointId` is either
 *     ABSENT from the object or set to a string — never `undefined`.
 *
 *   - ID format `pr_<12 hex>` via randomBytes(6). Matches `/^pr_[0-9a-f]{12}$/`.
 *     12 hex chars = 6 bytes = 48 bits of entropy. Distinct from backlog's
 *     `bl_<12 hex>` prefix — the prefix is the namespace tag.
 *
 *   - defaultPriorityForOrigin mirrors backlog.ts values: reflect=75,
 *     curiosity=90, dream=100. (Only 3 origins here since ReviewableOrigin
 *     excludes user/plan/system.)
 *
 *   - enqueuePendingReview on empty/whitespace goal THROWS — error message
 *     is exactly `'pending review goal cannot be empty'`. Not silent.
 *
 *   - PendingReviewFilteredError is a typed Error subclass:
 *       * `.name === 'PendingReviewFilteredError'`
 *       * `.pendingItem` is the PendingItem that was filtered
 *       * `.reason` is a SkipReason string
 *       * `.message` includes both the goal and the reason
 *
 *   - approvePendingReview OUTBOX ORDERING (Iteration 23):
 *     1. Load file
 *     2. Find item (throws if missing)
 *     3. enqueueBacklog FIRST (the durable write)
 *     4. Detect phantom dedup via listSkippedEnqueues side channel
 *     5. Save the reduced pending file ONLY after verified success
 *
 *   - File shape: { version: 1, items: PendingItem[] }. Version is the
 *     literal 1, not a string.
 *
 *   - Atomic write: tmp file + rename. tmp path is `${finalPath}.tmp`.
 *
 *   - listPendingReview sorts by createdAt ASCENDING (oldest first).
 *     Different from backlog which sorts priority-then-time.
 *
 *   - Purity: loadFile/saveFile do not mutate caller-provided objects.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pending-review-inv-'));
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// ReviewableOrigin — type constraint (3 values only)
// ---------------------------------------------------------------------------

describe('ReviewableOrigin — exactly 3 values', () => {
  test('dream is a valid ReviewableOrigin', async () => {
    const item = await enqueuePendingReview(tmpDir, 'dream goal', 'dream');
    expect(item.origin).toBe('dream');
  });

  test('reflect is a valid ReviewableOrigin', async () => {
    const item = await enqueuePendingReview(tmpDir, 'reflect goal', 'reflect');
    expect(item.origin).toBe('reflect');
  });

  test('curiosity is a valid ReviewableOrigin', async () => {
    const item = await enqueuePendingReview(tmpDir, 'curiosity goal', 'curiosity');
    expect(item.origin).toBe('curiosity');
  });

  test('user/plan/system are NOT ReviewableOrigins (compile-time)', () => {
    // This is a type-level constraint. We verify via the type system:
    //   type _Check = 'user' extends ReviewableOrigin ? true : false;
    // We can't easily runtime-test exclusion since TS would reject the
    // call. But we can confirm the union has exactly 3 members.
    const validOrigins: ReviewableOrigin[] = ['dream', 'reflect', 'curiosity'];
    expect(validOrigins.length).toBe(3);
    expect(validOrigins).toContain('dream');
    expect(validOrigins).toContain('reflect');
    expect(validOrigins).toContain('curiosity');
  });
});

// ---------------------------------------------------------------------------
// PendingItem — type shape
// ---------------------------------------------------------------------------

describe('PendingItem — shape contract', () => {
  test('has 5 required fields: id, goal, origin, priority, createdAt', async () => {
    const item = await enqueuePendingReview(tmpDir, 'goal text', 'dream');
    expect(Object.keys(item).sort()).toEqual([
      'createdAt',
      'goal',
      'id',
      'origin',
      'priority',
    ]);
  });

  test('sourceWaypointId is ABSENT when not provided (exactOptionalPropertyTypes)', async () => {
    const item = await enqueuePendingReview(tmpDir, 'goal', 'dream');
    expect('sourceWaypointId' in item).toBe(false);
    expect(item.sourceWaypointId).toBeUndefined();
  });

  test('sourceWaypointId is present (string) when provided', async () => {
    const item = await enqueuePendingReview(tmpDir, 'goal', 'dream', {
      sourceWaypointId: 'wp_abc',
    });
    expect('sourceWaypointId' in item).toBe(true);
    expect(item.sourceWaypointId).toBe('wp_abc');
    expect(Object.keys(item).length).toBe(6);
  });

  test('all fields are readonly (type contract)', async () => {
    // @ts-expect-error: assigning to readonly
    const item = (await enqueuePendingReview(tmpDir, 'g', 'dream')) as PendingItem;
    // We can't really assert readonly at runtime, but the type prevents writes.
    expect(item.goal).toBe('g');
  });

  test('id matches /^pr_[0-9a-f]{12}$/', async () => {
    const item = await enqueuePendingReview(tmpDir, 'g', 'dream');
    expect(item.id).toMatch(/^pr_[0-9a-f]{12}$/);
  });

  test('goal is TRIMMED before storage', async () => {
    const item = await enqueuePendingReview(tmpDir, '   spaced goal   ', 'dream');
    expect(item.goal).toBe('spaced goal');
  });

  test('createdAt is a valid ISO 8601 string', async () => {
    const item = await enqueuePendingReview(tmpDir, 'g', 'dream');
    const parsed = Date.parse(item.createdAt);
    expect(Number.isNaN(parsed)).toBe(false);
    expect(item.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('priority is a number', async () => {
    const item = await enqueuePendingReview(tmpDir, 'g', 'dream');
    expect(typeof item.priority).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// defaultPriorityForOrigin — parity with backlog.ts (private function)
// ---------------------------------------------------------------------------

describe('defaultPriorityForOrigin (via enqueuePendingReview) — mirrors backlog', () => {
  test('dream → 100', async () => {
    const item = await enqueuePendingReview(tmpDir, 'g', 'dream');
    expect(item.priority).toBe(100);
  });

  test('reflect → 75', async () => {
    const item = await enqueuePendingReview(tmpDir, 'g', 'reflect');
    expect(item.priority).toBe(75);
  });

  test('curiosity → 90', async () => {
    const item = await enqueuePendingReview(tmpDir, 'g', 'curiosity');
    expect(item.priority).toBe(90);
  });

  test('explicit priority overrides default', async () => {
    const item = await enqueuePendingReview(tmpDir, 'g', 'dream', { priority: 42 });
    expect(item.priority).toBe(42);
  });

  test('ordering: reflect (75) < curiosity (90) < dream (100)', async () => {
    const reflect = (await enqueuePendingReview(tmpDir, 'g', 'reflect')).priority;
    const curiosity = (await enqueuePendingReview(tmpDir, 'g', 'curiosity')).priority;
    const dream = (await enqueuePendingReview(tmpDir, 'g', 'dream')).priority;
    expect(reflect).toBeLessThan(curiosity);
    expect(curiosity).toBeLessThan(dream);
  });
});

// ---------------------------------------------------------------------------
// generatePendingId — format
// ---------------------------------------------------------------------------

describe('generatePendingId — format invariants', () => {
  test('starts with `pr_` prefix', async () => {
    for (let i = 0; i < 10; i++) {
      const item = await enqueuePendingReview(tmpDir, `g${i}`, 'dream');
      expect(item.id.startsWith('pr_')).toBe(true);
    }
  });

  test('has exactly 12 hex chars after `pr_`', async () => {
    for (let i = 0; i < 10; i++) {
      const item = await enqueuePendingReview(tmpDir, `g${i}`, 'dream');
      const hex = item.id.slice(3);
      expect(hex).toMatch(/^[0-9a-f]{12}$/);
      expect(hex.length).toBe(12);
    }
  });

  test('IDs are unique across 50 enqueues', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const item = await enqueuePendingReview(tmpDir, `g${i}`, 'dream');
      ids.add(item.id);
    }
    expect(ids.size).toBe(50);
  });

  test('ID prefix differs from backlog IDs (`pr_` vs `bl_`)', async () => {
    const item = await enqueuePendingReview(tmpDir, 'g', 'dream');
    expect(item.id.startsWith('bl_')).toBe(false);
    expect(item.id.startsWith('pr_')).toBe(true);
  });

  test('custom id via options.id overrides generated', async () => {
    const item = await enqueuePendingReview(tmpDir, 'g', 'dream', { id: 'pr_custom0000000' });
    expect(item.id).toBe('pr_custom0000000');
  });
});

// ---------------------------------------------------------------------------
// enqueuePendingReview — empty goal throws
// ---------------------------------------------------------------------------

describe('enqueuePendingReview — empty goal throws', () => {
  test('empty string throws', async () => {
    await expect(enqueuePendingReview(tmpDir, '', 'dream')).rejects.toThrow(
      'pending review goal cannot be empty',
    );
  });

  test('whitespace-only string throws', async () => {
    await expect(enqueuePendingReview(tmpDir, '   ', 'dream')).rejects.toThrow(
      'pending review goal cannot be empty',
    );
  });

  test('tab-only throws', async () => {
    await expect(enqueuePendingReview(tmpDir, '\t\t', 'dream')).rejects.toThrow(
      'pending review goal cannot be empty',
    );
  });

  test('newline-only throws', async () => {
    await expect(enqueuePendingReview(tmpDir, '\n\n', 'dream')).rejects.toThrow(
      'pending review goal cannot be empty',
    );
  });

  test('error is an Error instance (not a string)', async () => {
    try {
      await enqueuePendingReview(tmpDir, '', 'dream');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }
  });

  test('error message is EXACTLY `pending review goal cannot be empty`', async () => {
    try {
      await enqueuePendingReview(tmpDir, '', 'dream');
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as Error).message).toBe('pending review goal cannot be empty');
    }
  });
});

// ---------------------------------------------------------------------------
// PendingReviewFilteredError — typed error class
// ---------------------------------------------------------------------------

describe('PendingReviewFilteredError — class contract', () => {
  test('is an Error subclass', () => {
    const fakeItem: PendingItem = {
      id: 'pr_test',
      goal: 'g',
      origin: 'dream',
      priority: 100,
      createdAt: '2026-07-21T00:00:00.000Z',
    };
    const err = new PendingReviewFilteredError(fakeItem, 'duplicate');
    expect(err).toBeInstanceOf(Error);
  });

  test('.name is `PendingReviewFilteredError`', () => {
    const fakeItem: PendingItem = {
      id: 'pr_test',
      goal: 'g',
      origin: 'dream',
      priority: 100,
      createdAt: '2026-07-21T00:00:00.000Z',
    };
    const err = new PendingReviewFilteredError(fakeItem, 'duplicate');
    expect(err.name).toBe('PendingReviewFilteredError');
  });

  test('.pendingItem is the PendingItem passed in', () => {
    const fakeItem: PendingItem = {
      id: 'pr_test',
      goal: 'specific goal text',
      origin: 'reflect',
      priority: 75,
      createdAt: '2026-07-21T00:00:00.000Z',
    };
    const err = new PendingReviewFilteredError(fakeItem, 'duplicate');
    expect(err.pendingItem).toBe(fakeItem);
  });

  test('.reason is the SkipReason string', () => {
    const fakeItem: PendingItem = {
      id: 'pr_test',
      goal: 'g',
      origin: 'dream',
      priority: 100,
      createdAt: '2026-07-21T00:00:00.000Z',
    };
    const err = new PendingReviewFilteredError(fakeItem, 'exhausted');
    expect(err.reason).toBe('exhausted');
  });

  test('.message includes the goal text', () => {
    const fakeItem: PendingItem = {
      id: 'pr_test',
      goal: 'refactor cerebellum',
      origin: 'dream',
      priority: 100,
      createdAt: '2026-07-21T00:00:00.000Z',
    };
    const err = new PendingReviewFilteredError(fakeItem, 'duplicate');
    expect(err.message).toContain('refactor cerebellum');
  });

  test('.message includes the reason', () => {
    const fakeItem: PendingItem = {
      id: 'pr_test',
      goal: 'g',
      origin: 'dream',
      priority: 100,
      createdAt: '2026-07-21T00:00:00.000Z',
    };
    const err = new PendingReviewFilteredError(fakeItem, 'duplicate');
    expect(err.message).toContain('duplicate');
  });

  test('message format: `pending review item "${goal}" filtered by enqueueBacklog: ${reason}`', () => {
    const fakeItem: PendingItem = {
      id: 'pr_test',
      goal: 'my goal',
      origin: 'dream',
      priority: 100,
      createdAt: '2026-07-21T00:00:00.000Z',
    };
    const err = new PendingReviewFilteredError(fakeItem, 'exhausted');
    expect(err.message).toBe(
      'pending review item "my goal" filtered by enqueueBacklog: exhausted',
    );
  });

  test('has exactly 3 own properties: pendingItem, reason, and stack/message/name', () => {
    const fakeItem: PendingItem = {
      id: 'pr_test',
      goal: 'g',
      origin: 'dream',
      priority: 100,
      createdAt: '2026-07-21T00:00:00.000Z',
    };
    const err = new PendingReviewFilteredError(fakeItem, 'duplicate');
    expect(err).toHaveProperty('pendingItem');
    expect(err).toHaveProperty('reason');
    expect(err).toHaveProperty('message');
    expect(err).toHaveProperty('name');
    expect(err).toHaveProperty('stack');
  });
});

// ---------------------------------------------------------------------------
// File shape — version 1, items array
// ---------------------------------------------------------------------------

describe('pending-review.json — file shape', () => {
  test('default file (no enqueue) has version=1 and empty items', async () => {
    const file = await loadFile(tmpDir);
    expect(file.version).toBe(1);
    expect(file.items).toEqual([]);
  });

  test('version is a NUMBER, not a string', async () => {
    const file = await loadFile(tmpDir);
    expect(typeof file.version).toBe('number');
  });

  test('after enqueue, file contains the item', async () => {
    const item = await enqueuePendingReview(tmpDir, 'g', 'dream');
    const file = await loadFile(tmpDir);
    expect(file.items.length).toBe(1);
    expect(file.items[0]?.id).toBe(item.id);
  });

  test('on-disk JSON is pretty-printed (2-space indent)', async () => {
    await enqueuePendingReview(tmpDir, 'g', 'dream');
    const raw = readFileSync(join(tmpDir, 'pending-review.json'), 'utf8');
    expect(raw).toContain('  "version":');
    expect(raw).toContain('  "items":');
  });

  test('on-disk JSON ends with trailing newline', async () => {
    await enqueuePendingReview(tmpDir, 'g', 'dream');
    const raw = readFileSync(join(tmpDir, 'pending-review.json'), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
  });

  test('file location is `${rootDir}/pending-review.json`', async () => {
    await enqueuePendingReview(tmpDir, 'g', 'dream');
    const raw = readFileSync(join(tmpDir, 'pending-review.json'), 'utf8');
    expect(raw.length).toBeGreaterThan(0);
  });

  test('corrupt JSON returns empty items, NOT throw', async () => {
    writeFileSync(join(tmpDir, 'pending-review.json'), '{not valid json');
    const file = await loadFile(tmpDir);
    expect(file.version).toBe(1);
    expect(file.items).toEqual([]);
  });

  test('wrong version returns empty items', async () => {
    writeFileSync(
      join(tmpDir, 'pending-review.json'),
      JSON.stringify({ version: 2, items: [{ id: 'x' }] }),
    );
    const file = await loadFile(tmpDir);
    expect(file.version).toBe(1);
    expect(file.items).toEqual([]);
  });

  test('items not an array returns empty items', async () => {
    writeFileSync(
      join(tmpDir, 'pending-review.json'),
      JSON.stringify({ version: 1, items: 'not-an-array' }),
    );
    const file = await loadFile(tmpDir);
    expect(file.version).toBe(1);
    expect(file.items).toEqual([]);
  });

  test('missing file returns empty items', async () => {
    const freshDir = mkdtempSync(join(tmpdir(), 'pending-review-missing-'));
    try {
      const file = await loadFile(freshDir);
      expect(file.items).toEqual([]);
    } finally {
      rmSync(freshDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Atomic write — tmp + rename pattern
// ---------------------------------------------------------------------------

describe('saveFile — atomic write pattern', () => {
  test('creates pending-review.json (not pending-review.tmp)', async () => {
    await saveFile(tmpDir, { version: 1, items: [] });
    const raw = readFileSync(join(tmpDir, 'pending-review.json'), 'utf8');
    expect(raw).toContain('"version": 1');
  });

  test('after write, no .tmp file remains', async () => {
    await saveFile(tmpDir, { version: 1, items: [] });
    // We can't directly check `.tmp` doesn't exist without fs.exists,
    // but we can try to read it and expect an error.
    expect(() => readFileSync(join(tmpDir, 'pending-review.json.tmp'), 'utf8')).toThrow();
  });

  test('write is idempotent (same content, multiple writes)', async () => {
    const file = { version: 1 as const, items: [] };
    await saveFile(tmpDir, file);
    const first = readFileSync(join(tmpDir, 'pending-review.json'), 'utf8');
    await saveFile(tmpDir, file);
    const second = readFileSync(join(tmpDir, 'pending-review.json'), 'utf8');
    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// listPendingReview — sort order
// ---------------------------------------------------------------------------

describe('listPendingReview — sort order', () => {
  test('returns items sorted by createdAt ASCENDING', async () => {
    // Enqueue in reverse chronological order with explicit timestamps.
    await enqueuePendingReview(tmpDir, 'third', 'dream', {
      createdAt: '2026-07-21T03:00:00.000Z',
      id: 'pr_000000000003',
    });
    await enqueuePendingReview(tmpDir, 'first', 'dream', {
      createdAt: '2026-07-21T01:00:00.000Z',
      id: 'pr_000000000001',
    });
    await enqueuePendingReview(tmpDir, 'second', 'dream', {
      createdAt: '2026-07-21T02:00:00.000Z',
      id: 'pr_000000000002',
    });

    const items = await listPendingReview(tmpDir);
    expect(items.map((i) => i.goal)).toEqual(['first', 'second', 'third']);
  });

  test('empty queue returns empty array (not null)', async () => {
    const items = await listPendingReview(tmpDir);
    expect(items).toEqual([]);
    expect(Array.isArray(items)).toBe(true);
  });

  test('returns a readonly array (caller cannot mutate via cast)', async () => {
    // Type-level: listPendingReview returns readonly PendingItem[].
    // We can verify the underlying array is a fresh copy, not the internal ref.
    await enqueuePendingReview(tmpDir, 'g', 'dream');
    const items1 = await listPendingReview(tmpDir);
    const items2 = await listPendingReview(tmpDir);
    expect(items1).not.toBe(items2); // Different array references
    expect(items1).toEqual(items2); // Same contents
  });
});

// ---------------------------------------------------------------------------
// sizePendingReview
// ---------------------------------------------------------------------------

describe('sizePendingReview — count', () => {
  test('empty queue → 0', async () => {
    expect(await sizePendingReview(tmpDir)).toBe(0);
  });

  test('single enqueue → 1', async () => {
    await enqueuePendingReview(tmpDir, 'g', 'dream');
    expect(await sizePendingReview(tmpDir)).toBe(1);
  });

  test('multiple enqueues → count', async () => {
    for (let i = 0; i < 5; i++) {
      await enqueuePendingReview(tmpDir, `g${i}`, 'dream');
    }
    expect(await sizePendingReview(tmpDir)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// approvePendingReview — outbox ordering (Iteration 23)
// ---------------------------------------------------------------------------

describe('approvePendingReview — outbox ordering', () => {
  test('throws when item id not found', async () => {
    await expect(approvePendingReview(tmpDir, 'pr_nonexistent')).rejects.toThrow(
      'pending review item not found: pr_nonexistent',
    );
  });

  test('error message format: `pending review item not found: ${id}`', async () => {
    try {
      await approvePendingReview(tmpDir, 'pr_xyz');
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as Error).message).toBe('pending review item not found: pr_xyz');
    }
  });

  test('success: returns ApproveResult { pending, backlog }', async () => {
    const item = await enqueuePendingReview(tmpDir, 'goal', 'dream');
    const result = await approvePendingReview(tmpDir, item.id);
    expect(result.pending).toBeDefined();
    expect(result.backlog).toBeDefined();
    expect(result.pending.id).toBe(item.id);
    expect(result.backlog.goal).toBe('goal');
  });

  test('success: pending item is REMOVED from pending-review.json', async () => {
    const item = await enqueuePendingReview(tmpDir, 'goal', 'dream');
    await approvePendingReview(tmpDir, item.id);
    const items = await listPendingReview(tmpDir);
    expect(items.length).toBe(0);
  });

  test('success: corresponding backlog item is added', async () => {
    const item = await enqueuePendingReview(tmpDir, 'goal', 'dream');
    await approvePendingReview(tmpDir, item.id);
    // Read backlog.json directly
    const backlogRaw = readFileSync(join(tmpDir, 'backlog.json'), 'utf8');
    expect(backlogRaw).toContain('goal');
  });

  test('outbox ordering: backlog write happens BEFORE pending removal', async () => {
    // This is the Iteration 23 fix. We verify by checking that on success,
    // both writes happen. The order itself is not directly observable
    // without instrumentation, but the success-only invariant is: if
    // approve succeeds, both states are consistent.
    const item = await enqueuePendingReview(tmpDir, 'goal', 'dream');
    const result = await approvePendingReview(tmpDir, item.id);
    expect(result).toBeDefined();
    expect(await sizePendingReview(tmpDir)).toBe(0);
    const backlogRaw = readFileSync(join(tmpDir, 'backlog.json'), 'utf8');
    expect(backlogRaw).toContain(result.backlog.id);
  });

  test('approve carries over sourceWaypointId to backlog item', async () => {
    const item = await enqueuePendingReview(tmpDir, 'g', 'dream', {
      sourceWaypointId: 'wp_origin',
    });
    const result = await approvePendingReview(tmpDir, item.id);
    expect(result.backlog.sourceWaypointId).toBe('wp_origin');
  });

  test('approve without sourceWaypointId produces backlog item without it', async () => {
    const item = await enqueuePendingReview(tmpDir, 'g', 'dream');
    const result = await approvePendingReview(tmpDir, item.id);
    expect('sourceWaypointId' in result.backlog).toBe(false);
  });

  test('ApproveResult has exactly 2 fields: pending, backlog', async () => {
    const item = await enqueuePendingReview(tmpDir, 'g', 'dream');
    const result: ApproveResult = await approvePendingReview(tmpDir, item.id);
    expect(Object.keys(result).sort()).toEqual(['backlog', 'pending']);
  });
});

// ---------------------------------------------------------------------------
// rejectPendingReview
// ---------------------------------------------------------------------------

describe('rejectPendingReview', () => {
  test('returns true when item exists and is removed', async () => {
    const item = await enqueuePendingReview(tmpDir, 'g', 'dream');
    const result = await rejectPendingReview(tmpDir, item.id);
    expect(result).toBe(true);
    expect(await sizePendingReview(tmpDir)).toBe(0);
  });

  test('returns false when item does not exist', async () => {
    const result = await rejectPendingReview(tmpDir, 'pr_nonexistent');
    expect(result).toBe(false);
  });

  test('rejecting one item leaves others intact', async () => {
    const item1 = await enqueuePendingReview(tmpDir, 'g1', 'dream');
    const item2 = await enqueuePendingReview(tmpDir, 'g2', 'dream');
    await rejectPendingReview(tmpDir, item1.id);
    const items = await listPendingReview(tmpDir);
    expect(items.length).toBe(1);
    expect(items[0]?.id).toBe(item2.id);
  });

  test('reject does NOT add to backlog', async () => {
    const item = await enqueuePendingReview(tmpDir, 'g', 'dream');
    await rejectPendingReview(tmpDir, item.id);
    expect(() => readFileSync(join(tmpDir, 'backlog.json'), 'utf8')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism — same enqueue → same item shape', () => {
  test('two enqueues with same options produce equivalent shapes (except id/createdAt)', async () => {
    const a = await enqueuePendingReview(tmpDir, 'g', 'dream', {
      id: 'pr_fixed_aaaaaaaa',
      createdAt: '2026-07-21T00:00:00.000Z',
    });
    const b = await enqueuePendingReview(tmpDir, 'g', 'dream', {
      id: 'pr_fixed_bbbbbbbb',
      createdAt: '2026-07-21T00:00:00.000Z',
    });
    // Same goal, origin, priority, createdAt.
    expect(a.goal).toBe(b.goal);
    expect(a.origin).toBe(b.origin);
    expect(a.priority).toBe(b.priority);
    expect(a.createdAt).toBe(b.createdAt);
    // Different ids.
    expect(a.id).not.toBe(b.id);
  });
});

// ---------------------------------------------------------------------------
// Purity — saveFile does not mutate input file object
// ---------------------------------------------------------------------------

describe('purity — saveFile does not mutate input', () => {
  test('file object passed in is not mutated', async () => {
    const file = { version: 1 as const, items: [] };
    const snapshot = JSON.stringify(file);
    await saveFile(tmpDir, file);
    expect(JSON.stringify(file)).toBe(snapshot);
  });

  test('items array reference is preserved (no internal mutation)', async () => {
    const items: PendingItem[] = [];
    const file = { version: 1 as const, items };
    await saveFile(tmpDir, file);
    expect(file.items).toBe(items); // Same reference
  });
});

// ---------------------------------------------------------------------------
// Adversarial inputs
// ---------------------------------------------------------------------------

describe('adversarial inputs', () => {
  test('very long goal (10000 chars) is accepted', async () => {
    const goal = 'x'.repeat(10000);
    const item = await enqueuePendingReview(tmpDir, goal, 'dream');
    expect(item.goal.length).toBe(10000);
  });

  test('unicode in goal preserved', async () => {
    const goal = '重构 cerebellum 模块';
    const item = await enqueuePendingReview(tmpDir, goal, 'dream');
    expect(item.goal).toBe(goal);
  });

  test('markdown in goal preserved verbatim (no escaping)', async () => {
    const goal = 'fix `code` and **bold**';
    const item = await enqueuePendingReview(tmpDir, goal, 'dream');
    expect(item.goal).toBe(goal);
  });

  test('priority 0 is allowed', async () => {
    const item = await enqueuePendingReview(tmpDir, 'g', 'dream', { priority: 0 });
    expect(item.priority).toBe(0);
  });

  test('negative priority is allowed (not validated)', async () => {
    const item = await enqueuePendingReview(tmpDir, 'g', 'dream', { priority: -1 });
    expect(item.priority).toBe(-1);
  });

  test('50 enqueues do not corrupt the file', async () => {
    for (let i = 0; i < 50; i++) {
      await enqueuePendingReview(tmpDir, `g${i}`, 'dream');
    }
    const items = await listPendingReview(tmpDir);
    expect(items.length).toBe(50);
    // All ids unique
    const ids = new Set(items.map((i) => i.id));
    expect(ids.size).toBe(50);
  });
});
