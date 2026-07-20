import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadRecentVoyageSummaries,
  loadRecentVoyageSummariesSync,
  formatVoyageSummariesMarkdown,
  DEFAULT_VOYAGE_SUMMARY_LIMIT,
  type VoyageSummary,
} from '../../src/cerebellum/voyage-log.js';
import type { TraceRecord } from '../../src/trace/jsonl.js';

function record(over: Partial<TraceRecord> & { waypoint_id: string }): TraceRecord {
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

function line(r: TraceRecord): string {
  return JSON.stringify(r);
}

describe('voyage-log', () => {
  let workdir: string;
  let tracePath: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-voyage-log-'));
    await mkdir(join(workdir, '.odysseus'), { recursive: true });
    tracePath = join(workdir, '.odysseus', 'trace.jsonl');
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('empty trace returns no summaries (async)', async () => {
    const summaries = await loadRecentVoyageSummaries(tracePath);
    expect(summaries).toEqual([]);
  });

  test('empty trace returns no summaries (sync)', () => {
    const summaries = loadRecentVoyageSummariesSync(tracePath);
    expect(summaries).toEqual([]);
  });

  test('missing trace file returns no summaries (sync, no throw)', () => {
    const summaries = loadRecentVoyageSummariesSync(join(workdir, 'missing.jsonl'));
    expect(summaries).toEqual([]);
  });

  test('single voyage with multiple waypoints aggregates correctly', async () => {
    await writeFile(
      tracePath,
      [
        line(record({ waypoint_id: 'wp_1', voyage_id: 'voy_a', goal: 'first', outcome: 'success', iterations_used: 3, ts: '2026-07-21T10:00:00Z' })),
        line(record({ waypoint_id: 'wp_2', voyage_id: 'voy_a', goal: 'second', outcome: 'failure', fail_reason: 'tsc error', iterations_used: 5, ts: '2026-07-21T10:05:00Z' })),
        line(record({ waypoint_id: 'wp_3', voyage_id: 'voy_a', goal: 'third', outcome: 'abandoned', iterations_used: 2, ts: '2026-07-21T10:10:00Z' })),
      ].join('\n') + '\n'
    );

    const summaries = await loadRecentVoyageSummaries(tracePath);
    expect(summaries.length).toBe(1);
    const s = summaries[0]!;
    expect(s.voyageId).toBe('voy_a');
    expect(s.waypoints.length).toBe(3);
    expect(s.successCount).toBe(1);
    expect(s.failureCount).toBe(1);
    expect(s.abandonedCount).toBe(1);
    expect(s.totalIterations).toBe(10);
    expect(s.startedAt).toBe('2026-07-21T10:00:00Z');
    expect(s.endedAt).toBe('2026-07-21T10:10:00Z');
  });

  test('multiple voyages return in reverse-chronological order', async () => {
    await writeFile(
      tracePath,
      [
        line(record({ waypoint_id: 'wp_1', voyage_id: 'voy_old', goal: 'old work', ts: '2026-07-20T10:00:00Z' })),
        line(record({ waypoint_id: 'wp_2', voyage_id: 'voy_mid', goal: 'mid work', ts: '2026-07-21T10:00:00Z' })),
        line(record({ waypoint_id: 'wp_3', voyage_id: 'voy_new', goal: 'new work', ts: '2026-07-22T10:00:00Z' })),
      ].join('\n') + '\n'
    );

    const summaries = await loadRecentVoyageSummaries(tracePath);
    expect(summaries.map((s) => s.voyageId)).toEqual(['voy_new', 'voy_mid', 'voy_old']);
  });

  test('maxSummaries caps the result count', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 10; i++) {
      lines.push(line(record({
        waypoint_id: `wp_${i}`,
        voyage_id: `voy_${i}`,
        ts: `2026-07-${20 - i}T10:00:00Z`,
      })));
    }
    await writeFile(tracePath, lines.join('\n') + '\n');

    const summaries = await loadRecentVoyageSummaries(tracePath, 3);
    expect(summaries.length).toBe(3);
    // Most recent 3 by endedAt
    expect(summaries.map((s) => s.voyageId)).toEqual(['voy_0', 'voy_1', 'voy_2']);
  });

  test('DEFAULT_VOYAGE_SUMMARY_LIMIT is 5', () => {
    expect(DEFAULT_VOYAGE_SUMMARY_LIMIT).toBe(5);
  });

  test('records without voyage_id bucket into voy_legacy', async () => {
    await writeFile(
      tracePath,
      [
        // Old records (pre-Iteration 10) without voyage_id
        line(record({ waypoint_id: 'wp_legacy_1', goal: 'legacy work', ts: '2026-07-19T10:00:00Z' })),
        line(record({ waypoint_id: 'wp_legacy_2', goal: 'legacy work 2', ts: '2026-07-19T11:00:00Z' })),
        // New records with voyage_id
        line(record({ waypoint_id: 'wp_new', voyage_id: 'voy_new', goal: 'new work', ts: '2026-07-22T10:00:00Z' })),
      ].join('\n') + '\n'
    );

    const summaries = await loadRecentVoyageSummaries(tracePath);
    expect(summaries.length).toBe(2);
    expect(summaries[0]!.voyageId).toBe('voy_new');
    expect(summaries[1]!.voyageId).toBe('voy_legacy');
    expect(summaries[1]!.waypoints.length).toBe(2);
  });

  test('sync version matches async version', async () => {
    await writeFile(
      tracePath,
      [
        line(record({ waypoint_id: 'wp_1', voyage_id: 'voy_a', goal: 'first', ts: '2026-07-21T10:00:00Z' })),
        line(record({ waypoint_id: 'wp_2', voyage_id: 'voy_b', goal: 'second', ts: '2026-07-22T10:00:00Z' })),
      ].join('\n') + '\n'
    );

    const asyncResult = await loadRecentVoyageSummaries(tracePath);
    const syncResult = loadRecentVoyageSummariesSync(tracePath);
    expect(syncResult).toEqual(asyncResult);
  });

  test('malformed lines are skipped, valid ones still parsed', () => {
    return writeFile(tracePath, [
      'not valid json',
      line(record({ waypoint_id: 'wp_1', voyage_id: 'voy_a' })),
      '{ broken:',
      line(record({ waypoint_id: 'wp_2', voyage_id: 'voy_a' })),
    ].join('\n') + '\n').then(async () => {
      const summaries = await loadRecentVoyageSummaries(tracePath);
      expect(summaries.length).toBe(1);
      expect(summaries[0]!.waypoints.length).toBe(2);
    });
  });

  describe('formatVoyageSummariesMarkdown', () => {
    test('empty list returns empty string', () => {
      expect(formatVoyageSummariesMarkdown([])).toBe('');
    });

    test('single summary renders voyage header and waypoints', () => {
      const summaries: VoyageSummary[] = [
        {
          voyageId: 'voy_abc',
          startedAt: '2026-07-21T10:00:00Z',
          endedAt: '2026-07-21T10:05:00Z',
          waypoints: [
            { id: 'wp_1', goal: 'add retry to llm provider', outcome: 'success', failReason: null, iterationsUsed: 3, ts: '2026-07-21T10:00:00Z' },
            { id: 'wp_2', goal: 'refactor cerebellum orchestrator', outcome: 'failure', failReason: 'tsc errored on strict mode', iterationsUsed: 5, ts: '2026-07-21T10:05:00Z' },
          ],
          successCount: 1,
          failureCount: 1,
          abandonedCount: 0,
          totalIterations: 8,
        },
      ];
      const md = formatVoyageSummariesMarkdown(summaries);
      expect(md).toContain('## Recent voyages');
      expect(md).toContain('### voy_abc (2 waypoints: 1 success, 1 failure)');
      expect(md).toContain('[success] add retry to llm provider (3 iter)');
      expect(md).toContain('[failure] refactor cerebellum orchestrator (5 iter)');
      expect(md).toContain('FAIL: tsc errored on strict mode');
    });

    test('multiple summaries separated by blank lines', () => {
      const summaries: VoyageSummary[] = [
        {
          voyageId: 'voy_a',
          startedAt: '2026-07-21T10:00:00Z',
          endedAt: '2026-07-21T10:05:00Z',
          waypoints: [{ id: 'wp_1', goal: 'a', outcome: 'success', failReason: null, iterationsUsed: 1, ts: '2026-07-21T10:00:00Z' }],
          successCount: 1, failureCount: 0, abandonedCount: 0, totalIterations: 1,
        },
        {
          voyageId: 'voy_b',
          startedAt: '2026-07-20T10:00:00Z',
          endedAt: '2026-07-20T10:05:00Z',
          waypoints: [{ id: 'wp_2', goal: 'b', outcome: 'failure', failReason: 'oops', iterationsUsed: 1, ts: '2026-07-20T10:00:00Z' }],
          successCount: 0, failureCount: 1, abandonedCount: 0, totalIterations: 1,
        },
      ];
      const md = formatVoyageSummariesMarkdown(summaries);
      // Both voyage headers present
      expect(md).toContain('### voy_a');
      expect(md).toContain('### voy_b');
    });

    test('long goals and fail reasons are truncated', () => {
      const longGoal = 'a'.repeat(200);
      const longFail = 'f'.repeat(200);
      const summaries: VoyageSummary[] = [
        {
          voyageId: 'voy_x',
          startedAt: '2026-07-21T10:00:00Z',
          endedAt: '2026-07-21T10:05:00Z',
          waypoints: [{ id: 'wp_1', goal: longGoal, outcome: 'failure', failReason: longFail, iterationsUsed: 1, ts: '2026-07-21T10:00:00Z' }],
          successCount: 0, failureCount: 1, abandonedCount: 0, totalIterations: 1,
        },
      ];
      const md = formatVoyageSummariesMarkdown(summaries);
      // Truncation marker present (the ellipsis char)
      expect(md).toContain('…');
      // No line exceeds a reasonable length (header + goal + fail_reason)
      // Spot check: original 200-char goal is not present verbatim
      expect(md).not.toContain(longGoal);
      expect(md).not.toContain(longFail);
    });
  });
});
