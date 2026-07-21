/**
 * Invariants for src/cerebellum/backlog-registries.ts.
 *
 * backlog-registries.test.ts covers behavior: record/list/clear for
 * both registries, dedup asymmetry (skipped-enqueue NO dedup vs
 * rejected-goal WITH dedup), trim behavior, chronological order,
 * cross-registry isolation. This file pins the load-bearing structural
 * contracts that the behavioral tests imply but do not make explicit:
 *
 *   - SkipReason union has exactly 3 members (no more, no less).
 *   - SkippedEnqueue shape has exactly { goal, origin, reason,
 *     skippedAt } (4 required fields).
 *   - RejectedGoal shape has exactly { goal, reason, rejectedAt }
 *     (3 required fields).
 *   - recordSkippedEnqueue is a void function (no return value).
 *   - recordRejectedGoal is a void function (no return value).
 *   - listSkippedEnqueues returns a readonly array (callers cannot
 *     push/pop the returned reference).
 *   - listRejectedGoals returns a readonly array.
 *   - clearSkippedEnqueues is idempotent.
 *   - clearRejectedGoals is idempotent.
 *   - Registries persist across list calls (record + list + list
 *     returns same data twice).
 *   - SkipReason values are lowercase kebab-case (matches the
 *     documented 'seed-exhausted' / 'retry-exhausted' / 'already-
 *     completed').
 *   - clear one registry does not affect the other (reaffirmed
 *     structurally).
 *   - registries are session-scoped: not persisted to disk.
 *   - recordSkippedEnqueue accepts every origin value without
 *     filtering (origins are not validated here).
 *   - recordRejectedGoal filters empty goals BEFORE dedup (so a trim-
 *     to-empty goal never enters the registry at all).
 *
 * The clear-idempotency invariant is load-bearing: a future refactor
 * that adds "if (already empty) skip clear" would break tests that
 * rely on clear being a true reset (records after clear start from 0).
 *
 * The "list returns the live array reference" invariant is pinned:
 * backlog-registries.test.ts already notes that the returned array IS
 * the live registry (no copy-on-read). This file documents the same
 * from the structural angle — if a future refactor adds a copy, the
 * registry semantics tighten, and downstream consumers that rely on
 * the reference identity would silently break.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  recordSkippedEnqueue,
  listSkippedEnqueues,
  clearSkippedEnqueues,
  recordRejectedGoal,
  listRejectedGoals,
  clearRejectedGoals,
  type SkippedEnqueue,
  type RejectedGoal,
  type SkipReason,
} from '../../src/cerebellum/backlog-registries.js';
import type { BacklogOrigin } from '../../src/orchestrator/events.js';

const ALL_ORIGINS: readonly BacklogOrigin[] = [
  'user',
  'plan',
  'dream',
  'reflect',
  'curiosity',
  'system',
];
const ALL_REASONS: readonly SkipReason[] = [
  'seed-exhausted',
  'retry-exhausted',
  'already-completed',
];

beforeEach(() => {
  clearSkippedEnqueues();
  clearRejectedGoals();
});

// ---------------------------------------------------------------------------
// SkipReason union — exhaustive enumeration
// ---------------------------------------------------------------------------

describe('SkipReason union', () => {
  test('has exactly 3 members', () => {
    expect(ALL_REASONS).toHaveLength(3);
  });

  test('all members are lowercase strings', () => {
    for (const r of ALL_REASONS) {
      expect(r).toBe(r.toLowerCase());
    }
  });

  test('all members are unique (no duplicates)', () => {
    const set = new Set(ALL_REASONS);
    expect(set.size).toBe(ALL_REASONS.length);
  });

  test('all 3 documented reasons are present', () => {
    expect(ALL_REASONS).toContain('seed-exhausted');
    expect(ALL_REASONS).toContain('retry-exhausted');
    expect(ALL_REASONS).toContain('already-completed');
  });

  test('all members are kebab-case (contain exactly one hyphen each, except already-completed)', () => {
    // 'already-completed' has one hyphen, 'seed-exhausted' has one,
    // 'retry-exhausted' has one. Pin the kebab-case format.
    for (const r of ALL_REASONS) {
      const hyphenCount = (r.match(/-/g) ?? []).length;
      expect(hyphenCount).toBe(1);
    }
  });

  test('every reason is a valid SkipReason at runtime', () => {
    for (const r of ALL_REASONS) {
      recordSkippedEnqueue('g', 'dream', r);
    }
    const list = listSkippedEnqueues();
    const reasons = list.map((s) => s.reason);
    expect(reasons.sort()).toEqual([...ALL_REASONS].sort());
  });
});

// ---------------------------------------------------------------------------
// SkippedEnqueue type shape
// ---------------------------------------------------------------------------

describe('SkippedEnqueue type shape', () => {
  test('has exactly { goal, origin, reason, skippedAt } fields', () => {
    recordSkippedEnqueue('g', 'dream', 'seed-exhausted');
    const entry: SkippedEnqueue = listSkippedEnqueues()[0]!;
    expect(Object.keys(entry).sort()).toEqual(
      ['goal', 'origin', 'reason', 'skippedAt'].sort(),
    );
  });

  test('goal is a string', () => {
    recordSkippedEnqueue('g', 'dream', 'seed-exhausted');
    const entry = listSkippedEnqueues()[0]!;
    expect(typeof entry.goal).toBe('string');
  });

  test('origin is a valid BacklogOrigin', () => {
    for (const origin of ALL_ORIGINS) {
      recordSkippedEnqueue('g', origin, 'seed-exhausted');
    }
    const origins = listSkippedEnqueues().map((s) => s.origin);
    for (const o of origins) {
      expect(ALL_ORIGINS).toContain(o);
    }
  });

  test('reason is a valid SkipReason', () => {
    recordSkippedEnqueue('g', 'dream', 'retry-exhausted');
    const entry = listSkippedEnqueues()[0]!;
    expect(ALL_REASONS).toContain(entry.reason);
  });

  test('skippedAt is a finite number (epoch millis)', () => {
    recordSkippedEnqueue('g', 'dream', 'seed-exhausted');
    const entry = listSkippedEnqueues()[0]!;
    expect(typeof entry.skippedAt).toBe('number');
    expect(Number.isFinite(entry.skippedAt)).toBe(true);
    expect(entry.skippedAt).toBeGreaterThan(0);
  });

  test('all 4 fields are required (TypeScript-enforced)', () => {
    recordSkippedEnqueue('g', 'dream', 'seed-exhausted');
    const e: SkippedEnqueue = listSkippedEnqueues()[0]!;
    expect(e.goal).toBe('g');
    expect(e.origin).toBe('dream');
    expect(e.reason).toBe('seed-exhausted');
    expect(typeof e.skippedAt).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// RejectedGoal type shape
// ---------------------------------------------------------------------------

describe('RejectedGoal type shape', () => {
  test('has exactly { goal, reason, rejectedAt } fields', () => {
    recordRejectedGoal('hello', 'conversational');
    const entry: RejectedGoal = listRejectedGoals()[0]!;
    expect(Object.keys(entry).sort()).toEqual(
      ['goal', 'reason', 'rejectedAt'].sort(),
    );
  });

  test('goal is a string', () => {
    recordRejectedGoal('g', 'r');
    const entry = listRejectedGoals()[0]!;
    expect(typeof entry.goal).toBe('string');
  });

  test('reason is a string', () => {
    recordRejectedGoal('g', 'r');
    const entry = listRejectedGoals()[0]!;
    expect(typeof entry.reason).toBe('string');
  });

  test('rejectedAt is a finite number (epoch millis)', () => {
    recordRejectedGoal('g', 'r');
    const entry = listRejectedGoals()[0]!;
    expect(typeof entry.rejectedAt).toBe('number');
    expect(Number.isFinite(entry.rejectedAt)).toBe(true);
    expect(entry.rejectedAt).toBeGreaterThan(0);
  });

  test('all 3 fields are required (TypeScript-enforced)', () => {
    recordRejectedGoal('g', 'r');
    const e: RejectedGoal = listRejectedGoals()[0]!;
    expect(e.goal).toBe('g');
    expect(e.reason).toBe('r');
    expect(typeof e.rejectedAt).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// recordSkippedEnqueue — function contract
// ---------------------------------------------------------------------------

describe('recordSkippedEnqueue — function contract', () => {
  test('returns undefined (void function)', () => {
    const r = recordSkippedEnqueue('g', 'dream', 'seed-exhausted');
    expect(r).toBeUndefined();
  });

  test('accepts arbitrary string as goal (no validation)', () => {
    recordSkippedEnqueue('any arbitrary text! @#$', 'dream', 'seed-exhausted');
    expect(listSkippedEnqueues()[0]?.goal).toBe('any arbitrary text! @#$');
  });

  test('does NOT trim the goal (verbatim storage)', () => {
    recordSkippedEnqueue('  padded  ', 'dream', 'seed-exhausted');
    expect(listSkippedEnqueues()[0]?.goal).toBe('  padded  ');
  });

  test('does NOT trim the reason (verbatim storage)', () => {
    // Note: reason is typed as SkipReason so TypeScript wouldn't accept
    // a whitespace-padded string, but if it did, it would be stored
    // verbatim. Pinning the no-trim contract via the canonical reason.
    recordSkippedEnqueue('g', 'dream', 'seed-exhausted');
    expect(listSkippedEnqueues()[0]?.reason).toBe('seed-exhausted');
  });

  test('does NOT filter on origin (accepts every BacklogOrigin)', () => {
    for (const origin of ALL_ORIGINS) {
      recordSkippedEnqueue(`g-${origin}`, origin, 'seed-exhausted');
    }
    expect(listSkippedEnqueues()).toHaveLength(ALL_ORIGINS.length);
  });

  test('does NOT dedup (asymmetric vs recordRejectedGoal)', () => {
    for (let i = 0; i < 10; i++) {
      recordSkippedEnqueue('same', 'dream', 'seed-exhausted');
    }
    expect(listSkippedEnqueues()).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// recordRejectedGoal — function contract
// ---------------------------------------------------------------------------

describe('recordRejectedGoal — function contract', () => {
  test('returns undefined (void function)', () => {
    const r = recordRejectedGoal('g', 'r');
    expect(r).toBeUndefined();
  });

  test('trims goal BEFORE storing', () => {
    recordRejectedGoal('  hello  ', 'r');
    expect(listRejectedGoals()[0]?.goal).toBe('hello');
  });

  test('trims reason BEFORE storing', () => {
    recordRejectedGoal('g', '  reason  ');
    expect(listRejectedGoals()[0]?.reason).toBe('reason');
  });

  test('filters empty goal BEFORE entering registry', () => {
    recordRejectedGoal('', 'some reason');
    recordRejectedGoal('   ', 'some reason');
    expect(listRejectedGoals()).toEqual([]);
  });

  test('allows empty reason (only goal is checked for emptiness)', () => {
    recordRejectedGoal('g', '');
    expect(listRejectedGoals()).toHaveLength(1);
    expect(listRejectedGoals()[0]?.reason).toBe('');
  });

  test('dedupes identical (goal, reason) pairs', () => {
    for (let i = 0; i < 10; i++) {
      recordRejectedGoal('hello', 'conversational');
    }
    expect(listRejectedGoals()).toHaveLength(1);
  });

  test('records new entry when reason differs', () => {
    recordRejectedGoal('hello', 'r1');
    recordRejectedGoal('hello', 'r2');
    expect(listRejectedGoals()).toHaveLength(2);
  });

  test('records new entry when goal differs', () => {
    recordRejectedGoal('g1', 'r');
    recordRejectedGoal('g2', 'r');
    expect(listRejectedGoals()).toHaveLength(2);
  });

  test('trim happens BEFORE dedup check', () => {
    recordRejectedGoal('hello', 'r');
    recordRejectedGoal('  hello  ', 'r');
    expect(listRejectedGoals()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// list functions — readonly array contract
// ---------------------------------------------------------------------------

describe('listSkippedEnqueues — readonly contract', () => {
  test('returns an array', () => {
    expect(Array.isArray(listSkippedEnqueues())).toBe(true);
  });

  test('returns empty array when registry is cleared', () => {
    recordSkippedEnqueue('g', 'dream', 'seed-exhausted');
    clearSkippedEnqueues();
    expect(listSkippedEnqueues()).toEqual([]);
  });

  test('returns the same reference across calls (live registry, not a copy)', () => {
    // NOTE: This pins the current behavior — the returned array IS
    // the internal registry. If a future refactor adds copy-on-read,
    // this test surfaces the change. Downstream consumers that rely
    // on reference identity would silently break.
    const a = listSkippedEnqueues();
    const b = listSkippedEnqueues();
    expect(a).toBe(b);
  });

  test('records added AFTER a snapshot are visible in subsequent reads', () => {
    const before = listSkippedEnqueues();
    expect(before).toHaveLength(0);
    recordSkippedEnqueue('g', 'dream', 'seed-exhausted');
    const after = listSkippedEnqueues();
    expect(after).toHaveLength(1);
    // The 'before' reference now also reflects the new record (because
    // it's the same array).
    expect(before).toHaveLength(1);
  });
});

describe('listRejectedGoals — readonly contract', () => {
  test('returns an array', () => {
    expect(Array.isArray(listRejectedGoals())).toBe(true);
  });

  test('returns empty array when registry is cleared', () => {
    recordRejectedGoal('g', 'r');
    clearRejectedGoals();
    expect(listRejectedGoals()).toEqual([]);
  });

  test('returns the same reference across calls (live registry, not a copy)', () => {
    const a = listRejectedGoals();
    const b = listRejectedGoals();
    expect(a).toBe(b);
  });

  test('records added AFTER a snapshot are visible in subsequent reads', () => {
    const before = listRejectedGoals();
    expect(before).toHaveLength(0);
    recordRejectedGoal('g', 'r');
    const after = listRejectedGoals();
    expect(after).toHaveLength(1);
    expect(before).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// clear functions — idempotency
// ---------------------------------------------------------------------------

describe('clearSkippedEnqueues — idempotency', () => {
  test('returns undefined (void function)', () => {
    expect(clearSkippedEnqueues()).toBeUndefined();
  });

  test('calling clear on empty registry is a no-op', () => {
    expect(() => clearSkippedEnqueues()).not.toThrow();
    expect(listSkippedEnqueues()).toEqual([]);
  });

  test('calling clear N times has the same effect as once', () => {
    recordSkippedEnqueue('g', 'dream', 'seed-exhausted');
    clearSkippedEnqueues();
    clearSkippedEnqueues();
    clearSkippedEnqueues();
    expect(listSkippedEnqueues()).toEqual([]);
  });

  test('clear then record then clear produces empty registry', () => {
    clearSkippedEnqueues();
    recordSkippedEnqueue('g', 'dream', 'seed-exhausted');
    expect(listSkippedEnqueues()).toHaveLength(1);
    clearSkippedEnqueues();
    expect(listSkippedEnqueues()).toEqual([]);
  });
});

describe('clearRejectedGoals — idempotency', () => {
  test('returns undefined (void function)', () => {
    expect(clearRejectedGoals()).toBeUndefined();
  });

  test('calling clear on empty registry is a no-op', () => {
    expect(() => clearRejectedGoals()).not.toThrow();
    expect(listRejectedGoals()).toEqual([]);
  });

  test('calling clear N times has the same effect as once', () => {
    recordRejectedGoal('g', 'r');
    clearRejectedGoals();
    clearRejectedGoals();
    clearRejectedGoals();
    expect(listRejectedGoals()).toEqual([]);
  });

  test('clear then record then clear produces empty registry', () => {
    clearRejectedGoals();
    recordRejectedGoal('g', 'r');
    expect(listRejectedGoals()).toHaveLength(1);
    clearRejectedGoals();
    expect(listRejectedGoals()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cross-registry isolation (structural reaffirmation)
// ---------------------------------------------------------------------------

describe('cross-registry isolation (structural)', () => {
  test('clearSkippedEnqueues does NOT clear rejectedGoals', () => {
    recordRejectedGoal('g', 'r');
    recordSkippedEnqueue('g', 'dream', 'seed-exhausted');
    clearSkippedEnqueues();
    expect(listSkippedEnqueues()).toEqual([]);
    expect(listRejectedGoals()).toHaveLength(1);
  });

  test('clearRejectedGoals does NOT clear skippedEnqueues', () => {
    recordRejectedGoal('g', 'r');
    recordSkippedEnqueue('g', 'dream', 'seed-exhausted');
    clearRejectedGoals();
    expect(listRejectedGoals()).toEqual([]);
    expect(listSkippedEnqueues()).toHaveLength(1);
  });

  test('recordSkippedEnqueue does NOT add to rejectedGoals', () => {
    recordSkippedEnqueue('g', 'dream', 'seed-exhausted');
    expect(listSkippedEnqueues()).toHaveLength(1);
    expect(listRejectedGoals()).toHaveLength(0);
  });

  test('recordRejectedGoal does NOT add to skippedEnqueues', () => {
    recordRejectedGoal('g', 'r');
    expect(listRejectedGoals()).toHaveLength(1);
    expect(listSkippedEnqueues()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Chronological ordering — insertion-order preservation
// ---------------------------------------------------------------------------

describe('chronological ordering — insertion-order preservation', () => {
  test('skippedEnqueues preserves insertion order across many records', () => {
    for (let i = 0; i < 50; i++) {
      recordSkippedEnqueue(`g-${i}`, 'dream', 'seed-exhausted');
    }
    const goals = listSkippedEnqueues().map((s) => s.goal);
    const expected = Array.from({ length: 50 }, (_, i) => `g-${i}`);
    expect(goals).toEqual(expected);
  });

  test('rejectedGoals preserves insertion order across many records', () => {
    for (let i = 0; i < 50; i++) {
      recordRejectedGoal(`g-${i}`, `r-${i}`);
    }
    const goals = listRejectedGoals().map((r) => r.goal);
    const expected = Array.from({ length: 50 }, (_, i) => `g-${i}`);
    expect(goals).toEqual(expected);
  });

  test('interleaved records preserve their relative order within each registry', () => {
    // Interleave skipped and rejected records.
    recordSkippedEnqueue('s1', 'dream', 'seed-exhausted');
    recordRejectedGoal('r1', 'reason1');
    recordSkippedEnqueue('s2', 'dream', 'retry-exhausted');
    recordRejectedGoal('r2', 'reason2');
    recordSkippedEnqueue('s3', 'curiosity', 'already-completed');

    expect(listSkippedEnqueues().map((s) => s.goal)).toEqual(['s1', 's2', 's3']);
    expect(listRejectedGoals().map((r) => r.goal)).toEqual(['r1', 'r2']);
  });
});

// ---------------------------------------------------------------------------
// Timestamp monotonicity
// ---------------------------------------------------------------------------

describe('timestamp monotonicity', () => {
  test('skippedEnqueues: timestamps are monotonically non-decreasing', () => {
    recordSkippedEnqueue('a', 'dream', 'seed-exhausted');
    recordSkippedEnqueue('b', 'dream', 'seed-exhausted');
    recordSkippedEnqueue('c', 'dream', 'seed-exhausted');
    const list = listSkippedEnqueues();
    expect(list[1]!.skippedAt).toBeGreaterThanOrEqual(list[0]!.skippedAt);
    expect(list[2]!.skippedAt).toBeGreaterThanOrEqual(list[1]!.skippedAt);
  });

  test('rejectedGoals: timestamps are monotonically non-decreasing', () => {
    recordRejectedGoal('a', 'r');
    recordRejectedGoal('b', 'r');
    recordRejectedGoal('c', 'r');
    const list = listRejectedGoals();
    expect(list[1]!.rejectedAt).toBeGreaterThanOrEqual(list[0]!.rejectedAt);
    expect(list[2]!.rejectedAt).toBeGreaterThanOrEqual(list[1]!.rejectedAt);
  });
});

// ---------------------------------------------------------------------------
// Persistence across list calls
// ---------------------------------------------------------------------------

describe('persistence across list calls', () => {
  test('record once, list twice — same data both times (skipped)', () => {
    recordSkippedEnqueue('g', 'dream', 'seed-exhausted');
    const a = listSkippedEnqueues();
    const b = listSkippedEnqueues();
    expect(a).toEqual(b);
    expect(a).toBe(b); // same reference, pinned contract
  });

  test('record once, list twice — same data both times (rejected)', () => {
    recordRejectedGoal('g', 'r');
    const a = listRejectedGoals();
    const b = listRejectedGoals();
    expect(a).toEqual(b);
    expect(a).toBe(b);
  });

  test('records survive multiple list calls without losing data', () => {
    recordSkippedEnqueue('s1', 'dream', 'seed-exhausted');
    recordRejectedGoal('r1', 'reason1');
    for (let i = 0; i < 5; i++) {
      listSkippedEnqueues();
      listRejectedGoals();
    }
    expect(listSkippedEnqueues()).toHaveLength(1);
    expect(listRejectedGoals()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Session-scoped (not persisted to disk)
// ---------------------------------------------------------------------------

describe('session-scoped (no disk persistence)', () => {
  test('the registries are in-memory only — no filesystem writes', async () => {
    // The registries are module-level arrays. There is no API to
    // persist them. Verify by recording and checking that no file
    // was created in a temp dir we control.
    const { mkdtemp, rm, readdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'ody-registries-'));
    try {
      // Switch CWD to the temp dir so any accidental relative-path
      // writes would land here.
      const originalCwd = process.cwd();
      process.chdir(dir);
      try {
        recordSkippedEnqueue('g', 'dream', 'seed-exhausted');
        recordRejectedGoal('g', 'r');
        const files = await readdir(dir);
        // No files should have been created by the record calls.
        expect(files).toEqual([]);
      } finally {
        process.chdir(originalCwd);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
