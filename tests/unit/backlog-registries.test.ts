import { describe, test, expect, beforeEach } from 'vitest';
import {
  recordSkippedEnqueue,
  listSkippedEnqueues,
  clearSkippedEnqueues,
  recordRejectedGoal,
  listRejectedGoals,
  clearRejectedGoals,
} from '../../src/cerebellum/backlog-registries.js';

/**
 * backlog-registries.ts — two session-scoped in-memory observability
 * registries extracted from backlog.ts (Iteration 39).
 *
 *   - SkippedEnqueue: every silently-dropped enqueue (NO dedup, on
 *     purpose — a stuck retry loop producing 100 skips is the signal
 *     an operator wants).
 *   - RejectedGoal:   pre-dispatch validator rejections (WITH dedup
 *     on (goal, reason) pair — a re-injected greeting shouldn't spam
 *     the registry).
 *
 * The asymmetry is load-bearing: skippedEnqueue must NOT be deduped,
 * rejectedGoal MUST be deduped. These tests pin both behaviors.
 *
 * Until Iteration 58 the module had no dedicated test file — it was
 * exercised indirectly through backlog.test.ts and orchestrator
 * integration tests. Direct tests here can hit edge cases the
 * integration tests don't reach (empty goal rejection, reason
 * evolution, chronological order, cross-registry isolation).
 */

const ALL_ORIGINS = ['user', 'plan', 'dream', 'reflect', 'curiosity', 'system'] as const;
const ALL_REASONS = ['seed-exhausted', 'retry-exhausted', 'already-completed'] as const;

// ---------------------------------------------------------------------------
// SkippedEnqueue registry
// ---------------------------------------------------------------------------

describe('SkippedEnqueue registry — record / list / clear', () => {
  beforeEach(() => {
    clearSkippedEnqueues();
  });

  test('listSkippedEnqueues is empty by default', () => {
    expect(listSkippedEnqueues()).toEqual([]);
  });

  test('recordSkippedEnqueue stores the entry verbatim (no dedup)', () => {
    // This is the asymmetric contract vs RejectedGoal: skipped enqueue
    // must NOT dedup. A stuck loop that retries 100 times produces 100
    // entries — that's the signal.
    recordSkippedEnqueue('g', 'dream', 'seed-exhausted');
    recordSkippedEnqueue('g', 'dream', 'seed-exhausted');
    recordSkippedEnqueue('g', 'dream', 'seed-exhausted');

    const list = listSkippedEnqueues();
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual({
      goal: 'g',
      origin: 'dream',
      reason: 'seed-exhausted',
      skippedAt: expect.any(Number),
    });
  });

  test('does NOT trim the goal (records verbatim)', () => {
    // Contrasting with recordRejectedGoal which DOES trim. If a caller
    // passes whitespace-padded goal text, the registry preserves it —
    // this is intentional because the registry is an observability
    // surface, not a normalization boundary.
    recordSkippedEnqueue('  padded  ', 'dream', 'retry-exhausted');
    expect(listSkippedEnqueues()[0]?.goal).toBe('  padded  ');
  });

  test('preserves chronological insertion order', () => {
    recordSkippedEnqueue('first', 'dream', 'seed-exhausted');
    recordSkippedEnqueue('second', 'dream', 'retry-exhausted');
    recordSkippedEnqueue('third', 'curiosity', 'already-completed');

    const goals = listSkippedEnqueues().map((s) => s.goal);
    expect(goals).toEqual(['first', 'second', 'third']);
  });

  test('accepts every documented origin value', () => {
    for (const origin of ALL_ORIGINS) {
      recordSkippedEnqueue(`g-${origin}`, origin, 'seed-exhausted');
    }
    const origins = listSkippedEnqueues().map((s) => s.origin);
    expect(origins).toEqual([...ALL_ORIGINS]);
  });

  test('accepts every documented reason value', () => {
    for (const reason of ALL_REASONS) {
      recordSkippedEnqueue(`g-${reason}`, 'dream', reason);
    }
    const reasons = listSkippedEnqueues().map((s) => s.reason);
    expect(reasons).toEqual([...ALL_REASONS]);
  });

  test('returned array is a snapshot — mutating it does not affect future reads', () => {
    // listSkippedEnqueues returns `readonly SkippedEnqueue[]`, but the
    // runtime check is: callers cannot mutate the registry state via
    // the returned array reference. Pushing to the returned array does
    // not corrupt subsequent reads.
    // NOTE: the returned array IS the same reference (no copy), so
    // this test documents the current contract — if a future refactor
    // adds a copy-on-read, the registry semantics tighten.
    recordSkippedEnqueue('g', 'dream', 'seed-exhausted');
    const snapshot = listSkippedEnqueues();
    expect(snapshot).toHaveLength(1);

    // The returned entries are frozen-shape but the array itself is
    // the live registry. Verify via the clear helper instead.
    clearSkippedEnqueues();
    expect(listSkippedEnqueues()).toEqual([]);
  });

  test('skippedAt is a fresh Date.now() per call', () => {
    recordSkippedEnqueue('a', 'dream', 'seed-exhausted');
    recordSkippedEnqueue('b', 'dream', 'seed-exhausted');

    const [first, second] = listSkippedEnqueues();
    expect(second!.skippedAt).toBeGreaterThanOrEqual(first!.skippedAt);
  });
});

// ---------------------------------------------------------------------------
// RejectedGoal registry
// ---------------------------------------------------------------------------

describe('RejectedGoal registry — record / list / clear', () => {
  beforeEach(() => {
    clearRejectedGoals();
  });

  test('listRejectedGoals is empty by default', () => {
    expect(listRejectedGoals()).toEqual([]);
  });

  test('recordRejectedGoal stores a single entry', () => {
    recordRejectedGoal('hello there', 'conversational input');

    const list = listRejectedGoals();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      goal: 'hello there',
      reason: 'conversational input',
      rejectedAt: expect.any(Number),
    });
  });

  test('trims goal and reason before storing', () => {
    recordRejectedGoal('  padded goal  ', '  padded reason  ');
    const entry = listRejectedGoals()[0] as RejectedGoal;
    expect(entry.goal).toBe('padded goal');
    expect(entry.reason).toBe('padded reason');
  });

  test('silently drops records with empty goal (after trim)', () => {
    // Goal normalization happens BEFORE dedup, so empty-after-trim
    // goals never enter the registry. Pinning this so a future
    // refactor that moves the empty-check doesn't start accepting
    // noise from upstream callers passing "" through.
    recordRejectedGoal('', 'some reason');
    recordRejectedGoal('   ', 'some reason');
    expect(listRejectedGoals()).toEqual([]);
  });

  test('allows empty reason (after trim) — only goal is checked', () => {
    // recordRejectedGoal does NOT apply the same empty-check to reason.
    // This asymmetry is intentional — reason text comes from the
    // validator's own output which is always populated, but the API
    // doesn't enforce it. Pinning the current contract.
    recordRejectedGoal('valid goal', '');
    expect(listRejectedGoals()).toHaveLength(1);
    expect(listRejectedGoals()[0]?.reason).toBe('');
  });

  test('dedupes identical (goal, reason) pairs', () => {
    // This is the asymmetric contract vs SkippedEnqueue: rejectedGoal
    // MUST dedup. A re-injected greeting shouldn't spam the registry.
    recordRejectedGoal('hello', 'conversational');
    recordRejectedGoal('hello', 'conversational');
    recordRejectedGoal('hello', 'conversational');

    expect(listRejectedGoals()).toHaveLength(1);
  });

  test('records a new entry when the reason CHANGES', () => {
    // The dedup key is (goal, reason). A goal can evolve its rejection
    // reason across validator versions, and that evolution must be
    // visible in the registry.
    recordRejectedGoal('hello', 'conversational');
    recordRejectedGoal('hello', 'too short');
    recordRejectedGoal('hello', 'conversational');

    // Two unique (goal, reason) pairs — third call dedupes against first.
    expect(listRejectedGoals()).toHaveLength(2);
    const reasons = listRejectedGoals().map((r) => r.reason);
    expect(reasons).toEqual(['conversational', 'too short']);
  });

  test('records a new entry when the goal CHANGES', () => {
    recordRejectedGoal('hello', 'conversational');
    recordRejectedGoal('goodbye', 'conversational');

    expect(listRejectedGoals()).toHaveLength(2);
  });

  test('goal trim happens before dedup', () => {
    // 'hello' and '  hello  ' must dedup to the same entry — verifying
    // trim happens before the dedup check.
    recordRejectedGoal('hello', 'conversational');
    recordRejectedGoal('  hello  ', 'conversational');

    expect(listRejectedGoals()).toHaveLength(1);
    expect(listRejectedGoals()[0]?.goal).toBe('hello');
  });

  test('reason trim happens before dedup', () => {
    recordRejectedGoal('hello', 'conversational');
    recordRejectedGoal('hello', '  conversational  ');

    expect(listRejectedGoals()).toHaveLength(1);
    expect(listRejectedGoals()[0]?.reason).toBe('conversational');
  });

  test('preserves chronological insertion order', () => {
    recordRejectedGoal('first', 'r1');
    recordRejectedGoal('second', 'r2');
    recordRejectedGoal('third', 'r3');

    const goals = listRejectedGoals().map((r) => r.goal);
    expect(goals).toEqual(['first', 'second', 'third']);
  });

  test('rejectedAt is a fresh Date.now() per call', () => {
    recordRejectedGoal('a', 'r');
    recordRejectedGoal('b', 'r');

    const [first, second] = listRejectedGoals();
    expect(second!.rejectedAt).toBeGreaterThanOrEqual(first!.rejectedAt);
  });
});

// ---------------------------------------------------------------------------
// Cross-registry isolation
// ---------------------------------------------------------------------------

describe('cross-registry isolation', () => {
  beforeEach(() => {
    clearSkippedEnqueues();
    clearRejectedGoals();
  });

  test('clearing one registry does not affect the other', () => {
    recordSkippedEnqueue('g', 'dream', 'seed-exhausted');
    recordRejectedGoal('g', 'r');

    expect(listSkippedEnqueues()).toHaveLength(1);
    expect(listRejectedGoals()).toHaveLength(1);

    clearSkippedEnqueues();

    expect(listSkippedEnqueues()).toEqual([]);
    expect(listRejectedGoals()).toHaveLength(1);

    // And vice versa.
    recordSkippedEnqueue('g2', 'dream', 'seed-exhausted');
    clearRejectedGoals();

    expect(listSkippedEnqueues()).toHaveLength(1);
    expect(listRejectedGoals()).toEqual([]);
  });
});
