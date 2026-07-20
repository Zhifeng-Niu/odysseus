import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendExploration,
  loadRecentExplorationsSync,
  joinWithTraceOutcomes,
  formatExplorationsMarkdown,
  DEFAULT_EXPLORATION_LIMIT,
  type ExplorationRecord,
} from '../../src/cerebellum/exploration-log.js';
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

describe('exploration-log', () => {
  let workdir: string;
  let path: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-exploration-'));
    path = join(workdir, 'explorations.jsonl');
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  describe('appendExploration', () => {
    test('writes a single line and returns the record', async () => {
      const written = await appendExploration(path, {
        goal: 'add timing to dream() in dreamer.ts',
        origin: 'curiosity',
        priority: 80,
      });
      expect(written.id).toMatch(/^expl_[0-9a-f]+$/);
      expect(written.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(written.goal).toBe('add timing to dream() in dreamer.ts');
      expect(written.origin).toBe('curiosity');
      expect(written.priority).toBe(80);
      expect(written.voyage_id).toBeUndefined();
    });

    test('forwards voyage_id when provided', async () => {
      const written = await appendExploration(path, {
        goal: 'x',
        origin: 'curiosity',
        priority: 90,
        voyage_id: 'voy_abc',
      });
      expect(written.voyage_id).toBe('voy_abc');
    });

    test('accepts explicit id and ts (for test determinism)', async () => {
      const written = await appendExploration(path, {
        id: 'expl_pinned',
        ts: '2020-01-01T00:00:00Z',
        goal: 'x',
        origin: 'curiosity',
        priority: 90,
      });
      expect(written.id).toBe('expl_pinned');
      expect(written.ts).toBe('2020-01-01T00:00:00Z');
    });

    test('creates parent directory when missing', async () => {
      const nestedPath = join(workdir, 'nested', 'dir', 'explorations.jsonl');
      const written = await appendExploration(nestedPath, {
        goal: 'x',
        origin: 'curiosity',
        priority: 90,
      });
      expect(written.id).toMatch(/^expl_/);
      // Reader can find it (file was created).
      const loaded = loadRecentExplorationsSync(nestedPath);
      expect(loaded.length).toBe(1);
    });
  });

  describe('loadRecentExplorationsSync', () => {
    test('returns [] for missing file (graceful)', () => {
      const loaded = loadRecentExplorationsSync(join(workdir, 'missing.jsonl'));
      expect(loaded).toEqual([]);
    });

    test('returns records in reverse-chronological order', async () => {
      await writeFile(
        path,
        [
          JSON.stringify(record({ id: 'expl_a', goal: 'old', ts: '2026-07-19T10:00:00Z' })),
          JSON.stringify(record({ id: 'expl_b', goal: 'mid', ts: '2026-07-20T10:00:00Z' })),
          JSON.stringify(record({ id: 'expl_c', goal: 'new', ts: '2026-07-21T10:00:00Z' })),
        ].join('\n') + '\n',
      );

      const loaded = loadRecentExplorationsSync(path);
      expect(loaded.map((r) => r.id)).toEqual(['expl_c', 'expl_b', 'expl_a']);
    });

    test('caps at max', async () => {
      const lines: string[] = [];
      for (let i = 0; i < 10; i++) {
        lines.push(
          JSON.stringify(
            record({ id: `expl_${i}`, goal: `g${i}`, ts: `2026-07-${10 + i}T10:00:00Z` }),
          ),
        );
      }
      await writeFile(path, lines.join('\n') + '\n');

      const loaded = loadRecentExplorationsSync(path, 3);
      expect(loaded.length).toBe(3);
      // Most recent 3 (highest ts).
      expect(loaded.map((r) => r.id)).toEqual(['expl_9', 'expl_8', 'expl_7']);
    });

    test('DEFAULT_EXPLORATION_LIMIT is 8', () => {
      expect(DEFAULT_EXPLORATION_LIMIT).toBe(8);
    });

    test('skips malformed lines, keeps valid ones', async () => {
      await writeFile(
        path,
        [
          'not valid json',
          JSON.stringify(record({ id: 'expl_ok', goal: 'ok' })),
          '{ broken:',
          JSON.stringify(record({ id: 'expl_ok2', goal: 'ok2', ts: '2026-07-22T00:00:00Z' })),
        ].join('\n') + '\n',
      );

      const loaded = loadRecentExplorationsSync(path);
      expect(loaded.map((r) => r.id)).toEqual(['expl_ok2', 'expl_ok']);
    });

    test('empty file returns []', async () => {
      await writeFile(path, '');
      expect(loadRecentExplorationsSync(path)).toEqual([]);
    });
  });

  describe('joinWithTraceOutcomes', () => {
    test('returns null outcome when goal has no matching trace record', () => {
      const outcomes = joinWithTraceOutcomes(
        [record({ id: 'expl_1', goal: 'add retry logic to llm provider' })],
        [],
      );
      expect(outcomes.length).toBe(1);
      expect(outcomes[0]!.traceOutcome).toBeNull();
      expect(outcomes[0]!.traceOutcomeAt).toBeNull();
      expect(outcomes[0]!.traceFailReason).toBeNull();
    });

    test('matches by exact goal text', () => {
      const outcomes = joinWithTraceOutcomes(
        [record({ id: 'expl_1', goal: 'add retry logic to llm provider' })],
        [
          traceRecord({
            waypoint_id: 'wp_1',
            goal: 'add retry logic to llm provider',
            outcome: 'success',
            ts: '2026-07-20T10:00:00Z',
          }),
        ],
      );
      expect(outcomes[0]!.traceOutcome).toBe('success');
      expect(outcomes[0]!.traceOutcomeAt).toBe('2026-07-20T10:00:00Z');
    });

    test('matches by NORMALIZED goal (case + punctuation tolerant)', () => {
      // The same logical goal phrased differently between exploration and trace.
      const outcomes = joinWithTraceOutcomes(
        [record({ id: 'expl_1', goal: 'Add Retry Logic to LLM Provider!' })],
        [
          traceRecord({
            waypoint_id: 'wp_1',
            goal: 'add retry logic to llm provider',
            outcome: 'failure',
            fail_reason: 'tsc errored',
            ts: '2026-07-20T10:00:00Z',
          }),
        ],
      );
      expect(outcomes[0]!.traceOutcome).toBe('failure');
      expect(outcomes[0]!.traceFailReason).toBe('tsc errored');
    });

    test('picks LATEST trace record when multiple match', () => {
      const outcomes = joinWithTraceOutcomes(
        [record({ id: 'expl_1', goal: 'add retry logic to llm provider' })],
        [
          traceRecord({
            waypoint_id: 'wp_1',
            goal: 'add retry logic to llm provider',
            outcome: 'failure',
            ts: '2026-07-19T10:00:00Z',
          }),
          traceRecord({
            waypoint_id: 'wp_2',
            goal: 'add retry logic to llm provider',
            outcome: 'success',
            ts: '2026-07-21T10:00:00Z',
          }),
        ],
      );
      // Latest (by ts) wins — success overrode earlier failure.
      expect(outcomes[0]!.traceOutcome).toBe('success');
      expect(outcomes[0]!.traceOutcomeAt).toBe('2026-07-21T10:00:00Z');
    });

    test('preserves input order (caller controls sort)', () => {
      const outcomes = joinWithTraceOutcomes(
        [
          record({ id: 'expl_a', goal: 'aaa', ts: '2026-07-21T00:00:00Z' }),
          record({ id: 'expl_b', goal: 'bbb', ts: '2026-07-20T00:00:00Z' }),
        ],
        [],
      );
      expect(outcomes.map((o) => o.exploration.id)).toEqual(['expl_a', 'expl_b']);
    });

    test('empty explorations input returns empty output', () => {
      expect(joinWithTraceOutcomes([], [])).toEqual([]);
    });

    test('empty-trace goals are skipped during indexing', () => {
      // Should not throw on a trace record with empty goal.
      const outcomes = joinWithTraceOutcomes(
        [record({ id: 'expl_1', goal: 'real goal' })],
        [traceRecord({ waypoint_id: 'wp_empty', goal: '' })],
      );
      expect(outcomes[0]!.traceOutcome).toBeNull();
    });
  });

  describe('formatExplorationsMarkdown', () => {
    test('returns empty string for empty input', () => {
      expect(formatExplorationsMarkdown([])).toBe('');
    });

    test('renders header and one bullet per exploration', () => {
      const md = formatExplorationsMarkdown([
        {
          exploration: record({ id: 'expl_1', goal: 'add retry logic', priority: 80, ts: '2026-07-21T00:00:00Z' }),
          traceOutcome: 'success',
          traceOutcomeAt: '2026-07-21T10:00:00Z',
          traceFailReason: null,
        },
      ]);
      expect(md).toContain('### Recent explorations');
      expect(md).toContain('proposed→success');
      expect(md).toContain('add retry logic');
      expect(md).toContain('prio 80');
    });

    test('renders "proposed, never executed" when outcome is null', () => {
      const md = formatExplorationsMarkdown([
        {
          exploration: record({ id: 'expl_1', goal: 'add thing', priority: 90, ts: new Date().toISOString() }),
          traceOutcome: null,
          traceOutcomeAt: null,
          traceFailReason: null,
        },
      ]);
      expect(md).toContain('proposed, never executed');
    });

    test('includes FAIL reason only for failure outcomes', () => {
      const md = formatExplorationsMarkdown([
        {
          exploration: record({ id: 'expl_1', goal: 'broken thing', priority: 80, ts: '2026-07-21T00:00:00Z' }),
          traceOutcome: 'failure',
          traceOutcomeAt: '2026-07-21T10:00:00Z',
          traceFailReason: 'tsc errored badly',
        },
        {
          exploration: record({ id: 'expl_2', goal: 'succeeded thing', priority: 80, ts: '2026-07-21T00:00:00Z' }),
          traceOutcome: 'success',
          traceOutcomeAt: '2026-07-21T10:00:00Z',
          // Even though traceFailReason is provided, success outcome should
          // not show a FAIL marker.
          traceFailReason: 'should not show',
        },
      ]);
      expect(md).toContain('FAIL: tsc errored badly');
      // Successful items do not render a FAIL marker.
      const successLine = md.split('\n').find((l) => l.includes('succeeded thing'));
      expect(successLine).toBeDefined();
      expect(successLine!.includes('FAIL')).toBe(false);
    });

    test('truncates long goals', () => {
      const longGoal = 'a'.repeat(300);
      const md = formatExplorationsMarkdown([
        {
          exploration: record({ id: 'expl_1', goal: longGoal, priority: 80, ts: new Date().toISOString() }),
          traceOutcome: null,
          traceOutcomeAt: null,
          traceFailReason: null,
        },
      ]);
      expect(md).toContain('…');
      expect(md).not.toContain(longGoal);
    });

    test('renders relative age labels', () => {
      const now = Date.now();
      const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
      const md = formatExplorationsMarkdown([
        {
          exploration: record({ id: 'expl_1', goal: 'x', priority: 80, ts: twoHoursAgo }),
          traceOutcome: null,
          traceOutcomeAt: null,
          traceFailReason: null,
        },
      ]);
      expect(md).toMatch(/\d+h ago/);
    });
  });
});
