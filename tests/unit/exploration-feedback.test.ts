import { describe, test, expect } from 'vitest';
import {
  computeExplorationStats,
  formatExplorationFeedback,
  DEMOTION_FAILURE_THRESHOLD,
} from '../../src/cerebellum/exploration-feedback.js';
import type { ExplorationOutcome, ExplorationRecord } from '../../src/cerebellum/exploration-log.js';
import type { TraceRecord } from '../../src/trace/jsonl.js';

function traceRecord(over: Partial<TraceRecord> & { waypoint_id: string }): TraceRecord {
  return {
    ts: over.ts ?? '2026-07-21T00:00:00Z',
    waypoint_id: over.waypoint_id,
    goal: over.goal ?? 'some goal',
    strategy: over.strategy ?? 'engineer',
    parent: over.parent ?? null,
    outcome: over.outcome ?? 'success',
    checkpoint_sha: over.checkpoint_sha ?? null,
    iterations_used: over.iterations_used ?? 1,
    tokens_consumed: over.tokens_consumed ?? { input: 0, output: 0 },
    verify_result: over.verify_result ?? {},
    fail_reason: over.fail_reason ?? null,
    diff_summary: over.diff_summary ?? null,
    ...(over.voyage_id !== undefined ? { voyage_id: over.voyage_id } : {}),
  };
}

function record(over: Partial<ExplorationRecord> & { goal: string }): ExplorationRecord {
  return {
    id: over.id ?? 'expl_default',
    ts: over.ts ?? '2026-07-21T00:00:00Z',
    goal: over.goal,
    origin: over.origin ?? 'curiosity',
    priority: over.priority ?? 90,
    ...(over.voyage_id !== undefined ? { voyage_id: over.voyage_id } : {}),
  };
}

function outcome(
  over: Partial<ExplorationOutcome> & { goal: string },
): ExplorationOutcome {
  return {
    exploration: record({ goal: over.goal, ...(over.exploration ?? {}) }),
    traceOutcome: over.traceOutcome ?? null,
    traceOutcomeAt: over.traceOutcomeAt ?? null,
    traceFailReason: over.traceFailReason ?? null,
  };
}

describe('computeExplorationStats', () => {
  test('returns empty array when no explorations have trace matches', () => {
    const stats = computeExplorationStats(
      [outcome({ goal: 'never executed goal' })],
      [],
    );
    expect(stats).toEqual([]);
  });

  test('counts single success correctly', () => {
    const stats = computeExplorationStats(
      [outcome({ goal: 'add retry logic' })],
      [
        traceRecord({
          waypoint_id: 'wp_1',
          goal: 'add retry logic',
          outcome: 'success',
          ts: '2026-07-20T10:00:00Z',
        }),
      ],
    );
    expect(stats).toHaveLength(1);
    expect(stats[0]!.totalAttempts).toBe(1);
    expect(stats[0]!.successCount).toBe(1);
    expect(stats[0]!.failureCount).toBe(0);
    expect(stats[0]!.consecutiveFailures).toBe(0);
    expect(stats[0]!.lastSucceeded).toBe(true);
    expect(stats[0]!.demoted).toBe(false);
  });

  test('counts single failure correctly', () => {
    const stats = computeExplorationStats(
      [outcome({ goal: 'add retry logic' })],
      [
        traceRecord({
          waypoint_id: 'wp_1',
          goal: 'add retry logic',
          outcome: 'failure',
          fail_reason: 'tsc errored',
          ts: '2026-07-20T10:00:00Z',
        }),
      ],
    );
    expect(stats[0]!.failureCount).toBe(1);
    expect(stats[0]!.consecutiveFailures).toBe(1);
    expect(stats[0]!.lastSucceeded).toBe(false);
    expect(stats[0]!.demoted).toBe(false);
  });

  test('marks demoted when consecutive failures reach threshold', () => {
    const stats = computeExplorationStats(
      [outcome({ goal: 'add retry logic' })],
      [
        traceRecord({ waypoint_id: 'wp_1', goal: 'add retry logic', outcome: 'failure', ts: '2026-07-18T10:00:00Z' }),
        traceRecord({ waypoint_id: 'wp_2', goal: 'add retry logic', outcome: 'failure', ts: '2026-07-19T10:00:00Z' }),
        traceRecord({ waypoint_id: 'wp_3', goal: 'add retry logic', outcome: 'failure', ts: '2026-07-20T10:00:00Z' }),
      ],
    );
    expect(stats[0]!.consecutiveFailures).toBe(3);
    expect(stats[0]!.demoted).toBe(true);
    expect(stats[0]!.failureCount).toBe(3);
    expect(stats[0]!.successCount).toBe(0);
  });

  test('consecutive failures reset on success', () => {
    const stats = computeExplorationStats(
      [outcome({ goal: 'add retry logic' })],
      [
        traceRecord({ waypoint_id: 'wp_1', goal: 'add retry logic', outcome: 'failure', ts: '2026-07-18T10:00:00Z' }),
        traceRecord({ waypoint_id: 'wp_2', goal: 'add retry logic', outcome: 'failure', ts: '2026-07-19T10:00:00Z' }),
        traceRecord({ waypoint_id: 'wp_3', goal: 'add retry logic', outcome: 'success', ts: '2026-07-20T10:00:00Z' }),
        traceRecord({ waypoint_id: 'wp_4', goal: 'add retry logic', outcome: 'failure', ts: '2026-07-21T10:00:00Z' }),
      ],
    );
    // Last attempt was failure, but only 1 consecutive (success broke the streak).
    expect(stats[0]!.consecutiveFailures).toBe(1);
    expect(stats[0]!.demoted).toBe(false);
    expect(stats[0]!.failureCount).toBe(3);
    expect(stats[0]!.successCount).toBe(1);
    expect(stats[0]!.lastSucceeded).toBe(false);
  });

  test('consecutive failures stop at abandoned (not counted as failure)', () => {
    const stats = computeExplorationStats(
      [outcome({ goal: 'add retry logic' })],
      [
        traceRecord({ waypoint_id: 'wp_1', goal: 'add retry logic', outcome: 'failure', ts: '2026-07-18T10:00:00Z' }),
        traceRecord({ waypoint_id: 'wp_2', goal: 'add retry logic', outcome: 'abandoned', ts: '2026-07-19T10:00:00Z' }),
        traceRecord({ waypoint_id: 'wp_3', goal: 'add retry logic', outcome: 'failure', ts: '2026-07-20T10:00:00Z' }),
      ],
    );
    // Walk backward: failure (1), then abandoned breaks the streak.
    expect(stats[0]!.consecutiveFailures).toBe(1);
    expect(stats[0]!.demoted).toBe(false);
  });

  test('deduplicates explorations with same normalized goal', () => {
    const stats = computeExplorationStats(
      [
        outcome({ goal: 'Add Retry Logic!' }),
        outcome({ goal: 'add retry logic' }),
      ],
      [
        traceRecord({ waypoint_id: 'wp_1', goal: 'add retry logic', outcome: 'failure', ts: '2026-07-20T10:00:00Z' }),
      ],
    );
    expect(stats).toHaveLength(1);
  });

  test('DEMOTION_FAILURE_THRESHOLD is 3', () => {
    expect(DEMOTION_FAILURE_THRESHOLD).toBe(3);
  });
});

describe('formatExplorationFeedback', () => {
  test('returns empty string when no stats carry signal', () => {
    const stats = computeExplorationStats(
      [outcome({ goal: 'add retry logic' })],
      [
        traceRecord({ waypoint_id: 'wp_1', goal: 'add retry logic', outcome: 'failure', ts: '2026-07-20T10:00:00Z' }),
      ],
    );
    // 1 failure — not demoted, not succeeded — no signal.
    expect(formatExplorationFeedback(stats)).toBe('');
  });

  test('returns empty string for empty input', () => {
    expect(formatExplorationFeedback([])).toBe('');
  });

  test('renders DEMOTED for demoted explorations', () => {
    const stats = computeExplorationStats(
      [outcome({ goal: 'add retry logic' })],
      [
        traceRecord({ waypoint_id: 'wp_1', goal: 'add retry logic', outcome: 'failure', ts: '2026-07-18T10:00:00Z' }),
        traceRecord({ waypoint_id: 'wp_2', goal: 'add retry logic', outcome: 'failure', ts: '2026-07-19T10:00:00Z' }),
        traceRecord({ waypoint_id: 'wp_3', goal: 'add retry logic', outcome: 'failure', ts: '2026-07-20T10:00:00Z' }),
      ],
    );
    const md = formatExplorationFeedback(stats);
    expect(md).toContain('### Exploration feedback');
    expect(md).toContain('DEMOTED');
    expect(md).toContain('3 consecutive failures');
    expect(md).toContain('skip for now');
  });

  test('renders SHIPPED for succeeded explorations', () => {
    const stats = computeExplorationStats(
      [outcome({ goal: 'add retry logic' })],
      [
        traceRecord({ waypoint_id: 'wp_1', goal: 'add retry logic', outcome: 'success', ts: '2026-07-20T10:00:00Z' }),
      ],
    );
    const md = formatExplorationFeedback(stats);
    expect(md).toContain('### Exploration feedback');
    expect(md).toContain('SHIPPED');
    expect(md).toContain('aspiration closed');
    expect(md).toContain('do not re-propose');
  });

  test('renders both DEMOTED and SHIPPED when mixed', () => {
    const stats = computeExplorationStats(
      [
        outcome({ goal: 'failed exploration' }),
        outcome({ goal: 'succeeded exploration' }),
      ],
      [
        traceRecord({ waypoint_id: 'wp_1', goal: 'failed exploration', outcome: 'failure', ts: '2026-07-18T10:00:00Z' }),
        traceRecord({ waypoint_id: 'wp_2', goal: 'failed exploration', outcome: 'failure', ts: '2026-07-19T10:00:00Z' }),
        traceRecord({ waypoint_id: 'wp_3', goal: 'failed exploration', outcome: 'failure', ts: '2026-07-20T10:00:00Z' }),
        traceRecord({ waypoint_id: 'wp_4', goal: 'succeeded exploration', outcome: 'success', ts: '2026-07-20T11:00:00Z' }),
      ],
    );
    const md = formatExplorationFeedback(stats);
    expect(md).toContain('DEMOTED');
    expect(md).toContain('SHIPPED');
  });
});
