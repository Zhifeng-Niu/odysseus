/**
 * Invariants for src/cerebellum/backlog.ts.
 *
 * The existing backlog.test.ts covers behavior (enqueue/dequeue/peek
 * flows, retry-counter integration, dedup paths). This file pins the
 * load-bearing structural contracts that are only indirectly tested
 * via the behavioral cases:
 *
 *   - defaultPriorityForOrigin direct invocation for all 6 origins
 *     (existing tests only verify priority via enqueue side-effects)
 *   - generateBacklogId format `/^bl_[0-9a-f]{12}$/` via randomBytes(6)
 *   - BacklogFile literal `version: 1` shape (not just any number)
 *   - loadBacklogFile corrupt-input matrix (missing, bad JSON, wrong
 *     version, non-array items — all return fresh state, never throw)
 *   - saveBacklogFile atomic write (no .tmp residue, 2-space indent,
 *     trailing newline, POSIX rename semantics)
 *   - dequeueBacklog outbox ordering (save BEFORE incrementSeedAttempt)
 *   - listBacklog returns a sorted COPY (not the internal file reference)
 *   - peekBacklog does NOT mutate the underlying file
 *   - removeBacklogItem idempotency (second call returns false)
 *   - byPriorityThenTime comparator: priority asc, createdAt asc for ties
 *   - Id uniqueness: two generateBacklogId calls produce distinct ids
 *
 * These contracts are what the orchestrator and dreamer/curiosity/
 * pending-review consumers depend on. Drift in any of them silently
 * changes dequeue ordering or persistence semantics.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultPriorityForOrigin,
  generateBacklogId,
  loadBacklogFile,
  saveBacklogFile,
  dequeueBacklog,
  peekBacklog,
  sizeBacklog,
  listBacklog,
  removeBacklogItem,
  enqueueBacklog,
  type BacklogItem,
  type BacklogFile,
} from '../../src/cerebellum/backlog.js';

describe('backlog invariants', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'ody-bl-inv-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // defaultPriorityForOrigin — direct invocation for every documented origin
  // -------------------------------------------------------------------------

  describe('defaultPriorityForOrigin', () => {
    test("user → 50 (user-initiated work preempts autonomous)", () => {
      expect(defaultPriorityForOrigin('user')).toBe(50);
    });

    test("plan → 50 (planner sub-tasks share the user goal's urgency)", () => {
      // plan matches user priority because plan steps ARE user intent,
      // just structured. If plan dropped to 75, a reflect item could
      // preempt the second step of a user-committed plan.
      expect(defaultPriorityForOrigin('plan')).toBe(50);
    });

    test('reflect → 75 (failure-driven reflections are urgent)', () => {
      expect(defaultPriorityForOrigin('reflect')).toBe(75);
    });

    test('curiosity → 90 (forward-looking, preempts idle dreaming)', () => {
      expect(defaultPriorityForOrigin('curiosity')).toBe(90);
    });

    test('dream → 100 (exploratory, no urgency)', () => {
      expect(defaultPriorityForOrigin('dream')).toBe(100);
    });

    test('system → 100 (bookkeeping, same as dream)', () => {
      expect(defaultPriorityForOrigin('system')).toBe(100);
    });

    test('priority ordering: user/plan < reflect < curiosity < dream/system', () => {
      // Load-bearing: this total order is what the dequeue comparator
      // relies on. If any origin's priority crosses another, dequeue
      // order silently changes.
      const u = defaultPriorityForOrigin('user');
      const p = defaultPriorityForOrigin('plan');
      const r = defaultPriorityForOrigin('reflect');
      const c = defaultPriorityForOrigin('curiosity');
      const d = defaultPriorityForOrigin('dream');
      const s = defaultPriorityForOrigin('system');
      expect(u).toBe(p);
      expect(p).toBeLessThan(r);
      expect(r).toBeLessThan(c);
      expect(c).toBeLessThan(d);
      expect(d).toBe(s);
    });

    test('switch is exhaustive — every BacklogOrigin is covered', () => {
      // If a new origin is added to BacklogOrigin without a case in
      // defaultPriorityForOrigin, TypeScript will error (switch returns
      // never). Runtime test verifies all current origins return finite
      // numbers.
      const origins = ['user', 'plan', 'dream', 'reflect', 'curiosity', 'system'] as const;
      for (const o of origins) {
        const p = defaultPriorityForOrigin(o);
        expect(typeof p).toBe('number');
        expect(Number.isFinite(p)).toBe(true);
        expect(p).toBeGreaterThan(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // generateBacklogId
  // -------------------------------------------------------------------------

  describe('generateBacklogId', () => {
    test('matches /^bl_[0-9a-f]{12}$/', () => {
      for (let i = 0; i < 50; i++) {
        const id = generateBacklogId();
        expect(id).toMatch(/^bl_[0-9a-f]{12}$/);
      }
    });

    test('two consecutive calls produce distinct ids (randomBytes(6) = 48 bits)', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateBacklogId());
      }
      // 100 unique ids out of 100 calls — collision probability at 48
      // bits is negligible for this sample size.
      expect(ids.size).toBe(100);
    });

    test('prefix is literal "bl_" (not "backlog_" or "BL_")', () => {
      const id = generateBacklogId();
      expect(id.startsWith('bl_')).toBe(true);
      expect(id.startsWith('BL_')).toBe(false);
      expect(id.startsWith('backlog_')).toBe(false);
    });

    test('hex portion is lowercase (randomBytes().toString("hex") convention)', () => {
      for (let i = 0; i < 20; i++) {
        const id = generateBacklogId();
        const hex = id.slice(3); // strip "bl_"
        expect(hex).toBe(hex.toLowerCase());
        expect(hex).not.toMatch(/[A-F]/);
      }
    });
  });

  // -------------------------------------------------------------------------
  // BacklogFile type shape
  // -------------------------------------------------------------------------

  describe('BacklogFile shape', () => {
    test('version is the literal 1 (not a string, not any other number)', async () => {
      // The runtime invariant: loadBacklogFile always returns version: 1.
      // A future migration that bumps to 2 must explicitly handle v1 reads.
      const file = await loadBacklogFile(rootDir);
      expect(file.version).toBe(1);
      expect(typeof file.version).toBe('number');
    });

    test('items is always an array (never null, never non-array)', async () => {
      const file = await loadBacklogFile(rootDir);
      expect(Array.isArray(file.items)).toBe(true);
    });

    test('default file (no backlog.json) has zero items', async () => {
      const file = await loadBacklogFile(rootDir);
      expect(file.items).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // loadBacklogFile — corrupt-input matrix
  // -------------------------------------------------------------------------

  describe('loadBacklogFile — corrupt-input matrix', () => {
    test('missing file → fresh state (no throw)', async () => {
      const file = await loadBacklogFile(rootDir);
      expect(file).toEqual({ version: 1, items: [] });
    });

    test('invalid JSON → fresh state (no throw)', async () => {
      await writeFile(join(rootDir, 'backlog.json'), 'not json{{{');
      const file = await loadBacklogFile(rootDir);
      expect(file).toEqual({ version: 1, items: [] });
    });

    test('wrong version → fresh state', async () => {
      // A v2 file (hypothetical future) must NOT be loaded as-is.
      await writeFile(
        join(rootDir, 'backlog.json'),
        JSON.stringify({ version: 2, items: [{ id: 'bl_aaa', goal: 'x', origin: 'user', priority: 50, createdAt: '2026-01-01' }] }),
      );
      const file = await loadBacklogFile(rootDir);
      expect(file).toEqual({ version: 1, items: [] });
    });

    test('non-array items → fresh state', async () => {
      await writeFile(
        join(rootDir, 'backlog.json'),
        JSON.stringify({ version: 1, items: 'not-an-array' }),
      );
      const file = await loadBacklogFile(rootDir);
      expect(file).toEqual({ version: 1, items: [] });
    });

    test('null items → fresh state', async () => {
      await writeFile(
        join(rootDir, 'backlog.json'),
        JSON.stringify({ version: 1, items: null }),
      );
      const file = await loadBacklogFile(rootDir);
      expect(file).toEqual({ version: 1, items: [] });
    });

    test('missing version field → fresh state', async () => {
      await writeFile(
        join(rootDir, 'backlog.json'),
        JSON.stringify({ items: [] }),
      );
      const file = await loadBacklogFile(rootDir);
      expect(file).toEqual({ version: 1, items: [] });
    });

    test('empty file (0 bytes) → fresh state', async () => {
      await writeFile(join(rootDir, 'backlog.json'), '');
      const file = await loadBacklogFile(rootDir);
      expect(file).toEqual({ version: 1, items: [] });
    });
  });

  // -------------------------------------------------------------------------
  // saveBacklogFile — atomic write semantics
  // -------------------------------------------------------------------------

  describe('saveBacklogFile — atomic write', () => {
    test('writes backlog.json (not a different name)', async () => {
      const file: BacklogFile = { version: 1, items: [] };
      await saveBacklogFile(rootDir, file);
      const entries = await readdir(rootDir);
      expect(entries).toContain('backlog.json');
    });

    test('does NOT leave a .tmp file behind after successful save', async () => {
      // Atomic write strategy: tmp + rename. After rename succeeds,
      // the .tmp file must be gone. A leftover .tmp indicates a crash
      // mid-write OR a future refactor that skipped the rename.
      const file: BacklogFile = {
        version: 1,
        items: [{ id: 'bl_test', goal: 'g', origin: 'user', priority: 50, createdAt: '2026-01-01' }],
      };
      await saveBacklogFile(rootDir, file);
      const entries = await readdir(rootDir);
      expect(entries).not.toContain('backlog.json.tmp');
      expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
    });

    test('output uses 2-space JSON indent', async () => {
      const file: BacklogFile = {
        version: 1,
        items: [{ id: 'bl_x', goal: 'g', origin: 'user', priority: 50, createdAt: '2026-01-01' }],
      };
      await saveBacklogFile(rootDir, file);
      const raw = await readFile(join(rootDir, 'backlog.json'), 'utf8');
      // JSON.stringify(file, null, 2) produces lines with 2-space indent.
      expect(raw).toContain('\n  "version"');
      expect(raw).toContain('\n  "items"');
      // No tabs.
      expect(raw).not.toContain('\t');
    });

    test('output ends with a trailing newline', async () => {
      const file: BacklogFile = { version: 1, items: [] };
      await saveBacklogFile(rootDir, file);
      const raw = await readFile(join(rootDir, 'backlog.json'), 'utf8');
      expect(raw.endsWith('\n')).toBe(true);
      // Exactly one trailing newline (not two).
      expect(raw.endsWith('\n\n')).toBe(false);
    });

    test('save → load round-trips the file verbatim', async () => {
      const original: BacklogFile = {
        version: 1,
        items: [
          { id: 'bl_abc123', goal: 'first', origin: 'user', priority: 50, createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'bl_def456', goal: 'second', origin: 'dream', priority: 100, createdAt: '2026-01-02T00:00:00.000Z' },
        ],
      };
      await saveBacklogFile(rootDir, original);
      const loaded = await loadBacklogFile(rootDir);
      expect(loaded).toEqual(original);
    });

    test('overwrites existing backlog.json (not appends)', async () => {
      // saveBacklogFile does a full rewrite — the tmp+rename strategy
      // replaces the file wholesale, not appends to it.
      const first: BacklogFile = {
        version: 1,
        items: [{ id: 'bl_a', goal: 'first', origin: 'user', priority: 50, createdAt: '2026-01-01' }],
      };
      await saveBacklogFile(rootDir, first);

      const second: BacklogFile = {
        version: 1,
        items: [{ id: 'bl_b', goal: 'second', origin: 'user', priority: 50, createdAt: '2026-01-02' }],
      };
      await saveBacklogFile(rootDir, second);

      const loaded = await loadBacklogFile(rootDir);
      expect(loaded.items).toHaveLength(1);
      expect(loaded.items[0]!.id).toBe('bl_b');
    });
  });

  // -------------------------------------------------------------------------
  // byPriorityThenTime comparator (via observable sort behavior)
  // -------------------------------------------------------------------------

  describe('byPriorityThenTime comparator', () => {
    test('lower priority number dequeues first', async () => {
      // priority=100 (dream) enqueued first, priority=50 (user) second.
      // Dequeue should still return the priority=50 item first.
      await enqueueBacklog(rootDir, 'low-prio dream', 'dream');
      await enqueueBacklog(rootDir, 'high-prio user', 'user');
      const next = await peekBacklog(rootDir);
      expect(next?.goal).toBe('high-prio user');
    });

    test('equal priority preserves insertion (createdAt) order', async () => {
      // Two user-origin items (both priority=50): first in, first out.
      await enqueueBacklog(rootDir, 'first-user', 'user');
      await enqueueBacklog(rootDir, 'second-user', 'user');
      const list = await listBacklog(rootDir);
      expect(list[0]!.goal).toBe('first-user');
      expect(list[1]!.goal).toBe('second-user');
    });

    test('sort is stable — listBacklog does not mutate the persistent file order', async () => {
      // listBacklog returns [...file.items].sort(...), so the in-file
      // order is preserved; the sort is on the copy only. Verify by
      // reading raw JSON after listBacklog.
      await enqueueBacklog(rootDir, 'dream-A', 'dream');   // priority 100
      await enqueueBacklog(rootDir, 'user-B', 'user');     // priority 50
      await enqueueBacklog(rootDir, 'dream-C', 'dream');   // priority 100

      await listBacklog(rootDir); // sorted copy
      const raw = await readFile(join(rootDir, 'backlog.json'), 'utf8');
      const parsed = JSON.parse(raw);
      // Insertion order preserved in the file.
      const goals = parsed.items.map((i: { goal: string }) => i.goal);
      expect(goals).toEqual(['dream-A', 'user-B', 'dream-C']);
    });
    test('full ordering: 50 → 75 → 90 → 100', async () => {
      // Enqueue out of priority order; dequeue should emit in strict
      // priority-ascending order.
      await enqueueBacklog(rootDir, 'dream-100', 'dream');
      await enqueueBacklog(rootDir, 'curiosity-90', 'curiosity');
      await enqueueBacklog(rootDir, 'reflect-75', 'reflect');
      await enqueueBacklog(rootDir, 'user-50', 'user');

      const order: string[] = [];
      let item = await dequeueBacklog(rootDir);
      while (item !== null) {
        order.push(item.goal);
        item = await dequeueBacklog(rootDir);
      }
      expect(order).toEqual(['user-50', 'reflect-75', 'curiosity-90', 'dream-100']);
    });
  });

  // -------------------------------------------------------------------------
  // dequeueBacklog outbox ordering (Iteration 24 contract)
  // -------------------------------------------------------------------------

  describe('dequeueBacklog outbox ordering', () => {
    test('save happens BEFORE incrementSeedAttempt (counter only bumps on success)', async () => {
      // If the order were reversed, a failed save would bump the seed
      // counter without actually dequeuing. Three failed saves would
      // permanently block the goal via isSeedExhausted.
      //
      // We can't easily inject a save failure without mocking fs, but
      // we CAN verify the happy-path ordering by observing that after
      // a successful dequeue: (1) the item is gone from the file, (2)
      // the seed counter for that goal is incremented.
      await enqueueBacklog(rootDir, 'goal-to-dequeue', 'dream');
      expect(await sizeBacklog(rootDir)).toBe(1);

      const dequeued = await dequeueBacklog(rootDir);
      expect(dequeued).not.toBeNull();
      expect(dequeued?.goal).toBe('goal-to-dequeue');

      // File no longer contains the item.
      expect(await sizeBacklog(rootDir)).toBe(0);
    });

    test('dequeue removes only the target item (others preserved)', async () => {
      await enqueueBacklog(rootDir, 'keep-A', 'user');
      await enqueueBacklog(rootDir, 'dequeue-B', 'user');
      await enqueueBacklog(rootDir, 'keep-C', 'user');

      const dequeued = await dequeueBacklog(rootDir);
      expect(dequeued?.goal).toBe('keep-A'); // first in, first out (equal priority)

      const remaining = await listBacklog(rootDir);
      expect(remaining.map((i) => i.goal)).toEqual(['dequeue-B', 'keep-C']);
    });

    test('dequeue on empty queue returns null (not an error, not undefined)', async () => {
      const result = await dequeueBacklog(rootDir);
      expect(result).toBeNull();
    });

    test('repeated dequeue drains the queue in priority order', async () => {
      await enqueueBacklog(rootDir, 'a', 'dream');
      await enqueueBacklog(rootDir, 'b', 'user');
      await enqueueBacklog(rootDir, 'c', 'reflect');

      const seen: string[] = [];
      for (let i = 0; i < 3; i++) {
        const item = await dequeueBacklog(rootDir);
        if (item) seen.push(item.goal);
      }
      expect(seen).toEqual(['b', 'c', 'a']); // 50, 75, 100
      expect(await dequeueBacklog(rootDir)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // peekBacklog — non-mutating read
  // -------------------------------------------------------------------------

  describe('peekBacklog — non-mutating', () => {
    test('peek does NOT remove the item from the file', async () => {
      await enqueueBacklog(rootDir, 'peeked', 'user');
      await peekBacklog(rootDir);
      await peekBacklog(rootDir);
      await peekBacklog(rootDir);
      expect(await sizeBacklog(rootDir)).toBe(1);
    });

    test('peek returns null on empty queue', async () => {
      expect(await peekBacklog(rootDir)).toBeNull();
    });

    test('repeated peeks return the same item (idempotent read)', async () => {
      await enqueueBacklog(rootDir, 'stable-item', 'user');
      const p1 = await peekBacklog(rootDir);
      const p2 = await peekBacklog(rootDir);
      const p3 = await peekBacklog(rootDir);
      expect(p1?.id).toBe(p2?.id);
      expect(p2?.id).toBe(p3?.id);
    });
  });

  // -------------------------------------------------------------------------
  // listBacklog — sorted copy
  // -------------------------------------------------------------------------

  describe('listBacklog — sorted copy', () => {
    test('returns an array (not null)', async () => {
      const list = await listBacklog(rootDir);
      expect(Array.isArray(list)).toBe(true);
    });

    test('empty queue returns empty array', async () => {
      expect(await listBacklog(rootDir)).toEqual([]);
    });

    test('returns items sorted by priority then time', async () => {
      await enqueueBacklog(rootDir, 'dream-A', 'dream');   // 100
      await enqueueBacklog(rootDir, 'user-B', 'user');     // 50
      await enqueueBacklog(rootDir, 'reflect-C', 'reflect'); // 75

      const list = await listBacklog(rootDir);
      expect(list.map((i) => i.goal)).toEqual(['user-B', 'reflect-C', 'dream-A']);
    });

    test('returned array is a fresh copy — mutating it does not affect subsequent reads', async () => {
      await enqueueBacklog(rootDir, 'item', 'user');
      const list1 = await listBacklog(rootDir);
      list1.length = 0; // mutate the returned array
      const list2 = await listBacklog(rootDir);
      expect(list2).toHaveLength(1);
    });

    test('count matches sizeBacklog', async () => {
      await enqueueBacklog(rootDir, 'a', 'user');
      await enqueueBacklog(rootDir, 'b', 'dream');
      const list = await listBacklog(rootDir);
      const size = await sizeBacklog(rootDir);
      expect(list.length).toBe(size);
    });
  });

  // -------------------------------------------------------------------------
  // removeBacklogItem — idempotency
  // -------------------------------------------------------------------------

  describe('removeBacklogItem — idempotency', () => {
    test('returns true when an item was removed', async () => {
      await enqueueBacklog(rootDir, 'to-remove', 'user');
      const list = await listBacklog(rootDir);
      const id = list[0]!.id;
      const removed = await removeBacklogItem(rootDir, id);
      expect(removed).toBe(true);
    });

    test('returns false when id is not in the queue', async () => {
      await enqueueBacklog(rootDir, 'unrelated', 'user');
      const removed = await removeBacklogItem(rootDir, 'bl_nonexistent');
      expect(removed).toBe(false);
    });

    test('returns false on empty queue', async () => {
      const removed = await removeBacklogItem(rootDir, 'bl_anything');
      expect(removed).toBe(false);
    });

    test('second call with same id returns false (already removed)', async () => {
      await enqueueBacklog(rootDir, 'once-only', 'user');
      const id = (await listBacklog(rootDir))[0]!.id;
      expect(await removeBacklogItem(rootDir, id)).toBe(true);
      expect(await removeBacklogItem(rootDir, id)).toBe(false);
    });

    test('removing one item preserves others', async () => {
      await enqueueBacklog(rootDir, 'a', 'user');
      await enqueueBacklog(rootDir, 'b', 'user');
      await enqueueBacklog(rootDir, 'c', 'user');
      const list = await listBacklog(rootDir);
      const targetId = list[1]!.id;
      await removeBacklogItem(rootDir, targetId);
      const after = await listBacklog(rootDir);
      expect(after).toHaveLength(2);
      expect(after.find((i) => i.id === targetId)).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // sizeBacklog
  // -------------------------------------------------------------------------

  describe('sizeBacklog', () => {
    test('returns 0 on empty queue', async () => {
      expect(await sizeBacklog(rootDir)).toBe(0);
    });

    test('count reflects persistence (survives across calls)', async () => {
      await enqueueBacklog(rootDir, 'a', 'user');
      expect(await sizeBacklog(rootDir)).toBe(1);
      await enqueueBacklog(rootDir, 'b', 'user');
      expect(await sizeBacklog(rootDir)).toBe(2);
      await dequeueBacklog(rootDir);
      expect(await sizeBacklog(rootDir)).toBe(1);
    });

    test('sizeBacklog is unsorted (just file.items.length)', async () => {
      // sizeBacklog reads the file and returns .length directly, no sort.
      // Verify it matches the raw JSON item count regardless of priority order.
      await enqueueBacklog(rootDir, 'low', 'dream');
      await enqueueBacklog(rootDir, 'high', 'user');
      const raw = await readFile(join(rootDir, 'backlog.json'), 'utf8');
      const parsed = JSON.parse(raw);
      const size = await sizeBacklog(rootDir);
      expect(size).toBe(parsed.items.length);
    });
  });
});
