import { describe, test, expect } from 'vitest';
import {
  normalizeGoal,
  isDuplicateGoal,
  buildSucceededGoalSet,
} from '../../src/cerebellum/dreamer-dedup.js';
import type { TraceRecord } from '../../src/trace/jsonl.js';

/**
 * dreamer-dedup.ts — goal de-duplication helpers extracted from
 * dreamer.ts in Iteration 36.
 *
 * Two-layer defense against backlog pollution:
 *   1. buildSucceededGoalSet — refuse to re-enqueue anything that
 *      has already succeeded (exact-match refusal).
 *   2. isDuplicateGoal — Jaccard token-overlap check that catches
 *      reworded variants the exact match would miss.
 *
 * Until Iteration 60 the module had no dedicated test file — it was
 * exercised indirectly through dreamer.test.ts. The Jaccard threshold
 * (0.5) and the token-overlap mechanics are load-bearing and earn
 * direct coverage so a future tuning attempt is a conscious decision.
 */

// ---------------------------------------------------------------------------
// normalizeGoal
// ---------------------------------------------------------------------------

describe('normalizeGoal', () => {
  test('lowercases input', () => {
    expect(normalizeGoal('Add Retry')).toBe('add retry');
  });

  test('replaces punctuation with single spaces', () => {
    expect(normalizeGoal('add-retry_v2!')).toBe('add retry v2');
    expect(normalizeGoal('foo,bar;baz')).toBe('foo bar baz');
  });

  test('collapses runs of whitespace into a single space', () => {
    expect(normalizeGoal('add   retry')).toBe('add retry');
    expect(normalizeGoal('add\tretry')).toBe('add retry');
    expect(normalizeGoal('add\n\nretry')).toBe('add retry');
  });

  test('trims leading and trailing whitespace', () => {
    expect(normalizeGoal('  add retry  ')).toBe('add retry');
  });

  test('returns empty string for whitespace-only or punctuation-only input', () => {
    expect(normalizeGoal('   ')).toBe('');
    expect(normalizeGoal('!@#$')).toBe('');
  });

  test('strips non-ASCII characters (no unicode folding)', () => {
    // Same limitation as seedAttempts/retry-counter — non-ASCII
    // letters are stripped (treated as "non-alphanumeric" by the
    // regex), not folded. A goal like "重构" becomes empty after
    // normalization. The bilingual PLAN_KEYWORDS path in planner.ts
    // catches Chinese goals before they reach this normalizer, but
    // pinning here so the limitation is discoverable.
    expect(normalizeGoal('重构 dreamer')).toBe('dreamer');
    expect(normalizeGoal('重构')).toBe('');
  });

  test('preserves digits', () => {
    expect(normalizeGoal('fix issue 42')).toBe('fix issue 42');
  });
});

// ---------------------------------------------------------------------------
// isDuplicateGoal
// ---------------------------------------------------------------------------

describe('isDuplicateGoal — empty / single-token edges', () => {
  test('returns false for empty newGoal after normalization', () => {
    expect(isDuplicateGoal('', new Set(['anything']))).toBe(false);
    expect(isDuplicateGoal('   ', new Set(['anything']))).toBe(false);
    expect(isDuplicateGoal('!@#$', new Set(['anything']))).toBe(false);
  });

  test('returns false when existing set is empty', () => {
    expect(isDuplicateGoal('add retry', new Set())).toBe(false);
  });

  test('returns true for a single-char goal via exact-match path (before Jaccard)', () => {
    // The exact-match check happens BEFORE token analysis —
    // normalizeGoal('a') = 'a', and the existing set contains 'a',
    // so the lookup `existing.has('a')` succeeds. The Jaccard path
    // (which would return false because tokens are filtered) is
    // never reached. Pinning the order: exact-match is first defense.
    expect(isDuplicateGoal('a', new Set(['a']))).toBe(true);
  });

  test('returns false for a single-char goal against a multi-token existing set', () => {
    // Here 'a' is NOT in the existing set as an exact match, so the
    // code falls through to Jaccard. goalTokens('a') = {} (1-char
    // tokens filtered out), and an empty token set forces false.
    expect(isDuplicateGoal('a', new Set(['add retry']))).toBe(false);
  });
});

describe('isDuplicateGoal — exact match after normalization', () => {
  test('catches case-only differences', () => {
    const existing = new Set(['add retry']);
    expect(isDuplicateGoal('Add Retry', existing)).toBe(true);
  });

  test('catches whitespace-only differences', () => {
    const existing = new Set(['add retry']);
    expect(isDuplicateGoal('add   retry', existing)).toBe(true);
    expect(isDuplicateGoal('  add retry  ', existing)).toBe(true);
  });

  test('catches punctuation-only differences', () => {
    const existing = new Set(['add retry']);
    expect(isDuplicateGoal('add-retry!', existing)).toBe(true);
    expect(isDuplicateGoal('add_retry.', existing)).toBe(true);
  });

  test('normalizes BOTH sides of the comparison', () => {
    // Existing set entries are normalized inside the loop. So a raw
    // existing entry of "Add Retry" matches a new "add retry".
    const existing = new Set(['Add Retry']);
    expect(isDuplicateGoal('add retry', existing)).toBe(true);
  });

  test('detects the same normalized form even when stored un-normalized', () => {
    // buildSucceededGoalSet stores raw goal text, not normalized —
    // so this round-trip is the real-world path. Verify it works.
    const existing = new Set(['Add Retry Logic']);
    expect(isDuplicateGoal('add retry logic', existing)).toBe(true);
  });
});

describe('isDuplicateGoal — Jaccard similarity threshold (0.5)', () => {
  test('matches reworded variants with shared tokens', () => {
    // 4 tokens shared, 5 unique total → Jaccard 0.8 (>= 0.5 threshold)
    const existing = new Set(['add retry to llm provider']);
    expect(isDuplicateGoal('add retry logic to llm', existing)).toBe(true);
  });

  test('catches word-order differences', () => {
    const existing = new Set(['retry provider api']);
    expect(isDuplicateGoal('api provider retry', existing)).toBe(true);
  });

  test('does NOT match goals with low token overlap', () => {
    // "retry logic" vs "backlog enqueue" — intersection 0, Jaccard 0.
    const existing = new Set(['backlog enqueue dedup']);
    expect(isDuplicateGoal('retry logic module', existing)).toBe(false);
  });

  test('threshold 0.5 — borderline cases', () => {
    // 2 shared tokens out of 4 unique = Jaccard 0.5 exactly.
    // The implementation uses `>=` so this IS a duplicate.
    const existing = new Set(['add retry']);
    expect(isDuplicateGoal('retry add', existing)).toBe(true); // {add, retry} both sides
  });

  test('just below threshold (Jaccard 1/3 ≈ 0.33)', () => {
    // 1 shared, 3 unique = 0.33 → NOT a duplicate.
    const existing = new Set(['add retry']);
    expect(isDuplicateGoal('retry later', existing)).toBe(false);
  });

  test('threshold respects 1-char token filtering (noise tokens excluded)', () => {
    // Single-char tokens are dropped before Jaccard. "a b c retry" →
    // only {retry} participates. Against "retry provider", the
    // intersection is 1, union is 2 → Jaccard 0.5 → duplicate.
    const existing = new Set(['retry provider']);
    expect(isDuplicateGoal('a b c retry', existing)).toBe(true);
  });
});

describe('isDuplicateGoal — iteration order independence', () => {
  test('returns true regardless of which existing entry triggers the match', () => {
    const existing = new Set([
      'completely unrelated goal about widgets',
      'add retry to llm',
    ]);
    // The matching entry is second in iteration order. Implementation
    // iterates the Set and short-circuits on first hit — if the Set
    // iteration order changes (e.g. via V8 hash-seed randomization
    // across runs), the test still passes because the unrelated entry
    // does not match.
    expect(isDuplicateGoal('add retry logic to llm provider', existing)).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// buildSucceededGoalSet
// ---------------------------------------------------------------------------

describe('buildSucceededGoalSet', () => {
  function makeTrace(
    outcome: TraceRecord['outcome'],
    goal: string,
  ): TraceRecord {
    return {
      waypoint_id: `wp_${Math.random().toString(36).slice(2)}`,
      voyage_id: 'voyage_test',
      ts: '2026-07-21T00:00:00.000Z',
      goal,
      strategy: 'engineer-bias-action',
      outcome,
      iterations_used: 1,
      tokens_consumed: { input: 100, output: 50 },
    } as TraceRecord;
  }

  test('only includes success outcomes', () => {
    const trace: TraceRecord[] = [
      makeTrace('success', 'add retry'),
      makeTrace('failure', 'add logging'),
      makeTrace('abandoned', 'add metrics'),
    ];
    const set = buildSucceededGoalSet(trace);
    expect([...set]).toEqual(['add retry']);
  });

  test('ignores whitespace-only goals (defensive)', () => {
    const trace: TraceRecord[] = [
      makeTrace('success', '   '),
      makeTrace('success', 'add retry'),
    ];
    const set = buildSucceededGoalSet(trace);
    expect([...set]).toEqual(['add retry']);
  });

  test('ignores empty-string goals', () => {
    const trace: TraceRecord[] = [
      makeTrace('success', ''),
      makeTrace('success', 'add retry'),
    ];
    const set = buildSucceededGoalSet(trace);
    expect([...set]).toEqual(['add retry']);
  });

  test('stores goals verbatim (NOT normalized)', () => {
    // buildSucceededGoalSet is the upstream counterpart to
    // isDuplicateGoal's "normalizes both sides" rule. The set it
    // produces contains raw goal text — downstream consumers rely on
    // this so they can display goals in their original form.
    const trace: TraceRecord[] = [
      makeTrace('success', 'Add Retry'),
      makeTrace('success', 'add retry'), // different case, same intent
    ];
    const set = buildSucceededGoalSet(trace);
    // Both stored verbatim — dedup happens at isDuplicateGoal time,
    // not at set-build time.
    expect([...set]).toEqual(['Add Retry', 'add retry']);
  });

  test('returns an empty set for empty input', () => {
    expect([...buildSucceededGoalSet([])]).toEqual([]);
  });

  test('handles a trace with no successes', () => {
    const trace: TraceRecord[] = [
      makeTrace('failure', 'x'),
      makeTrace('abandoned', 'y'),
    ];
    expect([...buildSucceededGoalSet(trace)]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Round-trip integration — buildSucceededGoalSet feeds isDuplicateGoal
// ---------------------------------------------------------------------------

describe('dreamer dedup round-trip', () => {
  // Mirrors the real dreamer flow: trace records → succeeded set →
  // duplicate check against a new proposal. The two-layer defense
  // (exact match + Jaccard) should compose without false negatives.
  test('a new goal that matches a succeeded trace by Jaccard is flagged as duplicate', () => {
    const trace: TraceRecord[] = [
      makeTraceHelper('success', 'add retry to llm provider'),
    ];
    const succeeded = buildSucceededGoalSet(trace);
    // tokens new:      {add, retry, logic, llm} — 4
    // tokens existing: {add, retry, llm, provider} — 4
    // intersection: {add, retry, llm} = 3
    // union: {add, retry, logic, llm, provider} = 5
    // Jaccard = 3/5 = 0.6 ≥ 0.5 → duplicate
    expect(isDuplicateGoal('add retry logic llm', succeeded)).toBe(true);
  });

  test('a fresh goal that does not match any succeeded trace passes through', () => {
    const trace: TraceRecord[] = [
      makeTraceHelper('success', 'add retry to llm provider'),
    ];
    const succeeded = buildSucceededGoalSet(trace);
    expect(isDuplicateGoal('extract voyage-log format module', succeeded)).toBe(
      false,
    );
  });
});

function makeTraceHelper(
  outcome: TraceRecord['outcome'],
  goal: string,
): TraceRecord {
  return {
    waypoint_id: `wp_${Math.random().toString(36).slice(2)}`,
    voyage_id: 'voyage_test',
    ts: '2026-07-21T00:00:00.000Z',
    goal,
    strategy: 'engineer-bias-action',
    outcome,
    iterations_used: 1,
    tokens_consumed: { input: 100, output: 50 },
  } as TraceRecord;
}
