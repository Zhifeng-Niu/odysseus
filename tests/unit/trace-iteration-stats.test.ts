import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendTrace } from '../../src/trace/jsonl.js';
import {
  aggregateIterations,
  normalizeGoal,
  reportHighIterationGoals,
  type TraceRecord,
} from '../../src/trace/iteration-stats.js';

describe('normalizeGoal', () => {
  test('trims and lowercases', () => {
    expect(normalizeGoal('  Add A Bash Tool  ')).toBe('add a bash tool');
  });

  test('collapses whitespace-only differences', () => {
    expect(normalizeGoal('Add a bash tool ')).toBe('add a bash tool');
  });
});

describe('aggregateIterations', () => {
  test('groups records by normalized goal and computes stats', () => {
    const records: TraceRecord[] = [
      mkRecord('Add a bash tool', 3, 'success'),
      mkRecord('add a bash tool', 7, 'failure'), // same goal, normalized
      mkRecord('Fix the lint errors', 2, 'success'),
    ];

    const stats = aggregateIterations(records);
    expect(stats).toHaveLength(2);

    // Sorted by averageIterations desc: bash (avg 5) > lint (avg 2)
    const bash = stats[0]!;
    expect(bash.goal).toBe('add a bash tool');
    expect(bash.count).toBe(2);
    expect(bash.totalIterations).toBe(10);
    expect(bash.averageIterations).toBe(5);
    expect(bash.maxIterations).toBe(7);
    expect(bash.minIterations).toBe(3);
    expect(bash.successCount).toBe(1);
    expect(bash.failureCount).toBe(1);

    const lint = stats[1]!;
    expect(lint.goal).toBe('fix the lint errors');
    expect(lint.count).toBe(1);
    expect(lint.averageIterations).toBe(2);
  });

  test('skips records with empty goal', () => {
    const records: TraceRecord[] = [
      mkRecord('', 5, 'success'),
      mkRecord('real goal', 1, 'success'),
    ];
    const stats = aggregateIterations(records);
    expect(stats).toHaveLength(1);
    expect(stats[0]!.goal).toBe('real goal');
  });

  test('handles empty input', () => {
    expect(aggregateIterations([])).toEqual([]);
  });

  test('counts abandoned outcomes as failures', () => {
    const records: TraceRecord[] = [
      mkRecord('greet user', 0, 'abandoned'),
      mkRecord('greet user', 0, 'abandoned'),
    ];
    const stats = aggregateIterations(records);
    expect(stats[0]!.successCount).toBe(0);
    expect(stats[0]!.failureCount).toBe(2);
  });
});

describe('reportHighIterationGoals', () => {
  let workdir: string;
  let tracePath: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-iter-'));
    tracePath = join(workdir, 'trace.jsonl');
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('flags goals above the iteration threshold', async () => {
    // "hard goal" averages 6 iterations across 2 attempts → flagged
    await appendTrace(tracePath, { waypoint_id: 'wp_1', goal: 'hard goal', iterations_used: 5, outcome: 'failure' });
    await appendTrace(tracePath, { waypoint_id: 'wp_2', goal: 'hard goal', iterations_used: 7, outcome: 'success' });
    // "easy goal" averages 2 → not flagged
    await appendTrace(tracePath, { waypoint_id: 'wp_3', goal: 'easy goal', iterations_used: 2, outcome: 'success' });

    const report = await reportHighIterationGoals(tracePath, { threshold: 5, minAttempts: 1 });
    expect(report.goals).toHaveLength(2);
    expect(report.highIterationGoals).toHaveLength(1);
    expect(report.highIterationGoals[0]!.goal).toBe('hard goal');
    expect(report.highIterationGoals[0]!.averageIterations).toBe(6);
  });

  test('respects minAttempts gate', async () => {
    // single high-iteration attempt, but minAttempts=2 → not flagged
    await appendTrace(tracePath, { waypoint_id: 'wp_1', goal: 'one-off', iterations_used: 10, outcome: 'failure' });

    const report = await reportHighIterationGoals(tracePath, { threshold: 5, minAttempts: 2 });
    expect(report.highIterationGoals).toHaveLength(0);
  });

  test('returns empty report for missing trace file', async () => {
    const report = await reportHighIterationGoals(join(workdir, 'nope.jsonl'));
    expect(report.goals).toEqual([]);
    expect(report.highIterationGoals).toEqual([]);
  });

  test('defaults threshold to 5 and minAttempts to 1', async () => {
    await appendTrace(tracePath, { waypoint_id: 'wp_1', goal: 'borderline', iterations_used: 5, outcome: 'success' });
    const report = await reportHighIterationGoals(tracePath);
    expect(report.threshold).toBe(5);
    expect(report.minAttempts).toBe(1);
    // exactly at threshold → flagged (>=)
    expect(report.highIterationGoals).toHaveLength(1);
  });
});

function mkRecord(
  goal: string,
  iterations: number,
  outcome: 'success' | 'failure' | 'abandoned'
): TraceRecord {
  return {
    ts: new Date().toISOString(),
    waypoint_id: `wp_${goal.replace(/\s/g, '_')}`,
    goal,
    strategy: 'engineer',
    parent: null,
    outcome,
    checkpoint_sha: null,
    iterations_used: iterations,
    tokens_consumed: { input: 0, output: 0 },
    verify_result: {},
    fail_reason: null,
    diff_summary: null,
  };
}
