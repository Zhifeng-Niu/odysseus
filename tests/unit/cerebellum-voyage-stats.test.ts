import { describe, test, expect } from 'vitest';
import {
  computeVoyageStats,
  formatVoyageStatsMarkdown,
  normalizeReason,
  countOutcomes,
  computeIncrementalTokens,
} from '../../src/cerebellum/voyage-stats.js';
import type { TraceRecord } from '../../src/trace/jsonl.js';

/**
 * voyage-stats.ts — the rollup layer over trace.jsonl that answers
 * "how is the agent actually doing?". These tests pin the aggregation
 * contract that the CLI and future tooling depend on.
 */

function makeRecord(overrides: Partial<TraceRecord>): TraceRecord {
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

describe('normalizeReason', () => {
  test('returns (none) for empty input', () => {
    expect(normalizeReason('')).toBe('(none)');
    expect(normalizeReason('   ')).toBe('(none)');
  });

  test('splits on first colon', () => {
    expect(
      normalizeReason('early termination: agent produced 3 consecutive replies')
    ).toBe('early termination');
  });

  test('splits on em-dash when no colon', () => {
    expect(normalizeReason('hit maxIterations — agent did not converge')).toBe(
      'hit maxIterations'
    );
  });

  test('splits on opening paren when no colon or em-dash', () => {
    expect(normalizeReason('hit maxIterations (16) without DONE')).toBe(
      'hit maxIterations'
    );
  });

  test('prefers colon when both colon and paren present', () => {
    expect(
      normalizeReason('repeated-tool-call detector: bash (3x in a row)')
    ).toBe('repeated-tool-call detector');
  });

  test('truncates long reason without delimiter at 60 chars', () => {
    const long = 'This operation was aborted and the agent needs to retry it again somehow';
    const result = normalizeReason(long);
    expect(result.length).toBeLessThanOrEqual(61); // 60 + ellipsis
    expect(result.endsWith('…')).toBe(true);
  });

  test('keeps short reason without delimiter as-is', () => {
    expect(normalizeReason('fetch failed')).toBe('fetch failed');
    expect(normalizeReason('This operation was aborted')).toBe('This operation was aborted');
  });

  test('preserves the [CONVERSATIONAL-DONE] marker when splitting', () => {
    expect(
      normalizeReason(
        'agent emitted [CONVERSATIONAL-DONE]: conversational turn complete (no code task to verify)'
      )
    ).toBe('agent emitted [CONVERSATIONAL-DONE]');
  });
});

describe('countOutcomes', () => {
  test('empty array returns zero counts', () => {
    expect(countOutcomes([])).toEqual({ success: 0, failure: 0, abandoned: 0 });
  });

  test('counts each outcome correctly', () => {
    const records: TraceRecord[] = [
      makeRecord({ outcome: 'success' }),
      makeRecord({ outcome: 'success' }),
      makeRecord({ outcome: 'failure', fail_reason: 'hit maxIterations' }),
      makeRecord({ outcome: 'abandoned', fail_reason: 'conversational stop' }),
    ];
    expect(countOutcomes(records)).toEqual({ success: 2, failure: 1, abandoned: 1 });
  });
});

describe('computeVoyageStats — basic aggregation', () => {
  test('empty input produces zero stats', () => {
    const stats = computeVoyageStats([]);
    expect(stats.totalWaypoints).toBe(0);
    expect(stats.outcomes).toEqual({ success: 0, failure: 0, abandoned: 0 });
    expect(stats.successRate).toBe(0);
    expect(stats.totalTokens).toEqual({ input: 0, output: 0 });
    expect(stats.avgIterations).toBe(0);
    expect(stats.trend).toBeNull();
  });

  test('single success record produces 100% success rate', () => {
    const stats = computeVoyageStats([
      makeRecord({ outcome: 'success', iterations_used: 5, tokens_consumed: { input: 5000, output: 500 } }),
    ]);
    expect(stats.successRate).toBe(1);
    expect(stats.avgIterations).toBe(5);
    expect(stats.avgTokensPerWaypoint).toEqual({ input: 5000, output: 500 });
    expect(stats.trend).toBeNull(); // need >=4 records for trend
  });

  test('totalTokens sums across records', () => {
    const stats = computeVoyageStats([
      makeRecord({ tokens_consumed: { input: 1000, output: 100 } }),
      makeRecord({ tokens_consumed: { input: 2000, output: 200 } }),
      makeRecord({ tokens_consumed: { input: 3000, output: 300 } }),
    ]);
    expect(stats.totalTokens).toEqual({ input: 6000, output: 600 });
    expect(stats.avgTokensPerWaypoint).toEqual({ input: 2000, output: 200 });
  });

  test('avgIterations handles missing iterations_used', () => {
    const stats = computeVoyageStats([
      makeRecord({ iterations_used: 10 }),
      makeRecord({ iterations_used: 0 }),
    ]);
    expect(stats.avgIterations).toBe(5);
  });
});

describe('computeVoyageStats — reason aggregation', () => {
  test('topFailReasons returns normalized reasons sorted by count, top 5', () => {
    const records: TraceRecord[] = [
      makeRecord({ outcome: 'failure', fail_reason: 'fetch failed' }),
      makeRecord({ outcome: 'failure', fail_reason: 'fetch failed' }),
      makeRecord({ outcome: 'failure', fail_reason: 'fetch failed' }),
      makeRecord({
        outcome: 'failure',
        fail_reason: 'early termination: agent produced 3 consecutive replies',
      }),
      makeRecord({
        outcome: 'failure',
        fail_reason: 'early termination: agent produced 5 consecutive replies',
      }),
      makeRecord({
        outcome: 'failure',
        fail_reason: 'hit maxIterations (16) without DONE',
      }),
    ];
    const stats = computeVoyageStats(records);
    expect(stats.topFailReasons.length).toBe(3);
    expect(stats.topFailReasons[0]).toEqual({ reason: 'fetch failed', count: 3 });
    expect(stats.topFailReasons[1]).toEqual({ reason: 'early termination', count: 2 });
    expect(stats.topFailReasons[2]).toEqual({ reason: 'hit maxIterations', count: 1 });
  });

  test('topAbandonedReasons is separate from failures', () => {
    const records: TraceRecord[] = [
      makeRecord({ outcome: 'abandoned', fail_reason: 'agent emitted [CONVERSATIONAL-DONE]: ...' }),
      makeRecord({ outcome: 'abandoned', fail_reason: 'agent emitted [CONVERSATIONAL-DONE]: ...' }),
      makeRecord({ outcome: 'failure', fail_reason: 'fetch failed' }),
    ];
    const stats = computeVoyageStats(records);
    expect(stats.topAbandonedReasons).toEqual([
      { reason: 'agent emitted [CONVERSATIONAL-DONE]', count: 2 },
    ]);
    expect(stats.topFailReasons).toEqual([{ reason: 'fetch failed', count: 1 }]);
  });

  test('caps at top 5 reasons', () => {
    const records: TraceRecord[] = Array.from({ length: 7 }, (_, i) =>
      makeRecord({ outcome: 'failure', fail_reason: `reason ${i}` })
    );
    const stats = computeVoyageStats(records);
    expect(stats.topFailReasons.length).toBe(5);
  });

  test('null fail_reason is normalized as (none)', () => {
    const records: TraceRecord[] = [
      makeRecord({ outcome: 'failure', fail_reason: null }),
      makeRecord({ outcome: 'failure', fail_reason: null }),
    ];
    const stats = computeVoyageStats(records);
    expect(stats.topFailReasons[0]).toEqual({ reason: '(none)', count: 2 });
  });
});

describe('computeVoyageStats — trend', () => {
  test('trend is null when fewer than 4 records', () => {
    expect(computeVoyageStats([]).trend).toBeNull();
    expect(computeVoyageStats([makeRecord({})]).trend).toBeNull();
    expect(computeVoyageStats([makeRecord({}), makeRecord({})]).trend).toBeNull();
    expect(
      computeVoyageStats([makeRecord({}), makeRecord({}), makeRecord({})]).trend
    ).toBeNull();
  });

  test('trend splits records in half', () => {
    const records: TraceRecord[] = Array.from({ length: 10 }, (_, i) =>
      makeRecord({
        outcome: i < 5 ? 'success' : 'failure',
        iterations_used: i < 5 ? 3 : 10,
        tokens_consumed: { input: i < 5 ? 1000 : 5000, output: 100 },
      })
    );
    const stats = computeVoyageStats(records);
    expect(stats.trend).not.toBeNull();
    if (stats.trend) {
      expect(stats.trend.firstHalf.waypoints).toBe(5);
      expect(stats.trend.secondHalf.waypoints).toBe(5);
      expect(stats.trend.firstHalf.successRate).toBe(1);
      expect(stats.trend.secondHalf.successRate).toBe(0);
      expect(stats.trend.firstHalf.avgIterations).toBe(3);
      expect(stats.trend.secondHalf.avgIterations).toBe(10);
    }
  });

  test('trend with odd count gives extra record to second half', () => {
    const records: TraceRecord[] = Array.from({ length: 7 }, () => makeRecord({}));
    const stats = computeVoyageStats(records);
    if (stats.trend) {
      expect(stats.trend.firstHalf.waypoints).toBe(3);
      expect(stats.trend.secondHalf.waypoints).toBe(4);
    }
  });
});

describe('formatVoyageStatsMarkdown', () => {
  test('renders headline numbers', () => {
    const stats = computeVoyageStats([
      makeRecord({ outcome: 'success', tokens_consumed: { input: 1_000_000, output: 50_000 } }),
      makeRecord({ outcome: 'failure', fail_reason: 'fetch failed' }),
    ]);
    const md = formatVoyageStatsMarkdown(stats);
    expect(md).toContain('Total waypoints: 2');
    expect(md).toContain('success=1');
    expect(md).toContain('failure=1');
    expect(md).toContain('Success rate: 50%');
    expect(md).toContain('1.00M'); // formatted input tokens
  });

  test('renders top failure reasons', () => {
    const stats = computeVoyageStats([
      makeRecord({ outcome: 'failure', fail_reason: 'fetch failed' }),
      makeRecord({ outcome: 'failure', fail_reason: 'fetch failed' }),
    ]);
    const md = formatVoyageStatsMarkdown(stats);
    expect(md).toContain('## Top failure reasons');
    expect(md).toContain('fetch failed');
  });

  test('renders trend section when present', () => {
    const records: TraceRecord[] = Array.from({ length: 6 }, () => makeRecord({}));
    const md = formatVoyageStatsMarkdown(computeVoyageStats(records));
    expect(md).toContain('## Trend');
    expect(md).toContain('First half');
    expect(md).toContain('Second half');
  });

  test('omits trend section when stats.trend is null', () => {
    const md = formatVoyageStatsMarkdown(computeVoyageStats([makeRecord({})]));
    expect(md).not.toContain('## Trend');
  });

  test('(none) appears for empty reason lists', () => {
    const md = formatVoyageStatsMarkdown(computeVoyageStats([makeRecord({})]));
    expect(md).toContain('(none)');
  });
});

describe('computeIncrementalTokens — voyage-cumulative correction', () => {
  test('records without voyage_id are treated as standalone (cumulative = delta)', () => {
    const records: TraceRecord[] = [
      makeRecord({ tokens_consumed: { input: 1000, output: 100 } }),
      makeRecord({ tokens_consumed: { input: 2000, output: 200 } }),
      makeRecord({ tokens_consumed: { input: 3000, output: 300 } }),
    ];
    const inc = computeIncrementalTokens(records);
    expect(inc).toEqual([
      { input: 1000, output: 100 },
      { input: 2000, output: 200 },
      { input: 3000, output: 300 },
    ]);
  });

  test('records in the same voyage are differenced from prior cumulative', () => {
    // Simulate an orchestrator running total across 3 waypoints in one voyage.
    // Without delta, summing cumulative gives 100+250+500 = 850 input tokens.
    // With delta: 100 + 150 + 250 = 500 — the actual voyage cost.
    const records: TraceRecord[] = [
      makeRecord({
        voyage_id: 'voy_abc',
        waypoint_id: 'wp_1',
        tokens_consumed: { input: 100, output: 10 },
      }),
      makeRecord({
        voyage_id: 'voy_abc',
        waypoint_id: 'wp_2',
        tokens_consumed: { input: 250, output: 30 },
      }),
      makeRecord({
        voyage_id: 'voy_abc',
        waypoint_id: 'wp_3',
        tokens_consumed: { input: 500, output: 75 },
      }),
    ];
    const inc = computeIncrementalTokens(records);
    expect(inc).toEqual([
      { input: 100, output: 10 },
      { input: 150, output: 20 },
      { input: 250, output: 45 },
    ]);
  });

  test('interleaved voyages keep separate running totals', () => {
    const records: TraceRecord[] = [
      makeRecord({ voyage_id: 'A', waypoint_id: 'A1', tokens_consumed: { input: 100, output: 0 } }),
      makeRecord({ voyage_id: 'B', waypoint_id: 'B1', tokens_consumed: { input: 50, output: 0 } }),
      makeRecord({ voyage_id: 'A', waypoint_id: 'A2', tokens_consumed: { input: 300, output: 0 } }),
      makeRecord({ voyage_id: 'B', waypoint_id: 'B2', tokens_consumed: { input: 200, output: 0 } }),
    ];
    const inc = computeIncrementalTokens(records);
    expect(inc).toEqual([
      { input: 100, output: 0 }, // A first
      { input: 50, output: 0 },  // B first
      { input: 200, output: 0 }, // A delta: 300 - 100
      { input: 150, output: 0 }, // B delta: 200 - 50
    ]);
  });

  test('negative deltas (should not happen) clamp to 0', () => {
    const records: TraceRecord[] = [
      makeRecord({ voyage_id: 'X', waypoint_id: 'X1', tokens_consumed: { input: 500, output: 50 } }),
      makeRecord({ voyage_id: 'X', waypoint_id: 'X2', tokens_consumed: { input: 400, output: 30 } }),
    ];
    const inc = computeIncrementalTokens(records);
    expect(inc).toEqual([
      { input: 500, output: 50 },
      { input: 0, output: 0 }, // clamp — state shouldn't go backward
    ]);
  });

  test('legacy records (no voyage_id) mixed with new records do not interfere', () => {
    const records: TraceRecord[] = [
      makeRecord({ tokens_consumed: { input: 1000, output: 0 } }), // legacy
      makeRecord({ voyage_id: 'V', waypoint_id: 'V1', tokens_consumed: { input: 100, output: 0 } }),
      makeRecord({ voyage_id: 'V', waypoint_id: 'V2', tokens_consumed: { input: 500, output: 0 } }),
    ];
    const inc = computeIncrementalTokens(records);
    expect(inc).toEqual([
      { input: 1000, output: 0 }, // legacy: standalone
      { input: 100, output: 0 },  // V first
      { input: 400, output: 0 },  // V delta: 500 - 100
    ]);
  });

  test('computeVoyageStats uses incremental tokens for total + average', () => {
    // Same voyage: 3 waypoints with cumulative 100/250/500 input tokens.
    // Real per-waypoint consumption: 100/150/250 = 500 total, avg 166.67.
    const records: TraceRecord[] = [
      makeRecord({
        voyage_id: 'voy_stats',
        waypoint_id: 's1',
        tokens_consumed: { input: 100, output: 10 },
      }),
      makeRecord({
        voyage_id: 'voy_stats',
        waypoint_id: 's2',
        tokens_consumed: { input: 250, output: 30 },
      }),
      makeRecord({
        voyage_id: 'voy_stats',
        waypoint_id: 's3',
        tokens_consumed: { input: 500, output: 75 },
      }),
    ];
    const stats = computeVoyageStats(records);
    expect(stats.totalTokens).toEqual({ input: 500, output: 75 });
    expect(stats.avgTokensPerWaypoint).toEqual({ input: 500 / 3, output: 25 });
  });

  test('computeVoyageStats trend slices also use incremental tokens', () => {
    // 4 records in same voyage. Cumulative: 100/200/350/500. Deltas: 100/100/150/150.
    // First half (2 records): incremental total = 200, avg = 100.
    // Second half (2 records): incremental total = 300, avg = 150.
    const records: TraceRecord[] = [100, 200, 350, 500].map((input, i) =>
      makeRecord({
        voyage_id: 'voy_trend',
        waypoint_id: `t${i + 1}`,
        tokens_consumed: { input, output: 0 },
      })
    );
    const stats = computeVoyageStats(records);
    expect(stats.trend).not.toBeNull();
    if (stats.trend) {
      expect(stats.trend.firstHalf.avgInputTokens).toBe(100);
      expect(stats.trend.secondHalf.avgInputTokens).toBe(150);
    }
  });
});
