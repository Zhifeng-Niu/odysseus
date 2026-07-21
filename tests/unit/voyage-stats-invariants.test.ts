import { describe, test, expect } from 'vitest';
import {
  computeVoyageStats,
  computeIncrementalTokens,
  countOutcomes,
  normalizeReason,
  type VoyageStats,
  type VoyageStatsSlice,
  type OutcomeCounts,
  type TokenTotals,
  type ReasonCount,
  type TrendComparison,
} from '../../src/cerebellum/voyage-stats.js';
import type { TraceRecord } from '../../src/trace/jsonl.js';

/**
 * voyage-stats — STRUCTURAL INVARIANTS for the trace-rollup layer.
 *
 * cerebellum-voyage-stats.test.ts covers the happy-path aggregation
 * behavior. This file pins the load-bearing contracts that, if silently
 * regressed, would either mis-report observability numbers (success rate,
 * token cost) or change the shape of the VoyageStats object that the CLI
 * and future tools consume.
 *
 * Contracts pinned here:
 *
 *   - TOP_REASONS_LIMIT === 5. The aggregation slice cap. Changing this
 *     silently widens or narrows every "top reasons" report.
 *
 *   - normalizeReason DELIMITER PRIORITY: `:` > `—` > `(`. First hit wins.
 *     If a reason contains all three, the colon-prefix is returned. Empty
 *     or whitespace-only input returns the literal `(none)` (with parens).
 *
 *   - normalizeReason TRUNCATION: when no delimiter matches and trimmed
 *     length > 60, the result is `first60chars.trim() + '…'` (literal
 *     ellipsis). Exactly 60 chars → no truncation (boundary inclusive).
 *
 *   - countOutcomes IGNORES unknown outcomes. Only 'success', 'failure',
 *     'abandoned' are counted; anything else (or missing outcome field)
 *     contributes to none of the three counts.
 *
 *   - computeIncrementalTokens — voyage_id grouping. `undefined` voyage_id
 *     → standalone (cumulative IS the incremental). Subsequent records
 *     with the SAME voyage_id delta from the previous. Negative deltas
 *     clamp to 0 via Math.max.
 *
 *   - computeVoyageStats — TREND threshold is `total >= 4`. Below 4 →
 *     trend is null. Half-split is `floor(total / 2)` — odd totals put
 *     the extra record in the SECOND half (slice(half) is larger).
 *
 *   - computeVoyageStats — EMPTY records produces deterministic zeros:
 *     totalWaypoints=0, successRate=0, all token fields=0, topReasons=[],
 *     trend=null. NOT null/undefined — the zero-state is observable.
 *
 *   - Rates are FRACTIONS in [0, 1] (not percentages). successRate =
 *     successes/total. Multiplied by 100 only at the formatting layer.
 *
 *   - Sort order for topReasons: DESCENDING by count. Ties are not
 *     guaranteed to be in any particular order (Map iteration order).
 *
 *   - All exported shapes use readonly fields and readonly arrays —
 *     immutability is part of the contract.
 *
 *   - Pure functions: input arrays/records are not mutated.
 *
 * Each test below pins one slice of these contracts.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<TraceRecord> = {}): TraceRecord {
  return {
    ts: '2026-07-21T00:00:00Z',
    waypoint_id: 'wp_test',
    goal: 'test goal',
    strategy: 'engineer',
    parent: null,
    outcome: 'success',
    checkpoint_sha: null,
    iterations_used: 1,
    tokens_consumed: { input: 1000, output: 100 },
    verify_result: {},
    fail_reason: null,
    diff_summary: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TOP_REASONS_LIMIT — the slice cap (currently 5)
// ---------------------------------------------------------------------------

describe('TOP_REASONS_LIMIT — aggregation cap is 5', () => {
  test('topFailReasons never exceeds 5 entries', () => {
    const records: TraceRecord[] = [];
    for (let i = 0; i < 10; i++) {
      records.push(
        makeRecord({
          waypoint_id: `wp_${i}`,
          outcome: 'failure',
          fail_reason: `reason-${i}`,
        }),
      );
    }
    const stats = computeVoyageStats(records);
    expect(stats.topFailReasons.length).toBeLessThanOrEqual(5);
  });

  test('topFailReasons with exactly 5 distinct reasons returns all 5', () => {
    const records: TraceRecord[] = [];
    for (let i = 0; i < 5; i++) {
      records.push(
        makeRecord({
          waypoint_id: `wp_${i}`,
          outcome: 'failure',
          fail_reason: `reason-${i}`,
        }),
      );
    }
    const stats = computeVoyageStats(records);
    expect(stats.topFailReasons.length).toBe(5);
  });

  test('topFailReasons with 6+ distinct reasons returns exactly 5', () => {
    const records: TraceRecord[] = [];
    for (let i = 0; i < 8; i++) {
      records.push(
        makeRecord({
          waypoint_id: `wp_${i}`,
          outcome: 'failure',
          fail_reason: `reason-${i}`,
        }),
      );
    }
    const stats = computeVoyageStats(records);
    expect(stats.topFailReasons.length).toBe(5);
  });

  test('topAbandonedReasons never exceeds 5 entries', () => {
    const records: TraceRecord[] = [];
    for (let i = 0; i < 7; i++) {
      records.push(
        makeRecord({
          waypoint_id: `wp_${i}`,
          outcome: 'abandoned',
          fail_reason: `abandon-${i}`,
        }),
      );
    }
    const stats = computeVoyageStats(records);
    expect(stats.topAbandonedReasons.length).toBeLessThanOrEqual(5);
  });

  test('topFailReasons sorts descending by count', () => {
    const records: TraceRecord[] = [
      makeRecord({ waypoint_id: 'wp_a', outcome: 'failure', fail_reason: 'rare' }),
      makeRecord({ waypoint_id: 'wp_b', outcome: 'failure', fail_reason: 'common' }),
      makeRecord({ waypoint_id: 'wp_c', outcome: 'failure', fail_reason: 'common' }),
      makeRecord({ waypoint_id: 'wp_d', outcome: 'failure', fail_reason: 'common' }),
      makeRecord({ waypoint_id: 'wp_e', outcome: 'failure', fail_reason: 'medium' }),
      makeRecord({ waypoint_id: 'wp_f', outcome: 'failure', fail_reason: 'medium' }),
    ];
    const stats = computeVoyageStats(records);
    expect(stats.topFailReasons[0]?.reason).toBe('common');
    expect(stats.topFailReasons[0]?.count).toBe(3);
    expect(stats.topFailReasons[1]?.reason).toBe('medium');
    expect(stats.topFailReasons[1]?.count).toBe(2);
    expect(stats.topFailReasons[2]?.reason).toBe('rare');
    expect(stats.topFailReasons[2]?.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// normalizeReason — delimiter priority and fallback
// ---------------------------------------------------------------------------

describe('normalizeReason — delimiter priority', () => {
  test('colon (:) has highest priority', () => {
    // Reason has all 3 delimiters: `:`, `—`, `(`. Colon wins.
    const reason = 'error: something — went (wrong)';
    expect(normalizeReason(reason)).toBe('error');
  });

  test('em-dash (—) wins when no colon', () => {
    const reason = 'hit maxIterations — agent did not converge';
    expect(normalizeReason(reason)).toBe('hit maxIterations');
  });

  test('open-paren (`(`) wins when no colon and no em-dash', () => {
    const reason = 'threshold exceeded (5 retries)';
    expect(normalizeReason(reason)).toBe('threshold exceeded');
  });

  test('colon at position 0 is IGNORED (idx must be > 0)', () => {
    // `: foo` — colon at index 0. idx > 0 check fails, moves to next delim.
    // Falls through to em-dash check, then paren check, then 60-char rule.
    expect(normalizeReason(': no prefix')).toBe(': no prefix');
  });

  test('delimiter index must be strictly > 0 (not >= 0)', () => {
    // Same contract for em-dash and paren.
    expect(normalizeReason('— no prefix')).toBe('— no prefix');
    expect(normalizeReason('(no prefix)')).toBe('(no prefix)');
  });

  test('first occurrence of colon wins (not last)', () => {
    expect(normalizeReason('a: b: c')).toBe('a');
  });

  test('first occurrence of em-dash wins', () => {
    expect(normalizeReason('a — b — c')).toBe('a');
  });

  test('first occurrence of paren wins', () => {
    expect(normalizeReason('a (1) (2)')).toBe('a');
  });

  test('semicolon (;) is NOT a delimiter', () => {
    expect(normalizeReason('error; details')).toBe('error; details');
  });

  test('pipe (|) is NOT a delimiter', () => {
    expect(normalizeReason('error|details')).toBe('error|details');
  });

  test('regular dash (-) is NOT a delimiter (only em-dash —)', () => {
    // Critical: only the em-dash U+2014 triggers split, not ASCII hyphen.
    expect(normalizeReason('hit-max-retries')).toBe('hit-max-retries');
  });

  test('close-paren `)` is NOT a delimiter (only open-paren `(`)', () => {
    expect(normalizeReason('error) foo')).toBe('error) foo');
  });
});

// ---------------------------------------------------------------------------
// normalizeReason — empty / whitespace inputs
// ---------------------------------------------------------------------------

describe('normalizeReason — empty input returns `(none)`', () => {
  test('empty string → `(none)`', () => {
    expect(normalizeReason('')).toBe('(none)');
  });

  test('single space → `(none)`', () => {
    expect(normalizeReason(' ')).toBe('(none)');
  });

  test('multiple spaces → `(none)`', () => {
    expect(normalizeReason('   ')).toBe('(none)');
  });

  test('tab → `(none)`', () => {
    expect(normalizeReason('\t')).toBe('(none)');
  });

  test('newline → `(none)`', () => {
    expect(normalizeReason('\n')).toBe('(none)');
  });

  test('mixed whitespace → `(none)`', () => {
    expect(normalizeReason(' \t\n ')).toBe('(none)');
  });

  test('`(none)` is a literal string with parens (NOT the word none)', () => {
    // Distinguish from the bare word "none" — the parens make it visible
    // in reports that this was an absent reason, not a literal reason text.
    expect(normalizeReason('')).not.toBe('none');
    expect(normalizeReason('')).toBe('(none)');
  });

  test('whitespace surrounding content is stripped before delimiter check', () => {
    expect(normalizeReason('  error: details  ')).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// normalizeReason — 60-char truncation
// ---------------------------------------------------------------------------

describe('normalizeReason — 60-char truncation with ellipsis', () => {
  test('exactly 60 chars → NOT truncated (boundary inclusive)', () => {
    const exact60 = 'a'.repeat(60);
    expect(exact60.length).toBe(60);
    expect(normalizeReason(exact60)).toBe(exact60);
    expect(normalizeReason(exact60)).not.toContain('…');
  });

  test('61 chars → truncated to first 60 chars + `…`', () => {
    const input = 'a'.repeat(61);
    const result = normalizeReason(input);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBe(61); // 60 chars + ellipsis
    expect(result).toBe('a'.repeat(60) + '…');
  });

  test('100 chars → truncated to first 60 + `…`', () => {
    const input = 'b'.repeat(100);
    const result = normalizeReason(input);
    expect(result).toBe('b'.repeat(60) + '…');
  });

  test('truncation uses ELLIPSE character (U+2026), not three dots', () => {
    const result = normalizeReason('c'.repeat(100));
    expect(result.endsWith('…')).toBe(true);
    expect(result.endsWith('...')).toBe(false);
  });

  test('truncation happens AFTER trim', () => {
    // 62 chars including surrounding whitespace → trim first (58 chars)
    // → under the 60-char threshold → no truncation, no ellipsis.
    const padded = '  ' + 'd'.repeat(58) + '  ';
    expect(padded.trim().length).toBe(58);
    expect(normalizeReason(padded)).toBe('d'.repeat(58));
    expect(normalizeReason(padded)).not.toContain('…');
  });

  test('trim+truncate: 64 chars with 2-space padding either side → 60 + ellipsis', () => {
    // 60 'd's + 4 spaces = 64 chars. Trim → 60. NOT > 60 → no truncation.
    const at60 = '  ' + 'd'.repeat(60) + '  ';
    expect(at60.trim().length).toBe(60);
    expect(normalizeReason(at60)).toBe('d'.repeat(60));

    // 61 'd's + 4 spaces = 65 chars. Trim → 61. > 60 → truncate.
    const over60 = '  ' + 'd'.repeat(61) + '  ';
    expect(over60.trim().length).toBe(61);
    expect(normalizeReason(over60)).toBe('d'.repeat(60) + '…');
  });
});

// ---------------------------------------------------------------------------
// normalizeReason — delimiter beats truncation
// ---------------------------------------------------------------------------

describe('normalizeReason — delimiter check runs BEFORE 60-char rule', () => {
  test('long reason with early colon → colon prefix returned (no truncation)', () => {
    const longReason = 'error: ' + 'x'.repeat(100);
    expect(normalizeReason(longReason)).toBe('error');
  });

  test('long reason with early em-dash → em-dash prefix returned', () => {
    const longReason = 'warning — ' + 'x'.repeat(100);
    expect(normalizeReason(longReason)).toBe('warning');
  });

  test('long reason with early paren → paren prefix returned', () => {
    const longReason = 'threshold (max) ' + 'x'.repeat(100);
    expect(normalizeReason(longReason)).toBe('threshold');
  });

  test('long reason with NO delimiter → truncated to 60 + `…`', () => {
    const longReason = 'x'.repeat(100);
    expect(normalizeReason(longReason)).toBe('x'.repeat(60) + '…');
  });
});

// ---------------------------------------------------------------------------
// countOutcomes — only counts 3 outcome types
// ---------------------------------------------------------------------------

describe('countOutcomes — outcome enum is exactly {success, failure, abandoned}', () => {
  test('success-only records → success = N, failure = 0, abandoned = 0', () => {
    const records = [
      makeRecord({ outcome: 'success' }),
      makeRecord({ outcome: 'success' }),
      makeRecord({ outcome: 'success' }),
    ];
    expect(countOutcomes(records)).toEqual({ success: 3, failure: 0, abandoned: 0 });
  });

  test('failure-only records → failure = N, others = 0', () => {
    const records = [
      makeRecord({ outcome: 'failure' }),
      makeRecord({ outcome: 'failure' }),
    ];
    expect(countOutcomes(records)).toEqual({ success: 0, failure: 2, abandoned: 0 });
  });

  test('abandoned-only records → abandoned = N, others = 0', () => {
    const records = [
      makeRecord({ outcome: 'abandoned' }),
      makeRecord({ outcome: 'abandoned' }),
      makeRecord({ outcome: 'abandoned' }),
    ];
    expect(countOutcomes(records)).toEqual({ success: 0, failure: 0, abandoned: 3 });
  });

  test('mixed outcomes → each counted independently', () => {
    const records = [
      makeRecord({ outcome: 'success' }),
      makeRecord({ outcome: 'failure' }),
      makeRecord({ outcome: 'abandoned' }),
      makeRecord({ outcome: 'success' }),
      makeRecord({ outcome: 'failure' }),
    ];
    expect(countOutcomes(records)).toEqual({ success: 2, failure: 2, abandoned: 1 });
  });

  test('records with UNKNOWN outcome string → NOT counted in any bucket', () => {
    // TraceRecord's outcome type allows 'success' | 'failure' | 'abandoned'
    // (from TraceRecord['outcome']), but at runtime a malformed record could
    // have anything. countOutcomes must not silently bucket unknowns.
    const records = [
      makeRecord({ outcome: 'success' }),
      makeRecord({ outcome: 'unknown' as TraceRecord['outcome'] }),
      makeRecord({ outcome: 'pending' as TraceRecord['outcome'] }),
    ];
    expect(countOutcomes(records)).toEqual({ success: 1, failure: 0, abandoned: 0 });
  });

  test('empty records → all zeros', () => {
    expect(countOutcomes([])).toEqual({ success: 0, failure: 0, abandoned: 0 });
  });

  test('return type is OutcomeCounts with exactly 3 numeric fields', () => {
    const result = countOutcomes([makeRecord()]);
    expect(Object.keys(result).sort()).toEqual(['abandoned', 'failure', 'success']);
    expect(typeof result.success).toBe('number');
    expect(typeof result.failure).toBe('number');
    expect(typeof result.abandoned).toBe('number');
  });

  test('sum of counts ≤ total records (strict < when unknowns present)', () => {
    const records = [
      makeRecord({ outcome: 'success' }),
      makeRecord({ outcome: 'unknown' as TraceRecord['outcome'] }),
    ];
    const counts = countOutcomes(records);
    const sum = counts.success + counts.failure + counts.abandoned;
    expect(sum).toBe(1);
    expect(sum).toBeLessThan(records.length);
  });
});

// ---------------------------------------------------------------------------
// computeIncrementalTokens — voyage_id grouping
// ---------------------------------------------------------------------------

describe('computeIncrementalTokens — standalone for undefined voyage_id', () => {
  test('records with undefined voyage_id are treated as standalone', () => {
    const records = [
      makeRecord({ tokens_consumed: { input: 100, output: 10 } }),
      makeRecord({ tokens_consumed: { input: 200, output: 20 } }),
      makeRecord({ tokens_consumed: { input: 300, output: 30 } }),
    ];
    // No voyage_id → each record IS its own incremental (no delta).
    const result = computeIncrementalTokens(records);
    expect(result).toEqual([
      { input: 100, output: 10 },
      { input: 200, output: 20 },
      { input: 300, output: 30 },
    ]);
  });

  test('missing tokens_consumed is treated as {input:0, output:0}', () => {
    const records = [
      makeRecord({ tokens_consumed: undefined } as Partial<TraceRecord>),
    ];
    const result = computeIncrementalTokens(records);
    expect(result).toEqual([{ input: 0, output: 0 }]);
  });

  test('partial tokens_consumed treats missing fields as 0', () => {
    const records = [
      makeRecord({
        tokens_consumed: { input: 500 } as Partial<TraceRecord['tokens_consumed']> as TraceRecord['tokens_consumed'],
      }),
    ];
    const result = computeIncrementalTokens(records);
    expect(result).toEqual([{ input: 500, output: 0 }]);
  });
});

describe('computeIncrementalTokens — voyage_id delta computation', () => {
  test('first record of a voyage → cumulative IS incremental', () => {
    const records = [
      makeRecord({
        voyage_id: 'v1',
        tokens_consumed: { input: 1000, output: 100 },
      } as Partial<TraceRecord>),
    ];
    const result = computeIncrementalTokens(records);
    expect(result[0]).toEqual({ input: 1000, output: 100 });
  });

  test('second record in same voyage → delta from first', () => {
    const records = [
      makeRecord({
        voyage_id: 'v1',
        tokens_consumed: { input: 1000, output: 100 },
      } as Partial<TraceRecord>),
      makeRecord({
        voyage_id: 'v1',
        tokens_consumed: { input: 1500, output: 150 },
      } as Partial<TraceRecord>),
    ];
    const result = computeIncrementalTokens(records);
    expect(result[1]).toEqual({ input: 500, output: 50 });
  });

  test('third record in same voyage → delta from second (NOT from first)', () => {
    // This is the critical invariant — naive summing double-counts.
    // Each record's cumulative includes ALL prior waypoints in the voyage.
    const records = [
      makeRecord({
        voyage_id: 'v1',
        tokens_consumed: { input: 1000, output: 100 },
      } as Partial<TraceRecord>),
      makeRecord({
        voyage_id: 'v1',
        tokens_consumed: { input: 1500, output: 150 },
      } as Partial<TraceRecord>),
      makeRecord({
        voyage_id: 'v1',
        tokens_consumed: { input: 1800, output: 200 },
      } as Partial<TraceRecord>),
    ];
    const result = computeIncrementalTokens(records);
    // Third record delta = 1800 - 1500 = 300, NOT 1800 - 1000 = 800.
    expect(result[2]).toEqual({ input: 300, output: 50 });
    // Sum of incremental = 1000 + 500 + 300 = 1800 (matches final cumulative).
    const sumInput = result.reduce((s, t) => s + t.input, 0);
    expect(sumInput).toBe(1800);
  });

  test('multiple voyages tracked independently', () => {
    const records = [
      makeRecord({
        voyage_id: 'v1',
        tokens_consumed: { input: 100, output: 10 },
      } as Partial<TraceRecord>),
      makeRecord({
        voyage_id: 'v2',
        tokens_consumed: { input: 200, output: 20 },
      } as Partial<TraceRecord>),
      makeRecord({
        voyage_id: 'v1',
        tokens_consumed: { input: 150, output: 15 },
      } as Partial<TraceRecord>),
      makeRecord({
        voyage_id: 'v2',
        tokens_consumed: { input: 350, output: 35 },
      } as Partial<TraceRecord>),
    ];
    const result = computeIncrementalTokens(records);
    // v1 second record: 150 - 100 = 50
    expect(result[2]).toEqual({ input: 50, output: 5 });
    // v2 second record: 350 - 200 = 150
    expect(result[3]).toEqual({ input: 150, output: 15 });
  });

  test('voyage resets when voyage_id changes back (Map remembers each)', () => {
    // Going v1 → v2 → v1: v1's prior cumulative is still tracked in the Map.
    const records = [
      makeRecord({
        voyage_id: 'v1',
        tokens_consumed: { input: 100, output: 10 },
      } as Partial<TraceRecord>),
      makeRecord({
        voyage_id: 'v2',
        tokens_consumed: { input: 500, output: 50 },
      } as Partial<TraceRecord>),
      makeRecord({
        voyage_id: 'v1',
        tokens_consumed: { input: 300, output: 30 },
      } as Partial<TraceRecord>),
    ];
    const result = computeIncrementalTokens(records);
    // Third record is v1 again — delta from v1's previous (100), so 300-100=200.
    expect(result[2]).toEqual({ input: 200, output: 20 });
  });

  test('negative delta clamped to 0 via Math.max(0, ...)', () => {
    // State is supposed to be monotonic, but defensive clamping handles
    // trace corruption or reset. A drop in cumulative → 0 incremental.
    const records = [
      makeRecord({
        voyage_id: 'v1',
        tokens_consumed: { input: 1000, output: 100 },
      } as Partial<TraceRecord>),
      makeRecord({
        voyage_id: 'v1',
        tokens_consumed: { input: 500, output: 50 }, // Decreased!
      } as Partial<TraceRecord>),
    ];
    const result = computeIncrementalTokens(records);
    expect(result[1]).toEqual({ input: 0, output: 0 });
  });

  test('empty records → empty result array', () => {
    expect(computeIncrementalTokens([])).toEqual([]);
  });

  test('result length matches input length', () => {
    const records = [
      makeRecord({ voyage_id: 'v1' } as Partial<TraceRecord>),
      makeRecord({ voyage_id: 'v1' } as Partial<TraceRecord>),
      makeRecord({ voyage_id: 'v2' } as Partial<TraceRecord>),
    ];
    expect(computeIncrementalTokens(records).length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// computeVoyageStats — trend threshold and half-split
// ---------------------------------------------------------------------------

describe('computeVoyageStats — trend threshold is exactly n >= 4', () => {
  test('0 records → trend is null', () => {
    expect(computeVoyageStats([]).trend).toBeNull();
  });

  test('1 record → trend is null', () => {
    expect(computeVoyageStats([makeRecord()]).trend).toBeNull();
  });

  test('2 records → trend is null', () => {
    expect(
      computeVoyageStats([makeRecord({ waypoint_id: 'a' }), makeRecord({ waypoint_id: 'b' })]).trend,
    ).toBeNull();
  });

  test('3 records → trend is null (below threshold)', () => {
    expect(
      computeVoyageStats([
        makeRecord({ waypoint_id: 'a' }),
        makeRecord({ waypoint_id: 'b' }),
        makeRecord({ waypoint_id: 'c' }),
      ]).trend,
    ).toBeNull();
  });

  test('4 records → trend IS computed (at threshold)', () => {
    const records = [
      makeRecord({ waypoint_id: 'a' }),
      makeRecord({ waypoint_id: 'b' }),
      makeRecord({ waypoint_id: 'c' }),
      makeRecord({ waypoint_id: 'd' }),
    ];
    expect(computeVoyageStats(records).trend).not.toBeNull();
  });

  test('5 records → trend IS computed', () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      makeRecord({ waypoint_id: `wp_${i}` }),
    );
    expect(computeVoyageStats(records).trend).not.toBeNull();
  });
});

describe('computeVoyageStats — half = floor(total/2)', () => {
  test('even total (4) → first half = 2, second half = 2', () => {
    const records = Array.from({ length: 4 }, (_, i) =>
      makeRecord({ waypoint_id: `wp_${i}` }),
    );
    const trend = computeVoyageStats(records).trend!;
    expect(trend.firstHalf.waypoints).toBe(2);
    expect(trend.secondHalf.waypoints).toBe(2);
  });

  test('odd total (5) → first half = 2, second half = 3 (extra in second)', () => {
    // floor(5/2) = 2. slice(0,2) = 2 records. slice(2) = 3 records.
    const records = Array.from({ length: 5 }, (_, i) =>
      makeRecord({ waypoint_id: `wp_${i}` }),
    );
    const trend = computeVoyageStats(records).trend!;
    expect(trend.firstHalf.waypoints).toBe(2);
    expect(trend.secondHalf.waypoints).toBe(3);
  });

  test('odd total (7) → first half = 3, second half = 4', () => {
    const records = Array.from({ length: 7 }, (_, i) =>
      makeRecord({ waypoint_id: `wp_${i}` }),
    );
    const trend = computeVoyageStats(records).trend!;
    expect(trend.firstHalf.waypoints).toBe(3);
    expect(trend.secondHalf.waypoints).toBe(4);
  });

  test('total waypoints in trend = total records', () => {
    for (const n of [4, 5, 6, 7, 10, 11]) {
      const records = Array.from({ length: n }, (_, i) =>
        makeRecord({ waypoint_id: `wp_${i}` }),
      );
      const trend = computeVoyageStats(records).trend!;
      expect(trend.firstHalf.waypoints + trend.secondHalf.waypoints).toBe(n);
    }
  });

  test('firstHalf always <= secondHalf', () => {
    for (const n of [4, 5, 6, 7, 10, 11, 100, 101]) {
      const records = Array.from({ length: n }, (_, i) =>
        makeRecord({ waypoint_id: `wp_${i}` }),
      );
      const trend = computeVoyageStats(records).trend!;
      expect(trend.firstHalf.waypoints).toBeLessThanOrEqual(trend.secondHalf.waypoints);
    }
  });
});

// ---------------------------------------------------------------------------
// computeVoyageStats — empty input is observable zero (not null)
// ---------------------------------------------------------------------------

describe('computeVoyageStats — empty input returns zero-state', () => {
  const empty = computeVoyageStats([]);

  test('totalWaypoints is 0 (not undefined)', () => {
    expect(empty.totalWaypoints).toBe(0);
  });

  test('outcomes is {success:0, failure:0, abandoned:0}', () => {
    expect(empty.outcomes).toEqual({ success: 0, failure: 0, abandoned: 0 });
  });

  test('successRate is 0 (not NaN, not null)', () => {
    // Division 0/0 in JS is NaN, but the source guards `total > 0 ?`.
    expect(empty.successRate).toBe(0);
    expect(Number.isNaN(empty.successRate)).toBe(false);
  });

  test('totalTokens is {input:0, output:0}', () => {
    expect(empty.totalTokens).toEqual({ input: 0, output: 0 });
  });

  test('avgTokensPerWaypoint is {input:0, output:0}', () => {
    expect(empty.avgTokensPerWaypoint).toEqual({ input: 0, output: 0 });
  });

  test('avgIterations is 0', () => {
    expect(empty.avgIterations).toBe(0);
  });

  test('topFailReasons is empty array (not null)', () => {
    expect(empty.topFailReasons).toEqual([]);
    expect(Array.isArray(empty.topFailReasons)).toBe(true);
  });

  test('topAbandonedReasons is empty array', () => {
    expect(empty.topAbandonedReasons).toEqual([]);
  });

  test('trend is null', () => {
    expect(empty.trend).toBeNull();
  });

  test('empty stats has exactly 9 own properties', () => {
    // totalWaypoints, outcomes, successRate, totalTokens, avgTokensPerWaypoint,
    // avgIterations, topFailReasons, topAbandonedReasons, trend.
    expect(Object.keys(empty).length).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// computeVoyageStats — rates are fractions in [0, 1]
// ---------------------------------------------------------------------------

describe('computeVoyageStats — rates are fractions (not percentages)', () => {
  test('all success → successRate = 1.0 (not 100)', () => {
    const records = [
      makeRecord({ outcome: 'success' }),
      makeRecord({ outcome: 'success' }),
    ];
    expect(computeVoyageStats(records).successRate).toBe(1);
  });

  test('half success → successRate = 0.5', () => {
    const records = [
      makeRecord({ outcome: 'success' }),
      makeRecord({ outcome: 'failure' }),
    ];
    expect(computeVoyageStats(records).successRate).toBe(0.5);
  });

  test('no success → successRate = 0', () => {
    const records = [
      makeRecord({ outcome: 'failure' }),
      makeRecord({ outcome: 'abandoned' }),
    ];
    expect(computeVoyageStats(records).successRate).toBe(0);
  });

  test('rate is in [0, 1] for various mixes', () => {
    const mixes: Array<TraceRecord['outcome'][]> = [
      ['success'],
      ['failure'],
      ['abandoned'],
      ['success', 'failure'],
      ['success', 'failure', 'abandoned'],
      ['success', 'success', 'failure', 'abandoned'],
    ];
    for (const mix of mixes) {
      const records = mix.map((outcome, i) =>
        makeRecord({ waypoint_id: `wp_${i}`, outcome }),
      );
      const rate = computeVoyageStats(records).successRate;
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// computeVoyageStats — avgIterations uses iterations_used ?? 0
// ---------------------------------------------------------------------------

describe('computeVoyageStats — avgIterations', () => {
  test('single record with iterations_used=5 → avgIterations = 5', () => {
    expect(
      computeVoyageStats([makeRecord({ iterations_used: 5 })]).avgIterations,
    ).toBe(5);
  });

  test('multiple records → mean of iterations_used', () => {
    const records = [
      makeRecord({ iterations_used: 2 }),
      makeRecord({ iterations_used: 4 }),
      makeRecord({ iterations_used: 6 }),
    ];
    expect(computeVoyageStats(records).avgIterations).toBe(4);
  });

  test('undefined iterations_used treated as 0', () => {
    const records = [
      makeRecord({ iterations_used: undefined } as Partial<TraceRecord>),
      makeRecord({ iterations_used: 4 }),
    ];
    expect(computeVoyageStats(records).avgIterations).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// computeVoyageStats — topReasons aggregation rules
// ---------------------------------------------------------------------------

describe('computeVoyageStats — topReasons aggregation', () => {
  test('fail_reason normalized before counting', () => {
    // Two failures with different detail text but same prefix should
    // aggregate into one bucket after normalizeReason.
    const records = [
      makeRecord({
        outcome: 'failure',
        fail_reason: 'threshold exceeded (5 retries)',
      }),
      makeRecord({
        outcome: 'failure',
        fail_reason: 'threshold exceeded (10 retries)',
      }),
    ];
    const stats = computeVoyageStats(records);
    expect(stats.topFailReasons.length).toBe(1);
    expect(stats.topFailReasons[0]?.reason).toBe('threshold exceeded');
    expect(stats.topFailReasons[0]?.count).toBe(2);
  });

  test('abandoned records do NOT appear in topFailReasons', () => {
    const records = [
      makeRecord({ outcome: 'failure', fail_reason: 'fail-reason' }),
      makeRecord({ outcome: 'abandoned', fail_reason: 'abandon-reason' }),
    ];
    const stats = computeVoyageStats(records);
    expect(stats.topFailReasons.map((r) => r.reason)).toEqual(['fail-reason']);
  });

  test('failure records do NOT appear in topAbandonedReasons', () => {
    const records = [
      makeRecord({ outcome: 'failure', fail_reason: 'fail-reason' }),
      makeRecord({ outcome: 'abandoned', fail_reason: 'abandon-reason' }),
    ];
    const stats = computeVoyageStats(records);
    expect(stats.topAbandonedReasons.map((r) => r.reason)).toEqual(['abandon-reason']);
  });

  test('success records (null fail_reason) do NOT contribute to either list', () => {
    const records = [
      makeRecord({ outcome: 'success', fail_reason: null }),
      makeRecord({ outcome: 'failure', fail_reason: 'real fail' }),
    ];
    const stats = computeVoyageStats(records);
    expect(stats.topFailReasons.length).toBe(1);
    expect(stats.topAbandonedReasons.length).toBe(0);
  });

  test('null fail_reason on failure → normalized to `(none)`', () => {
    const records = [
      makeRecord({ outcome: 'failure', fail_reason: null }),
      makeRecord({ outcome: 'failure', fail_reason: null }),
    ];
    const stats = computeVoyageStats(records);
    expect(stats.topFailReasons[0]?.reason).toBe('(none)');
    expect(stats.topFailReasons[0]?.count).toBe(2);
  });

  test('topReasons entries have exactly {reason, count} shape', () => {
    const records = [makeRecord({ outcome: 'failure', fail_reason: 'X' })];
    const entry = computeVoyageStats(records).topFailReasons[0]!;
    expect(Object.keys(entry).sort()).toEqual(['count', 'reason']);
    expect(typeof entry.reason).toBe('string');
    expect(typeof entry.count).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// computeVoyageStats — avgTokensPerWaypoint
// ---------------------------------------------------------------------------

describe('computeVoyageStats — avgTokensPerWaypoint', () => {
  test('single record → avgTokens = record.tokens_consumed', () => {
    const stats = computeVoyageStats([
      makeRecord({
        tokens_consumed: { input: 500, output: 50 },
        voyage_id: undefined,
      }),
    ]);
    expect(stats.avgTokensPerWaypoint).toEqual({ input: 500, output: 50 });
  });

  test('multiple standalone records → mean of tokens', () => {
    const records = [
      makeRecord({ tokens_consumed: { input: 100, output: 10 } }),
      makeRecord({ tokens_consumed: { input: 300, output: 30 } }),
    ];
    expect(computeVoyageStats(records).avgTokensPerWaypoint).toEqual({
      input: 200,
      output: 20,
    });
  });

  test('voyage cumulative tokens are DELTA-CORRECTED before averaging', () => {
    // Three records in one voyage with cumulative 1000/1500/1800.
    // Incremental: 1000, 500, 300. Sum: 1800. Avg: 600.
    const records = [
      makeRecord({
        voyage_id: 'v1',
        tokens_consumed: { input: 1000, output: 100 },
      } as Partial<TraceRecord>),
      makeRecord({
        voyage_id: 'v1',
        tokens_consumed: { input: 1500, output: 150 },
      } as Partial<TraceRecord>),
      makeRecord({
        voyage_id: 'v1',
        tokens_consumed: { input: 1800, output: 180 },
      } as Partial<TraceRecord>),
    ];
    const stats = computeVoyageStats(records);
    expect(stats.totalTokens).toEqual({ input: 1800, output: 180 });
    expect(stats.avgTokensPerWaypoint).toEqual({ input: 600, output: 60 });
  });
});

// ---------------------------------------------------------------------------
// computeVoyageStats — totalWaypoints counts ALL records regardless of outcome
// ---------------------------------------------------------------------------

describe('computeVoyageStats — totalWaypoints', () => {
  test('counts all records regardless of outcome', () => {
    const records = [
      makeRecord({ outcome: 'success' }),
      makeRecord({ outcome: 'failure' }),
      makeRecord({ outcome: 'abandoned' }),
      makeRecord({ outcome: 'unknown' as TraceRecord['outcome'] }),
    ];
    expect(computeVoyageStats(records).totalWaypoints).toBe(4);
  });

  test('does NOT equal sum of outcome counts when unknowns present', () => {
    // This pins that totalWaypoints is records.length, NOT a sum derived
    // from outcomes. With unknown outcomes, the two diverge.
    const records = [
      makeRecord({ outcome: 'success' }),
      makeRecord({ outcome: 'unknown' as TraceRecord['outcome'] }),
    ];
    const stats = computeVoyageStats(records);
    expect(stats.totalWaypoints).toBe(2);
    const outcomeSum = stats.outcomes.success + stats.outcomes.failure + stats.outcomes.abandoned;
    expect(outcomeSum).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Purity — input not mutated
// ---------------------------------------------------------------------------

describe('purity — input arrays and records are not mutated', () => {
  test('countOutcomes does not mutate input', () => {
    const records = [
      makeRecord({ outcome: 'success' }),
      makeRecord({ outcome: 'failure' }),
    ];
    const snapshot = JSON.stringify(records);
    countOutcomes(records);
    expect(JSON.stringify(records)).toBe(snapshot);
  });

  test('computeIncrementalTokens does not mutate input', () => {
    const records = [
      makeRecord({ voyage_id: 'v1', tokens_consumed: { input: 100, output: 10 } } as Partial<TraceRecord>),
      makeRecord({ voyage_id: 'v1', tokens_consumed: { input: 200, output: 20 } } as Partial<TraceRecord>),
    ];
    const snapshot = JSON.stringify(records);
    computeIncrementalTokens(records);
    expect(JSON.stringify(records)).toBe(snapshot);
  });

  test('computeVoyageStats does not mutate input', () => {
    const records = [
      makeRecord({ outcome: 'success' }),
      makeRecord({ outcome: 'failure', fail_reason: 'X' }),
    ];
    const snapshot = JSON.stringify(records);
    computeVoyageStats(records);
    expect(JSON.stringify(records)).toBe(snapshot);
  });

  test('normalizeReason does not mutate input', () => {
    const input = 'error: details';
    const snapshot = input;
    normalizeReason(input);
    expect(input).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// Determinism — same input produces same output
// ---------------------------------------------------------------------------

describe('determinism — same input → same output', () => {
  test('computeVoyageStats is deterministic', () => {
    const records = [
      makeRecord({ outcome: 'success' }),
      makeRecord({ outcome: 'failure', fail_reason: 'X' }),
    ];
    const a = computeVoyageStats(records);
    const b = computeVoyageStats(records);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('countOutcomes is deterministic', () => {
    const records = [makeRecord({ outcome: 'success' }), makeRecord({ outcome: 'failure' })];
    expect(JSON.stringify(countOutcomes(records))).toBe(JSON.stringify(countOutcomes(records)));
  });

  test('computeIncrementalTokens is deterministic', () => {
    const records = [
      makeRecord({ voyage_id: 'v1' } as Partial<TraceRecord>),
      makeRecord({ voyage_id: 'v1' } as Partial<TraceRecord>),
    ];
    const a = computeIncrementalTokens(records);
    const b = computeIncrementalTokens(records);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('no shared state across computeVoyageStats calls', () => {
    // Two different record sets should not contaminate each other.
    const set1 = [makeRecord({ outcome: 'success', fail_reason: null })];
    const set2 = [makeRecord({ outcome: 'failure', fail_reason: 'real fail' })];
    const stats1 = computeVoyageStats(set1);
    const stats2 = computeVoyageStats(set2);
    expect(stats1.topFailReasons).toEqual([]);
    expect(stats2.topFailReasons.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// VoyageStats type — exported shape contracts
// ---------------------------------------------------------------------------

describe('VoyageStats — type contracts', () => {
  test('VoyageStats always has exactly 9 own properties', () => {
    const stats = computeVoyageStats([makeRecord()]);
    expect(Object.keys(stats).sort()).toEqual([
      'avgIterations',
      'avgTokensPerWaypoint',
      'outcomes',
      'successRate',
      'topAbandonedReasons',
      'topFailReasons',
      'totalTokens',
      'totalWaypoints',
      'trend',
    ]);
  });

  test('OutcomeCounts always has exactly 3 own properties', () => {
    const counts = countOutcomes([makeRecord()]);
    expect(Object.keys(counts).sort()).toEqual(['abandoned', 'failure', 'success']);
  });

  test('TrendComparison always has exactly 2 own properties', () => {
    const records = Array.from({ length: 4 }, (_, i) =>
      makeRecord({ waypoint_id: `wp_${i}` }),
    );
    const trend = computeVoyageStats(records).trend!;
    expect(Object.keys(trend).sort()).toEqual(['firstHalf', 'secondHalf']);
  });

  test('VoyageStatsSlice always has exactly 6 own properties', () => {
    const records = Array.from({ length: 4 }, (_, i) =>
      makeRecord({ waypoint_id: `wp_${i}` }),
    );
    const trend = computeVoyageStats(records).trend!;
    expect(Object.keys(trend.firstHalf).sort()).toEqual([
      'abandonedRate',
      'avgInputTokens',
      'avgIterations',
      'failureRate',
      'successRate',
      'waypoints',
    ]);
  });

  test('ReasonCount always has exactly 2 own properties', () => {
    const records = [makeRecord({ outcome: 'failure', fail_reason: 'X' })];
    const entry = computeVoyageStats(records).topFailReasons[0]!;
    expect(Object.keys(entry).sort()).toEqual(['count', 'reason']);
  });

  test('TokenTotals always has exactly 2 own properties', () => {
    const records = [makeRecord({ tokens_consumed: { input: 100, output: 10 } })];
    const stats = computeVoyageStats(records);
    expect(Object.keys(stats.totalTokens).sort()).toEqual(['input', 'output']);
    expect(Object.keys(stats.avgTokensPerWaypoint).sort()).toEqual(['input', 'output']);
  });
});

// ---------------------------------------------------------------------------
// Adversarial inputs
// ---------------------------------------------------------------------------

describe('adversarial inputs — tolerance', () => {
  test('very large token counts do not overflow to Infinity', () => {
    const records = [
      makeRecord({
        tokens_consumed: { input: Number.MAX_SAFE_INTEGER, output: Number.MAX_SAFE_INTEGER },
      }),
      makeRecord({
        tokens_consumed: { input: Number.MAX_SAFE_INTEGER, output: Number.MAX_SAFE_INTEGER },
      }),
    ];
    const stats = computeVoyageStats(records);
    expect(Number.isFinite(stats.totalTokens.input)).toBe(true);
    expect(Number.isFinite(stats.avgTokensPerWaypoint.input)).toBe(true);
  });

  test('non-integer iterations_used does not crash', () => {
    const records = [
      makeRecord({ iterations_used: 2.5 } as Partial<TraceRecord>),
      makeRecord({ iterations_used: 3.5 } as Partial<TraceRecord>),
    ];
    const stats = computeVoyageStats(records);
    expect(stats.avgIterations).toBe(3);
  });

  test('0 iterations_used is allowed', () => {
    const records = [makeRecord({ iterations_used: 0 })];
    expect(computeVoyageStats(records).avgIterations).toBe(0);
  });

  test('many records with same fail_reason aggregate into one bucket', () => {
    const records = Array.from({ length: 100 }, () =>
      makeRecord({ outcome: 'failure', fail_reason: 'same reason' }),
    );
    const stats = computeVoyageStats(records);
    expect(stats.topFailReasons.length).toBe(1);
    expect(stats.topFailReasons[0]?.count).toBe(100);
  });

  test('Unicode in fail_reason is preserved through normalization', () => {
    // ASCII colon delimits; Unicode prefix is preserved.
    const records = [
      makeRecord({ outcome: 'failure', fail_reason: '错误: details' }),
    ];
    expect(computeVoyageStats(records).topFailReasons[0]?.reason).toBe('错误');
  });

  test('fullwidth Chinese colon `：` (U+FF1A) is NOT a delimiter', () => {
    // Only ASCII `:` (U+003A) triggers split. Fullwidth stays intact.
    const reason = '错误：全角冒号';
    expect(normalizeReason(reason)).toBe(reason);
  });
});
