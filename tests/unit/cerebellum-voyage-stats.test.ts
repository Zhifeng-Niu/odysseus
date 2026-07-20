import { describe, test, expect } from 'vitest';
import {
  computeVoyageStats,
  formatVoyageStatsMarkdown,
  normalizeReason,
  countOutcomes,
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
