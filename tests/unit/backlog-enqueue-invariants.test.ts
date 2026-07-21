import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enqueueBacklog } from '../../src/cerebellum/backlog-enqueue.js';
import {
  defaultPriorityForOrigin,
  generateBacklogId,
  sizeBacklog,
} from '../../src/cerebellum/backlog.js';
import {
  clearCompletedGoals,
  markCompleted,
} from '../../src/cerebellum/completedGoals.js';
import {
  clearSeedAttempts,
  incrementSeedAttempt,
} from '../../src/cerebellum/seedAttempts.js';
import {
  clearRetryCounters,
  getRetryCount,
  incrementRetryCounter,
} from '../../src/cerebellum/retry-counter.js';
import {
  clearSkippedEnqueues,
  listSkippedEnqueues,
} from '../../src/cerebellum/backlog-registries.js';
import type { BacklogOrigin } from '../../src/orchestrator/events.js';

/**
 * enqueueBacklog — shape, timing, and ordering invariants.
 *
 * backlog.test.ts covers behavior broadly (60+ tests): retry-exhausted
 * blocking, user-origin bypass, dedup registry recording, persistence.
 * But the load-bearing structural contracts that a refactor could
 * silently break are NOT pinned:
 *
 *   - PHANTOM ITEM SHAPE. When dedup blocks, the function returns a
 *     BacklogItem but does NOT write to disk. The returned item must
 *     have the exact 5 required keys (id, goal, origin, priority,
 *     createdAt) with sourceWaypointId conditionally present
 *     (exactOptionalPropertyTypes). A refactor that writes phantom items
 *     would silently re-introduce the Iteration 18 bug where "你好" was
 *     dropped silently — the user saw zero response.
 *
 *   - PHANTOM PATH DOES NOT INCREMENT RETRY COUNTER. This is the
 *     Iteration 24 fix. Originally the counter was bumped before save,
 *     so 3 failed saves (disk full, permissions) would permanently
 *     block re-enqueueing a goal that never landed in the queue. The
 *     current contract: phantom items never touch the counter because
 *     they're already-dropped dedup hits, not new attempts.
 *
 *   - SUCCESSFUL PATH INCREMENTS COUNTER AFTER SAVE. Same Iteration 24
 *     contract: the increment happens only after saveBacklogFile
 *     resolves. A refactor that moves the increment before save would
 *     re-introduce the freeze bug.
 *
 *   - DEDUP CHECK ORDERING. seed-exhausted → retry-exhausted →
 *     already-completed. When multiple would trip, the FIRST one wins
 *     and is recorded with that reason. Reordering would silently
 *     change which reason is logged for ambiguous cases.
 *
 *   - USER-ORIGIN NEVER CALLS recordSkippedEnqueue. The bypass is total
 *     — no skipped record is ever emitted for user-origin items, even
 *     when all three dedup checks would trip.
 *
 *   - defaultPriorityForOrigin mapping. The priority values (user=50,
 *     plan=50, reflect=75, curiosity=90, dream=100, system=100) drive
 *     dequeue ordering. Drift here would silently change which work
 *     preempts which.
 *
 * Each test below pins one slice of these contracts.
 */

describe('defaultPriorityForOrigin — origin-to-priority mapping', () => {
  // The mapping is a load-bearing contract: lower number = higher priority,
  // and the ordering user < reflect < curiosity < dream determines what
  // preempts what in the dequeue comparator. A refactor that swaps two
  // values would silently change execution order.

  test('user → 50 (preempts everything except plan)', () => {
    expect(defaultPriorityForOrigin('user')).toBe(50);
  });

  test('plan → 50 (same urgency as user — plan steps ARE user intent)', () => {
    expect(defaultPriorityForOrigin('plan')).toBe(50);
  });

  test('reflect → 75 (failure-driven, urgent)', () => {
    expect(defaultPriorityForOrigin('reflect')).toBe(75);
  });

  test('curiosity → 90 (forward-looking, preempts idle dreaming)', () => {
    expect(defaultPriorityForOrigin('curiosity')).toBe(90);
  });

  test('dream → 100 (lowest urgency — exploratory)', () => {
    expect(defaultPriorityForOrigin('dream')).toBe(100);
  });

  test('system → 100 (bookkeeping, same as dream)', () => {
    expect(defaultPriorityForOrigin('system')).toBe(100);
  });

  test('user and plan share the same priority (50)', () => {
    // This is deliberate — plan steps are user-intent, just structured.
    // See the source comment: "Priority matches user rather than sitting
    // between user and reflect because plan steps ARE user-intent."
    expect(defaultPriorityForOrigin('user')).toBe(defaultPriorityForOrigin('plan'));
  });

  test('strict ordering user < reflect < curiosity < dream', () => {
    // The ordering chain that drives dequeue. Pinning the STRICT inequality
    // so a refactor that equalizes two tiers (e.g. dream = curiosity = 90)
    // is caught.
    const u = defaultPriorityForOrigin('user');
    const r = defaultPriorityForOrigin('reflect');
    const c = defaultPriorityForOrigin('curiosity');
    const d = defaultPriorityForOrigin('dream');
    expect(u).toBeLessThan(r);
    expect(r).toBeLessThan(c);
    expect(c).toBeLessThan(d);
  });

  test('all six origins return a finite, integer priority', () => {
    // Defensive: no NaN, no float, no negative.
    const origins: BacklogOrigin[] = ['user', 'plan', 'reflect', 'curiosity', 'dream', 'system'];
    for (const o of origins) {
      const p = defaultPriorityForOrigin(o);
      expect(Number.isFinite(p)).toBe(true);
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBeGreaterThan(0);
    }
  });
});

describe('generateBacklogId — format invariant', () => {
  // The id format `bl_<12 hex>` is documented in BacklogItem.id. The "bl_"
  // prefix is grep-able — operator workflows rely on it. 12 hex chars =
  // 6 random bytes. Pinning both the prefix and the length so a refactor
  // that changes either is caught.

  test('id starts with "bl_" prefix', () => {
    expect(generateBacklogId()).toMatch(/^bl_/);
  });

  test('id has exactly 12 hex chars after the prefix', () => {
    const id = generateBacklogId();
    const hex = id.slice(3);
    expect(hex).toMatch(/^[0-9a-f]{12}$/);
  });

  test('two consecutive ids are distinct (random source is working)', () => {
    // 6 bytes of randomness → collision probability is astronomically low.
    // If the random source broke (e.g. seeding to 0), this catches it.
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      ids.add(generateBacklogId());
    }
    expect(ids.size).toBe(20);
  });
});

describe('enqueueBacklog — phantom item shape (dedup-blocked returns)', () => {
  let rootDir: string;

  beforeEach(async () => {
    clearCompletedGoals();
    clearSeedAttempts();
    clearRetryCounters();
    clearSkippedEnqueues();
    rootDir = await mkdtemp(join(tmpdir(), 'ody-blq-shape-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('already-completed phantom item has exactly 5 keys (no sourceWaypointId)', async () => {
    // When dedup blocks, the function returns a BacklogItem WITHOUT
    // writing to disk. The returned item must still be a complete
    // BacklogItem (callers depend on item.id, item.goal, etc.).
    // Pinning the exact key set so a refactor that adds or removes a
    // field is caught.
    markCompleted('phantom goal', 'done in prior voyage');
    const item = await enqueueBacklog(rootDir, 'phantom goal', 'dream');
    expect(item.goal).toBe('phantom goal');
    expect(item.origin).toBe('dream');
    expect(typeof item.id).toBe('string');
    expect(typeof item.priority).toBe('number');
    expect(typeof item.createdAt).toBe('string');
    // sourceWaypointId must NOT appear when not provided (exactOptional).
    expect('sourceWaypointId' in item).toBe(false);
    // Exactly 5 keys total.
    expect(Object.keys(item).sort()).toEqual(
      ['createdAt', 'goal', 'id', 'origin', 'priority'].sort(),
    );
    // And the backlog file did NOT grow.
    expect(await sizeBacklog(rootDir)).toBe(0);
  });

  test('seed-exhausted phantom item has the same shape as already-completed', async () => {
    // Same shape contract — different dedup path, same return structure.
    incrementSeedAttempt('seed goal');
    incrementSeedAttempt('seed goal');
    incrementSeedAttempt('seed goal');
    const item = await enqueueBacklog(rootDir, 'seed goal', 'reflect');
    expect(Object.keys(item)).toHaveLength(5);
    expect('sourceWaypointId' in item).toBe(false);
    expect(await sizeBacklog(rootDir)).toBe(0);
  });

  test('retry-exhausted phantom item has the same shape', async () => {
    for (let i = 0; i < 5; i++) {
      incrementRetryCounter('retry goal');
    }
    const item = await enqueueBacklog(rootDir, 'retry goal', 'curiosity');
    expect(Object.keys(item)).toHaveLength(5);
    expect('sourceWaypointId' in item).toBe(false);
    expect(await sizeBacklog(rootDir)).toBe(0);
  });

  test('phantom item with sourceWaypointId provided → key IS present (6 keys)', async () => {
    // The conditional spread `...(options?.sourceWaypointId !== undefined
    // ? { sourceWaypointId: options.sourceWaypointId } : {})` is the
    // exactOptionalPropertyTypes pattern. When provided, the key appears.
    markCompleted('with src', 'done');
    const item = await enqueueBacklog(rootDir, 'with src', 'dream', {
      sourceWaypointId: 'wp_abc123',
    });
    expect(Object.keys(item)).toHaveLength(6);
    expect(item.sourceWaypointId).toBe('wp_abc123');
    expect('sourceWaypointId' in item).toBe(true);
  });

  test('explicitly undefined sourceWaypointId → key still NOT present', async () => {
    // The gate is `!== undefined`, not a truthiness check. Passing
    // undefined explicitly must behave identically to omitting the key.
    markCompleted('explicit undef', 'done');
    const item = await enqueueBacklog(rootDir, 'explicit undef', 'dream', {
      sourceWaypointId: undefined,
    });
    expect('sourceWaypointId' in item).toBe(false);
    expect(Object.keys(item)).toHaveLength(5);
  });

  test('phantom item uses defaultPriorityForOrigin for priority', async () => {
    // The phantom path calls `options?.priority ?? defaultPriorityForOrigin(origin)`.
    // For origin=dream, default is 100. Pinning this so a refactor that
    // hard-codes a different default (e.g. always 100 regardless of origin)
    // is caught for non-dream origins too.
    markCompleted('prio check', 'done');
    const item = await enqueueBacklog(rootDir, 'prio check', 'reflect');
    expect(item.priority).toBe(defaultPriorityForOrigin('reflect'));
    expect(item.priority).toBe(75);
  });

  test('phantom item generates ISO 8601 createdAt when not provided', async () => {
    markCompleted('time check', 'done');
    const before = new Date().toISOString();
    const item = await enqueueBacklog(rootDir, 'time check', 'dream');
    const after = new Date().toISOString();
    expect(new Date(item.createdAt).toString()).not.toBe('Invalid Date');
    expect(item.createdAt >= before).toBe(true);
    expect(item.createdAt <= after).toBe(true);
  });

  test('phantom item generates bl_<12 hex> id when not provided', async () => {
    markCompleted('id check', 'done');
    const item = await enqueueBacklog(rootDir, 'id check', 'dream');
    expect(item.id).toMatch(/^bl_[0-9a-f]{12}$/);
  });

  test('caller-supplied id, priority, createdAt are preserved verbatim on phantom path', async () => {
    // Even on the dedup-blocked path, caller-supplied options take
    // precedence over generated defaults. Pinning this so a refactor
    // that "normalizes" caller values on the phantom path is caught.
    markCompleted('custom opts', 'done');
    const item = await enqueueBacklog(rootDir, 'custom opts', 'dream', {
      id: 'custom_id_123',
      priority: 42,
      createdAt: '2020-01-01T00:00:00.000Z',
      sourceWaypointId: 'wp_custom',
    });
    expect(item.id).toBe('custom_id_123');
    expect(item.priority).toBe(42);
    expect(item.createdAt).toBe('2020-01-01T00:00:00.000Z');
    expect(item.sourceWaypointId).toBe('wp_custom');
  });
});

describe('enqueueBacklog — retry counter timing (Iteration 24 contract)', () => {
  let rootDir: string;

  beforeEach(async () => {
    clearCompletedGoals();
    clearSeedAttempts();
    clearRetryCounters();
    clearSkippedEnqueues();
    rootDir = await mkdtemp(join(tmpdir(), 'ody-blq-timing-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('phantom path does NOT increment the retry counter', async () => {
    // Critical Iteration 24 contract. The retry counter tracks "how many
    // times did we try to enqueue this goal". Phantom items are already-
    // dropped dedup hits — they should NOT count as new attempts. A
    // refactor that increments the counter for phantom items would
    // unfairly exhaust the retry budget for goals that never landed.
    expect(getRetryCount('phantom test')).toBe(0);
    markCompleted('phantom test', 'done');
    await enqueueBacklog(rootDir, 'phantom test', 'dream');
    expect(getRetryCount('phantom test')).toBe(0);
  });

  test('seed-exhausted phantom does NOT increment counter', async () => {
    incrementSeedAttempt('seed timing');
    incrementSeedAttempt('seed timing');
    incrementSeedAttempt('seed timing');
    expect(getRetryCount('seed timing')).toBe(0);
    await enqueueBacklog(rootDir, 'seed timing', 'reflect');
    expect(getRetryCount('seed timing')).toBe(0);
  });

  test('retry-exhausted phantom does NOT increment counter (idempotent)', async () => {
    // Pre-exhaust the counter to 5. The phantom path must NOT bump it to 6.
    // If it did, subsequent calls would keep inflating the counter
    // (though it's already exhausted — but the principle matters for
    // observability: getRetryCount should reflect real enqueue attempts).
    for (let i = 0; i < 5; i++) {
      incrementRetryCounter('retry timing');
    }
    expect(getRetryCount('retry timing')).toBe(5);
    await enqueueBacklog(rootDir, 'retry timing', 'curiosity');
    expect(getRetryCount('retry timing')).toBe(5);
  });

  test('successful path increments counter exactly once per call', async () => {
    // The happy path calls incrementRetryCounter(trimmedGoal) after save.
    // Each successful enqueue → +1.
    expect(getRetryCount('happy')).toBe(0);
    await enqueueBacklog(rootDir, 'happy', 'dream');
    expect(getRetryCount('happy')).toBe(1);
    await enqueueBacklog(rootDir, 'happy', 'dream');
    expect(getRetryCount('happy')).toBe(2);
    await enqueueBacklog(rootDir, 'happy', 'dream');
    expect(getRetryCount('happy')).toBe(3);
  });

  test('successful user-origin increments counter (informational)', async () => {
    // User-origin bypasses dedup but STILL increments the counter — this
    // is documented as "informational, not a gate". Other modules can
    // observe user activity via getRetryCount. Pinning that the bypass
    // does NOT skip the counter increment.
    expect(getRetryCount('user activity')).toBe(0);
    await enqueueBacklog(rootDir, 'user activity', 'user');
    expect(getRetryCount('user activity')).toBe(1);
  });

  test('goal is normalized for counter key (whitespace/case/punct do not split the bucket)', async () => {
    // enqueueBacklog trims the goal once at entry, then passes the
    // trimmed form to incrementRetryCounter. Internally, retry-counter
    // further normalizes via hashGoalDescription (lowercase + strip all
    // non-alphanumeric). So 'Add Retry!' and 'add retry' share a counter.
    // Pinning that surface-form variations don't split the bucket —
    // a refactor that changes either normalization layer would silently
    // split one logical goal into multiple counters, breaking the
    // retry-exhaustion gate.
    await enqueueBacklog(rootDir, 'Add Retry!', 'dream');
    expect(getRetryCount('addretry')).toBe(1);
    expect(getRetryCount('ADD RETRY')).toBe(1);
    expect(getRetryCount('  add retry  ')).toBe(1);

    await enqueueBacklog(rootDir, 'ADD RETRY', 'dream');
    expect(getRetryCount('add retry')).toBe(2);
  });
});

describe('enqueueBacklog — dedup check ordering', () => {
  let rootDir: string;

  beforeEach(async () => {
    clearCompletedGoals();
    clearSeedAttempts();
    clearRetryCounters();
    clearSkippedEnqueues();
    rootDir = await mkdtemp(join(tmpdir(), 'ody-blq-order-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('seed-exhausted is checked BEFORE retry-exhausted', async () => {
    // Make BOTH trip. The first check (isSeedExhausted) wins → recorded
    // reason must be 'seed-exhausted', not 'retry-exhausted'.
    incrementSeedAttempt('multi-trip-a');
    incrementSeedAttempt('multi-trip-a');
    incrementSeedAttempt('multi-trip-a');
    for (let i = 0; i < 5; i++) {
      incrementRetryCounter('multi-trip-a');
    }
    await enqueueBacklog(rootDir, 'multi-trip-a', 'dream');
    const skipped = listSkippedEnqueues();
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toBe('seed-exhausted');
  });

  test('retry-exhausted is checked BEFORE already-completed', async () => {
    // Make retry-exhausted AND already-completed trip. retry-exhausted
    // is checked second (after seed-exhausted), already-completed is
    // third. So retry-exhausted wins.
    for (let i = 0; i < 5; i++) {
      incrementRetryCounter('multi-trip-b');
    }
    markCompleted('multi-trip-b', 'done');
    await enqueueBacklog(rootDir, 'multi-trip-b', 'dream');
    const skipped = listSkippedEnqueues();
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toBe('retry-exhausted');
  });

  test('seed-exhausted is checked BEFORE already-completed', async () => {
    // Make seed-exhausted AND already-completed trip (retry NOT exhausted).
    // seed-exhausted wins.
    incrementSeedAttempt('multi-trip-c');
    incrementSeedAttempt('multi-trip-c');
    incrementSeedAttempt('multi-trip-c');
    markCompleted('multi-trip-c', 'done');
    await enqueueBacklog(rootDir, 'multi-trip-c', 'dream');
    const skipped = listSkippedEnqueues();
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toBe('seed-exhausted');
  });

  test('all three checks trip → seed-exhausted wins (first in chain)', async () => {
    // All three checks return true. The source checks them in order:
    // seed → retry → completed. The first (seed-exhausted) wins.
    incrementSeedAttempt('multi-trip-d');
    incrementSeedAttempt('multi-trip-d');
    incrementSeedAttempt('multi-trip-d');
    for (let i = 0; i < 5; i++) {
      incrementRetryCounter('multi-trip-d');
    }
    markCompleted('multi-trip-d', 'done');
    await enqueueBacklog(rootDir, 'multi-trip-d', 'dream');
    const skipped = listSkippedEnqueues();
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toBe('seed-exhausted');
  });

  test('skipped registry records each dedup reason distinctly when only one trips', async () => {
    // Pinning the EXACT reason strings — downstream dashboards and grep
    // workflows rely on these. Drift in the string would break queries.
    markCompleted('reason-test-completed', 'done');
    await enqueueBacklog(rootDir, 'reason-test-completed', 'dream');
    expect(listSkippedEnqueues()[0]!.reason).toBe('already-completed');

    incrementSeedAttempt('reason-test-seed');
    incrementSeedAttempt('reason-test-seed');
    incrementSeedAttempt('reason-test-seed');
    await enqueueBacklog(rootDir, 'reason-test-seed', 'dream');
    expect(listSkippedEnqueues()[1]!.reason).toBe('seed-exhausted');

    for (let i = 0; i < 5; i++) {
      incrementRetryCounter('reason-test-retry');
    }
    await enqueueBacklog(rootDir, 'reason-test-retry', 'dream');
    expect(listSkippedEnqueues()[2]!.reason).toBe('retry-exhausted');
  });
});

describe('enqueueBacklog — user-origin total bypass', () => {
  let rootDir: string;

  beforeEach(async () => {
    clearCompletedGoals();
    clearSeedAttempts();
    clearRetryCounters();
    clearSkippedEnqueues();
    rootDir = await mkdtemp(join(tmpdir(), 'ody-blq-user-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('user-origin with all three checks tripped → NO skipped record emitted', async () => {
    // The bypass is total: the user-origin branch is taken BEFORE any
    // dedup check. recordSkippedEnqueue is NEVER called for user-origin.
    // Pinning this because a refactor that moves the user-origin check
    // later (e.g. after seed-exhausted) would silently re-introduce
    // skipped records for user input.
    incrementSeedAttempt('user all');
    incrementSeedAttempt('user all');
    incrementSeedAttempt('user all');
    for (let i = 0; i < 5; i++) {
      incrementRetryCounter('user all');
    }
    markCompleted('user all', 'done');
    await enqueueBacklog(rootDir, 'user all', 'user');
    expect(listSkippedEnqueues()).toHaveLength(0);
  });

  test('user-origin ALWAYS writes to disk (no phantom path)', async () => {
    // There is no user-origin phantom path. Every user-origin call
    // writes exactly one item to the backlog. This is the Iteration 18
    // fix: user input MUST always produce a waypoint.
    markCompleted('user write', 'done');
    expect(await sizeBacklog(rootDir)).toBe(0);
    await enqueueBacklog(rootDir, 'user write', 'user');
    expect(await sizeBacklog(rootDir)).toBe(1);
  });

  test('user-origin written item has origin === "user" (not the underlying trigger)', async () => {
    // Even when called from a context that might have a different origin
    // in mind (e.g. a user resending a prior dream), the written origin
    // is always 'user'. Pinning this so a refactor that forwards a
    // different origin is caught.
    const item = await enqueueBacklog(rootDir, 'origin test', 'user');
    expect(item.origin).toBe('user');
  });
});

describe('enqueueBacklog — written item shape (successful path)', () => {
  let rootDir: string;

  beforeEach(async () => {
    clearCompletedGoals();
    clearSeedAttempts();
    clearRetryCounters();
    clearSkippedEnqueues();
    rootDir = await mkdtemp(join(tmpdir(), 'ody-blq-write-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('written item matches the returned item exactly (deep equal)', async () => {
    // The function returns the item it wrote to disk. A refactor that
    // post-processes the returned item differently from the written one
    // would cause drift. Pinning deep equality.
    const returned = await enqueueBacklog(rootDir, 'sync test', 'dream', {
      sourceWaypointId: 'wp_sync',
    });
    const raw = await readFile(join(rootDir, 'backlog.json'), 'utf8');
    const parsed = JSON.parse(raw) as { items: unknown[] };
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toEqual(returned);
  });

  test('backlog.json file format is { version: 1, items: [...] }', async () => {
    // The file shape is documented in BacklogFile. version:1 is the
    // schema marker; a future v2 migration would need to handle this.
    // Pinning the version constant so a refactor that drops or renames
    // it is caught (the loader falls back to empty on mismatch).
    await enqueueBacklog(rootDir, 'format test', 'dream');
    const raw = await readFile(join(rootDir, 'backlog.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version: unknown; items: unknown };
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.items)).toBe(true);
  });

  test('written item goal is trimmed (leading/trailing whitespace removed)', async () => {
    // The source does `goal.trim()` at the top. Pinning that the written
    // item reflects the trimmed form — a refactor that writes the raw
    // goal would silently produce weird prompts (extra whitespace
    // breaks LLM tokenization slightly).
    await enqueueBacklog(rootDir, '  trim me  ', 'user');
    const raw = await readFile(join(rootDir, 'backlog.json'), 'utf8');
    const parsed = JSON.parse(raw) as { items: Array<{ goal: string }> };
    expect(parsed.items[0]!.goal).toBe('trim me');
  });

  test('empty goal throws (does NOT silently produce an empty item)', async () => {
    // The source throws on trimmed.length === 0. Pinning that the throw
    // happens — a refactor that returns a phantom item with empty goal
    // would silently corrupt the backlog.
    await expect(enqueueBacklog(rootDir, '', 'user')).rejects.toThrow(/empty/);
    await expect(enqueueBacklog(rootDir, '   ', 'user')).rejects.toThrow(/empty/);
    await expect(enqueueBacklog(rootDir, '\t\t', 'user')).rejects.toThrow(/empty/);
  });

  test('items accumulate in insertion order (append-only)', async () => {
    // Each call appends one item. A refactor that switches to read-
    // modify-write with sorting would silently change the file shape.
    await enqueueBacklog(rootDir, 'first', 'user');
    await enqueueBacklog(rootDir, 'second', 'user');
    await enqueueBacklog(rootDir, 'third', 'user');
    const raw = await readFile(join(rootDir, 'backlog.json'), 'utf8');
    const parsed = JSON.parse(raw) as { items: Array<{ goal: string }> };
    expect(parsed.items.map((i) => i.goal)).toEqual(['first', 'second', 'third']);
  });
});

describe('enqueueBacklog — origin type coverage', () => {
  let rootDir: string;

  beforeEach(async () => {
    clearCompletedGoals();
    clearSeedAttempts();
    clearRetryCounters();
    clearSkippedEnqueues();
    rootDir = await mkdtemp(join(tmpdir(), 'ody-blq-origins-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('every autonomous origin is subject to dedup (no special-case bypass beyond user)', async () => {
    // Pinning that 'user' is the ONLY bypass. Any other origin (plan,
    // reflect, curiosity, dream, system) is subject to all three checks.
    // A refactor that adds another bypass (e.g. 'plan' for "operator-
    // approved plans") would silently change dedup semantics.
    const autonomousOrigins: BacklogOrigin[] = ['plan', 'reflect', 'curiosity', 'dream', 'system'];
    for (const origin of autonomousOrigins) {
      const goal = `test-${origin}`;
      markCompleted(goal, 'done');
      const item = await enqueueBacklog(rootDir, goal, origin);
      // Returns a phantom item — goal not written.
      expect(item.goal).toBe(goal);
      // Backlog file should not contain this goal.
      const size = await sizeBacklog(rootDir);
      // We're enqueuing one at a time; size should stay constant for
      // phantom paths. (It will be 0 for the first iteration.)
      expect(size).toBe(0);
      // Skipped registry records it.
      const skipped = listSkippedEnqueues();
      expect(skipped[skipped.length - 1]!.goal).toBe(goal);
      expect(skipped[skipped.length - 1]!.origin).toBe(origin);
      expect(skipped[skipped.length - 1]!.reason).toBe('already-completed');

      // Reset state for next origin iteration.
      clearCompletedGoals();
      clearSkippedEnqueues();
    }
  });
});
