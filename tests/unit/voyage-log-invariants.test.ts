import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_VOYAGE_SUMMARY_LIMIT,
  formatVoyageSummariesMarkdown,
  loadRecentVoyageSummaries,
  loadRecentVoyageSummariesSync,
  type VoyageSummary,
  type VoyageWaypoint,
} from '../../src/cerebellum/voyage-log.js';
import type { TraceRecord } from '../../src/trace/jsonl.js';

/**
 * voyage-log — STRUCTURAL INVARIANTS for the cross-voyage memory layer.
 *
 * voyage-log.test.ts (242 lines, 10 tests, single describe block) covers
 * the happy path. This file pins the load-bearing contracts that, if
 * silently regressed, would either:
 *   - Mis-report voyage history to the agent (bad grouping, bad sort,
 *     bad truncation → wrong waypoints shown in the system prompt)
 *   - Change the markdown shape that strategy-prompt depends on
 *   - Break the legacy `voy_legacy` bucketing for pre-2026-07-21 traces
 *
 * Contracts pinned here:
 *
 *   - DEFAULT_VOYAGE_SUMMARY_LIMIT === 5. Changing this silently widens
 *     or narrows the agent's horizon.
 *
 *   - `voy_legacy` BUCKETING: records with undefined voyage_id are all
 *     bucketed into ONE synthetic voyage named `voy_legacy`. Not per-
 *     record, not skipped — grouped so old traces still render.
 *
 *   - INSERTION-ORDER PRESERVATION within a bucket. Records appear in
 *     the order they were encountered in the trace (chronological for
 *     an append-only log).
 *
 *   - REVERSE-CHRON SORT by endedAt (string compare, descending). The
 *     voyage that ended most recently appears first.
 *
 *   - summarize COUNTS exactly 3 outcome types (success/failure/abandoned).
 *     Unknown outcomes contribute to none of the counts.
 *
 *   - summarize TS BOUNDS: startedAt = min ts, endedAt = max ts (via
 *     array sort). Empty records group never happens (caller filters).
 *
 *   - totalIterations sums iterations_used (NOT ?? 0 — TraceRecord
 *     requires the field, but runtime tolerance is via Number coercion).
 *
 *   - TRUNCATE OFF-BY-ONE: when input.length > max, result is
 *     `slice(0, max - 1) + '…'`. Total length is exactly `max`, NEVER
 *     max+1. At length === max, no truncation (boundary inclusive).
 *
 *   - FORMAT contract:
 *     * Empty summaries → empty string (caller can skip section)
 *     * Header `## Recent voyages`
 *     * Per-voyage `### ${voyageId} (${waypoints.length} waypoints: ${countsLabel})`
 *     * countsLabel: comma-joined non-zero counts, OR `no waypoints` if all 0
 *     * Per-waypoint: `- [${outcome}] ${truncated goal} (${N} iter)${fail?}`
 *     * fail?: ` — FAIL: ${truncated failReason}` only when failReason !== null
 *     * Goal truncated to 160; failReason to 120
 *     * Sections joined with `\n\n`
 *
 *   - Purity: input arrays not mutated.
 *
 *   - Sync vs async parity: both build the same summaries from the same
 *     records. Sync tolerates missing file (returns []).
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
// DEFAULT_VOYAGE_SUMMARY_LIMIT — exact value
// ---------------------------------------------------------------------------

describe('DEFAULT_VOYAGE_SUMMARY_LIMIT — exact value', () => {
  test('is exactly 5', () => {
    expect(DEFAULT_VOYAGE_SUMMARY_LIMIT).toBe(5);
  });

  test('is a positive integer', () => {
    expect(Number.isInteger(DEFAULT_VOYAGE_SUMMARY_LIMIT)).toBe(true);
    expect(DEFAULT_VOYAGE_SUMMARY_LIMIT).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// loadRecentVoyageSummaries — empty input
// ---------------------------------------------------------------------------

describe('loadRecentVoyageSummaries — empty records', () => {
  test('returns empty array for no records', async () => {
    const summaries = await loadRecentVoyageSummaries('/nonexistent/path.jsonl');
    expect(summaries).toEqual([]);
  });

  test('sync version returns empty array for missing file', () => {
    const summaries = loadRecentVoyageSummariesSync('/nonexistent/path.jsonl');
    expect(summaries).toEqual([]);
  });

  test('sync version returns empty array for unreadable path', () => {
    // Path is a directory — readFileSync throws EISDIR. Should be caught.
    const summaries = loadRecentVoyageSummariesSync('/tmp');
    expect(summaries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// We test buildSummaries indirectly via the public API by writing
// a temp file, but since loadRecentVoyageSummaries reads from disk,
// we test formatVoyageSummariesMarkdown (pure) for the structural
// contracts and rely on round-trip for the rest.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// formatVoyageSummariesMarkdown — empty input
// ---------------------------------------------------------------------------

describe('formatVoyageSummariesMarkdown — empty input', () => {
  test('returns empty string for empty summaries', () => {
    expect(formatVoyageSummariesMarkdown([])).toBe('');
  });

  test('empty string has no header', () => {
    expect(formatVoyageSummariesMarkdown([])).not.toContain('## Recent voyages');
  });
});

// ---------------------------------------------------------------------------
// formatVoyageSummariesMarkdown — header
// ---------------------------------------------------------------------------

describe('formatVoyageSummariesMarkdown — header', () => {
  test('single voyage → header `## Recent voyages` first line', () => {
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'voy_a',
        startedAt: '2026-07-21T00:00:00Z',
        endedAt: '2026-07-21T01:00:00Z',
        waypoints: [],
        successCount: 0,
        failureCount: 0,
        abandonedCount: 0,
        totalIterations: 0,
      },
    ]);
    expect(md.split('\n')[0]).toBe('## Recent voyages');
  });

  test('multiple voyages → header appears exactly once', () => {
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'voy_a',
        startedAt: '',
        endedAt: '',
        waypoints: [],
        successCount: 0,
        failureCount: 0,
        abandonedCount: 0,
        totalIterations: 0,
      },
      {
        voyageId: 'voy_b',
        startedAt: '',
        endedAt: '',
        waypoints: [],
        successCount: 0,
        failureCount: 0,
        abandonedCount: 0,
        totalIterations: 0,
      },
    ]);
    const headerCount = (md.match(/## Recent voyages/g) || []).length;
    expect(headerCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// formatVoyageSummariesMarkdown — per-voyage section header
// ---------------------------------------------------------------------------

describe('formatVoyageSummariesMarkdown — voyage section header', () => {
  test('format: `### ${voyageId} (${count} waypoints: ${countsLabel})`', () => {
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'voy_test',
        startedAt: '',
        endedAt: '',
        waypoints: [
          { id: 'a', goal: 'g', outcome: 'success', failReason: null, iterationsUsed: 1, ts: '' },
          { id: 'b', goal: 'g', outcome: 'success', failReason: null, iterationsUsed: 1, ts: '' },
          { id: 'c', goal: 'g', outcome: 'failure', failReason: null, iterationsUsed: 1, ts: '' },
        ],
        successCount: 2,
        failureCount: 1,
        abandonedCount: 0,
        totalIterations: 10,
      },
    ]);
    expect(md).toContain('### voy_test (3 waypoints: 2 success, 1 failure)');
  });

  test('waypoints count comes from .length (NOT successCount + failureCount + abandonedCount)', () => {
    // This pins that the count in the header is the raw waypoints array
    // length, not the sum of known outcomes. Diverges when there are
    // unknown-outcome waypoints.
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'voy_x',
        startedAt: '',
        endedAt: '',
        waypoints: [
          { id: 'a', goal: 'g', outcome: 'success', failReason: null, iterationsUsed: 1, ts: '' },
          { id: 'b', goal: 'g', outcome: 'success', failReason: null, iterationsUsed: 1, ts: '' },
          { id: 'c', goal: 'g', outcome: 'success', failReason: null, iterationsUsed: 1, ts: '' },
        ],
        successCount: 1,
        failureCount: 0,
        abandonedCount: 0,
        totalIterations: 3,
      },
    ]);
    expect(md).toContain('(3 waypoints:');
    expect(md).toContain('1 success');
  });

  test('countsLabel omits zero counts', () => {
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'v',
        startedAt: '',
        endedAt: '',
        waypoints: [],
        successCount: 5,
        failureCount: 0,
        abandonedCount: 0,
        totalIterations: 0,
      },
    ]);
    expect(md).toContain('5 success');
    expect(md).not.toContain('0 failure');
    expect(md).not.toContain('0 abandoned');
  });

  test('countsLabel is comma-joined when multiple non-zero counts', () => {
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'v',
        startedAt: '',
        endedAt: '',
        waypoints: [],
        successCount: 2,
        failureCount: 3,
        abandonedCount: 1,
        totalIterations: 0,
      },
    ]);
    expect(md).toContain('2 success, 3 failure, 1 abandoned');
  });

  test('countsLabel is `no waypoints` when all counts are 0', () => {
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'v',
        startedAt: '',
        endedAt: '',
        waypoints: [],
        successCount: 0,
        failureCount: 0,
        abandonedCount: 0,
        totalIterations: 0,
      },
    ]);
    expect(md).toContain('no waypoints');
  });

  test('section order matches input order (no internal sort)', () => {
    const md = formatVoyageSummariesMarkdown([
      { voyageId: 'voy_first', startedAt: '', endedAt: '', waypoints: [], successCount: 0, failureCount: 0, abandonedCount: 0, totalIterations: 0 },
      { voyageId: 'voy_second', startedAt: '', endedAt: '', waypoints: [], successCount: 0, failureCount: 0, abandonedCount: 0, totalIterations: 0 },
    ]);
    const firstIdx = md.indexOf('voy_first');
    const secondIdx = md.indexOf('voy_second');
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(-1);
    expect(firstIdx).toBeLessThan(secondIdx);
  });
});

// ---------------------------------------------------------------------------
// formatVoyageSummariesMarkdown — per-waypoint line
// ---------------------------------------------------------------------------

describe('formatVoyageSummariesMarkdown — waypoint line format', () => {
  test('basic: `- [${outcome}] ${goal} (${iter} iter)`', () => {
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'v',
        startedAt: '',
        endedAt: '',
        waypoints: [
          {
            id: 'wp_a',
            goal: 'fix typo',
            outcome: 'success',
            failReason: null,
            iterationsUsed: 2,
            ts: '',
          },
        ],
        successCount: 1,
        failureCount: 0,
        abandonedCount: 0,
        totalIterations: 2,
      },
    ]);
    expect(md).toContain('- [success] fix typo (2 iter)');
  });

  test('iterations shown even when 0', () => {
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'v',
        startedAt: '',
        endedAt: '',
        waypoints: [
          {
            id: 'wp_a',
            goal: 'g',
            outcome: 'success',
            failReason: null,
            iterationsUsed: 0,
            ts: '',
          },
        ],
        successCount: 1,
        failureCount: 0,
        abandonedCount: 0,
        totalIterations: 0,
      },
    ]);
    expect(md).toContain('(0 iter)');
  });

  test('fail suffix ` — FAIL: ${truncated}` only when failReason !== null', () => {
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'v',
        startedAt: '',
        endedAt: '',
        waypoints: [
          {
            id: 'wp_a',
            goal: 'g',
            outcome: 'failure',
            failReason: 'tsc errored',
            iterationsUsed: 1,
            ts: '',
          },
        ],
        successCount: 0,
        failureCount: 1,
        abandonedCount: 0,
        totalIterations: 1,
      },
    ]);
    expect(md).toContain(' — FAIL: tsc errored');
  });

  test('no fail suffix when failReason is null (even on failure outcome)', () => {
    // Outcome=failure but failReason=null is weird but possible. Format
    // should NOT add the FAIL suffix.
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'v',
        startedAt: '',
        endedAt: '',
        waypoints: [
          {
            id: 'wp_a',
            goal: 'g',
            outcome: 'failure',
            failReason: null,
            iterationsUsed: 1,
            ts: '',
          },
        ],
        successCount: 0,
        failureCount: 1,
        abandonedCount: 0,
        totalIterations: 1,
      },
    ]);
    expect(md).not.toContain('FAIL:');
  });

  test('fail suffix uses EM-DASH ` — ` (U+2014 + spaces), not hyphen', () => {
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'v',
        startedAt: '',
        endedAt: '',
        waypoints: [
          {
            id: 'wp_a',
            goal: 'g',
            outcome: 'failure',
            failReason: 'X',
            iterationsUsed: 1,
            ts: '',
          },
        ],
        successCount: 0,
        failureCount: 1,
        abandonedCount: 0,
        totalIterations: 1,
      },
    ]);
    expect(md).toContain(' — FAIL:'); // space + em-dash + space
    expect(md).not.toContain(' - FAIL:'); // ASCII hyphen-space-space pattern
  });
});

// ---------------------------------------------------------------------------
// formatVoyageSummariesMarkdown — truncation (goal=160, failReason=120)
// ---------------------------------------------------------------------------

describe('formatVoyageSummariesMarkdown — goal truncation at 160', () => {
  test('goal of exactly 160 chars → NOT truncated (boundary inclusive)', () => {
    const goal = 'g'.repeat(160);
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'v',
        startedAt: '',
        endedAt: '',
        waypoints: [
          { id: 'w', goal, outcome: 'success', failReason: null, iterationsUsed: 1, ts: '' },
        ],
        successCount: 1,
        failureCount: 0,
        abandonedCount: 0,
        totalIterations: 1,
      },
    ]);
    expect(md).toContain(goal);
    expect(md).not.toContain('…');
  });

  test('goal of 161 chars → truncated to 159 + ellipsis (total 160)', () => {
    // truncate(s, 160) for s.length > 160: s.slice(0, 159) + '…'
    const goal = 'g'.repeat(161);
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'v',
        startedAt: '',
        endedAt: '',
        waypoints: [
          { id: 'w', goal, outcome: 'success', failReason: null, iterationsUsed: 1, ts: '' },
        ],
        successCount: 1,
        failureCount: 0,
        abandonedCount: 0,
        totalIterations: 1,
      },
    ]);
    expect(md).toContain('g'.repeat(159) + '…');
    expect(md).not.toContain('g'.repeat(161));
  });

  test('goal of 200 chars → still truncated to 159 + ellipsis', () => {
    const goal = 'x'.repeat(200);
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'v',
        startedAt: '',
        endedAt: '',
        waypoints: [
          { id: 'w', goal, outcome: 'success', failReason: null, iterationsUsed: 1, ts: '' },
        ],
        successCount: 1,
        failureCount: 0,
        abandonedCount: 0,
        totalIterations: 1,
      },
    ]);
    expect(md).toContain('x'.repeat(159) + '…');
  });
});

describe('formatVoyageSummariesMarkdown — failReason truncation at 120', () => {
  test('failReason of exactly 120 chars → NOT truncated', () => {
    const reason = 'r'.repeat(120);
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'v',
        startedAt: '',
        endedAt: '',
        waypoints: [
          { id: 'w', goal: 'g', outcome: 'failure', failReason: reason, iterationsUsed: 1, ts: '' },
        ],
        successCount: 0,
        failureCount: 1,
        abandonedCount: 0,
        totalIterations: 1,
      },
    ]);
    expect(md).toContain(reason);
  });

  test('failReason of 121 chars → truncated to 119 + ellipsis (total 120)', () => {
    const reason = 'r'.repeat(121);
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'v',
        startedAt: '',
        endedAt: '',
        waypoints: [
          { id: 'w', goal: 'g', outcome: 'failure', failReason: reason, iterationsUsed: 1, ts: '' },
        ],
        successCount: 0,
        failureCount: 1,
        abandonedCount: 0,
        totalIterations: 1,
      },
    ]);
    expect(md).toContain('r'.repeat(119) + '…');
  });

  test('truncate uses ELLIPSIS U+2026, not three dots', () => {
    const reason = 'r'.repeat(200);
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'v',
        startedAt: '',
        endedAt: '',
        waypoints: [
          { id: 'w', goal: 'g', outcome: 'failure', failReason: reason, iterationsUsed: 1, ts: '' },
        ],
        successCount: 0,
        failureCount: 1,
        abandonedCount: 0,
        totalIterations: 1,
      },
    ]);
    expect(md).toContain('…');
    expect(md).not.toContain('...');
  });
});

// ---------------------------------------------------------------------------
// formatVoyageSummariesMarkdown — section separator
// ---------------------------------------------------------------------------

describe('formatVoyageSummariesMarkdown — section separator', () => {
  test('voyages separated by `\\n\\n`', () => {
    const md = formatVoyageSummariesMarkdown([
      { voyageId: 'v1', startedAt: '', endedAt: '', waypoints: [], successCount: 0, failureCount: 0, abandonedCount: 0, totalIterations: 0 },
      { voyageId: 'v2', startedAt: '', endedAt: '', waypoints: [], successCount: 0, failureCount: 0, abandonedCount: 0, totalIterations: 0 },
    ]);
    expect(md).toContain('### v1 (0 waypoints: no waypoints)\n\n### v2 (0 waypoints: no waypoints)');
  });

  test('header separated from first voyage by `\\n\\n`', () => {
    const md = formatVoyageSummariesMarkdown([
      { voyageId: 'v1', startedAt: '', endedAt: '', waypoints: [], successCount: 0, failureCount: 0, abandonedCount: 0, totalIterations: 0 },
    ]);
    expect(md).toContain('## Recent voyages\n\n### v1');
  });

  test('waypoints within a voyage joined by `\\n` (single newline)', () => {
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'v1',
        startedAt: '',
        endedAt: '',
        waypoints: [
          { id: 'a', goal: 'g1', outcome: 'success', failReason: null, iterationsUsed: 1, ts: '' },
          { id: 'b', goal: 'g2', outcome: 'success', failReason: null, iterationsUsed: 1, ts: '' },
        ],
        successCount: 2,
        failureCount: 0,
        abandonedCount: 0,
        totalIterations: 2,
      },
    ]);
    expect(md).toContain('[success] g1 (1 iter)\n- [success] g2 (1 iter)');
  });
});

// ---------------------------------------------------------------------------
// VoyageSummary type contracts
// ---------------------------------------------------------------------------

describe('VoyageSummary — type shape', () => {
  test('has exactly 8 own properties', () => {
    const summary: VoyageSummary = {
      voyageId: 'v',
      startedAt: '',
      endedAt: '',
      waypoints: [],
      successCount: 0,
      failureCount: 0,
      abandonedCount: 0,
      totalIterations: 0,
    };
    expect(Object.keys(summary).sort()).toEqual([
      'abandonedCount',
      'endedAt',
      'failureCount',
      'startedAt',
      'successCount',
      'totalIterations',
      'voyageId',
      'waypoints',
    ]);
  });

  test('VoyageWaypoint has exactly 6 own properties', () => {
    const wp: VoyageWaypoint = {
      id: 'wp',
      goal: 'g',
      outcome: 'success',
      failReason: null,
      iterationsUsed: 1,
      ts: '',
    };
    expect(Object.keys(wp).sort()).toEqual([
      'failReason',
      'goal',
      'id',
      'iterationsUsed',
      'outcome',
      'ts',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Round-trip — write temp file, load, verify structure
// ---------------------------------------------------------------------------

describe('loadRecentVoyageSummaries — round-trip', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'voyage-log-test-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('groups records by voyage_id', async () => {
    const records: TraceRecord[] = [
      makeRecord({ waypoint_id: 'wp_a', voyage_id: 'v1', ts: '2026-07-21T00:00:00Z' }),
      makeRecord({ waypoint_id: 'wp_b', voyage_id: 'v1', ts: '2026-07-21T01:00:00Z' }),
      makeRecord({ waypoint_id: 'wp_c', voyage_id: 'v2', ts: '2026-07-21T02:00:00Z' }),
    ];
    const tracePath = join(tmpDir, 'trace.jsonl');
    writeFileSync(tracePath, records.map((r) => JSON.stringify(r)).join('\n'));

    const summaries = await loadRecentVoyageSummaries(tracePath);
    expect(summaries.length).toBe(2);
    const v1 = summaries.find((s) => s.voyageId === 'v1');
    const v2 = summaries.find((s) => s.voyageId === 'v2');
    expect(v1?.waypoints.length).toBe(2);
    expect(v2?.waypoints.length).toBe(1);
  });

  test('records with undefined voyage_id go to `voy_legacy`', async () => {
    const records: TraceRecord[] = [
      makeRecord({ waypoint_id: 'wp_a', ts: '2026-07-21T00:00:00Z' }),
      makeRecord({ waypoint_id: 'wp_b', ts: '2026-07-21T01:00:00Z' }),
    ];
    // voyage_id is undefined in makeRecord default.
    const tracePath = join(tmpDir, 'trace.jsonl');
    writeFileSync(tracePath, records.map((r) => JSON.stringify(r)).join('\n'));

    const summaries = await loadRecentVoyageSummaries(tracePath);
    expect(summaries.length).toBe(1);
    expect(summaries[0]?.voyageId).toBe('voy_legacy');
    expect(summaries[0]?.waypoints.length).toBe(2);
  });

  test('`voy_legacy` records aggregate into ONE bucket (not per-record)', async () => {
    const records: TraceRecord[] = [
      makeRecord({ waypoint_id: 'wp_a', ts: '2026-07-21T00:00:00Z' }),
      makeRecord({ waypoint_id: 'wp_b', ts: '2026-07-21T01:00:00Z' }),
      makeRecord({ waypoint_id: 'wp_c', ts: '2026-07-21T02:00:00Z' }),
    ];
    const tracePath = join(tmpDir, 'trace.jsonl');
    writeFileSync(tracePath, records.map((r) => JSON.stringify(r)).join('\n'));

    const summaries = await loadRecentVoyageSummaries(tracePath);
    expect(summaries.length).toBe(1);
    expect(summaries[0]?.waypoints.length).toBe(3);
  });

  test('mixed: legacy + voyage_id records bucket separately', async () => {
    const records: TraceRecord[] = [
      makeRecord({ waypoint_id: 'wp_legacy', ts: '2026-07-20T00:00:00Z' }),
      makeRecord({ waypoint_id: 'wp_v1', voyage_id: 'v1', ts: '2026-07-21T00:00:00Z' }),
    ];
    const tracePath = join(tmpDir, 'trace.jsonl');
    writeFileSync(tracePath, records.map((r) => JSON.stringify(r)).join('\n'));

    const summaries = await loadRecentVoyageSummaries(tracePath);
    expect(summaries.length).toBe(2);
    const ids = summaries.map((s) => s.voyageId).sort();
    expect(ids).toEqual(['v1', 'voy_legacy']);
  });

  test('summaries sorted reverse-chron by endedAt', async () => {
    const records: TraceRecord[] = [
      makeRecord({ waypoint_id: 'wp_a', voyage_id: 'older', ts: '2026-07-01T00:00:00Z' }),
      makeRecord({ waypoint_id: 'wp_b', voyage_id: 'newer', ts: '2026-07-21T00:00:00Z' }),
      makeRecord({ waypoint_id: 'wp_c', voyage_id: 'middle', ts: '2026-07-10T00:00:00Z' }),
    ];
    const tracePath = join(tmpDir, 'trace.jsonl');
    writeFileSync(tracePath, records.map((r) => JSON.stringify(r)).join('\n'));

    const summaries = await loadRecentVoyageSummaries(tracePath);
    expect(summaries.map((s) => s.voyageId)).toEqual(['newer', 'middle', 'older']);
  });

  test('voyage summary counts outcomes correctly', async () => {
    const records: TraceRecord[] = [
      makeRecord({ waypoint_id: 'wp_a', voyage_id: 'v1', outcome: 'success', ts: '2026-07-21T00:00:00Z' }),
      makeRecord({ waypoint_id: 'wp_b', voyage_id: 'v1', outcome: 'failure', ts: '2026-07-21T01:00:00Z', fail_reason: 'X' }),
      makeRecord({ waypoint_id: 'wp_c', voyage_id: 'v1', outcome: 'abandoned', ts: '2026-07-21T02:00:00Z', fail_reason: 'Y' }),
    ];
    const tracePath = join(tmpDir, 'trace.jsonl');
    writeFileSync(tracePath, records.map((r) => JSON.stringify(r)).join('\n'));

    const summaries = await loadRecentVoyageSummaries(tracePath);
    const v1 = summaries[0]!;
    expect(v1.successCount).toBe(1);
    expect(v1.failureCount).toBe(1);
    expect(v1.abandonedCount).toBe(1);
  });

  test('voyage summary totalIterations sums iterations_used', async () => {
    const records: TraceRecord[] = [
      makeRecord({ waypoint_id: 'wp_a', voyage_id: 'v1', iterations_used: 3, ts: '2026-07-21T00:00:00Z' }),
      makeRecord({ waypoint_id: 'wp_b', voyage_id: 'v1', iterations_used: 5, ts: '2026-07-21T01:00:00Z' }),
    ];
    const tracePath = join(tmpDir, 'trace.jsonl');
    writeFileSync(tracePath, records.map((r) => JSON.stringify(r)).join('\n'));

    const summaries = await loadRecentVoyageSummaries(tracePath);
    expect(summaries[0]?.totalIterations).toBe(8);
  });

  test('startedAt = min ts, endedAt = max ts within voyage', async () => {
    const records: TraceRecord[] = [
      makeRecord({ waypoint_id: 'wp_a', voyage_id: 'v1', ts: '2026-07-15T00:00:00Z' }),
      makeRecord({ waypoint_id: 'wp_b', voyage_id: 'v1', ts: '2026-07-10T00:00:00Z' }),
      makeRecord({ waypoint_id: 'wp_c', voyage_id: 'v1', ts: '2026-07-20T00:00:00Z' }),
    ];
    const tracePath = join(tmpDir, 'trace.jsonl');
    writeFileSync(tracePath, records.map((r) => JSON.stringify(r)).join('\n'));

    const summaries = await loadRecentVoyageSummaries(tracePath);
    expect(summaries[0]?.startedAt).toBe('2026-07-10T00:00:00Z');
    expect(summaries[0]?.endedAt).toBe('2026-07-20T00:00:00Z');
  });

  test('insertion order preserved within voyage bucket', async () => {
    const records: TraceRecord[] = [
      makeRecord({ waypoint_id: 'wp_first', voyage_id: 'v1', ts: '2026-07-21T00:00:00Z', goal: 'first' }),
      makeRecord({ waypoint_id: 'wp_second', voyage_id: 'v1', ts: '2026-07-21T01:00:00Z', goal: 'second' }),
      makeRecord({ waypoint_id: 'wp_third', voyage_id: 'v1', ts: '2026-07-21T02:00:00Z', goal: 'third' }),
    ];
    const tracePath = join(tmpDir, 'trace.jsonl');
    writeFileSync(tracePath, records.map((r) => JSON.stringify(r)).join('\n'));

    const summaries = await loadRecentVoyageSummaries(tracePath);
    const goals = summaries[0]?.waypoints.map((w) => w.goal);
    expect(goals).toEqual(['first', 'second', 'third']);
  });

  test('respects maxSummaries cap', async () => {
    const records: TraceRecord[] = [];
    for (let i = 1; i <= 10; i++) {
      records.push(
        makeRecord({
          waypoint_id: `wp_${i}`,
          voyage_id: `v_${i}`,
          ts: `2026-07-${String(i).padStart(2, '0')}T00:00:00Z`,
        }),
      );
    }
    const tracePath = join(tmpDir, 'trace.jsonl');
    writeFileSync(tracePath, records.map((r) => JSON.stringify(r)).join('\n'));

    const summaries = await loadRecentVoyageSummaries(tracePath, 3);
    expect(summaries.length).toBe(3);
    // Most recent 3 by endedAt: July 10, 9, 8.
    expect(summaries[0]?.voyageId).toBe('v_10');
    expect(summaries[2]?.voyageId).toBe('v_8');
  });

  test('default cap is DEFAULT_VOYAGE_SUMMARY_LIMIT (5)', async () => {
    const records: TraceRecord[] = [];
    for (let i = 1; i <= 10; i++) {
      records.push(
        makeRecord({
          waypoint_id: `wp_${i}`,
          voyage_id: `v_${i}`,
          ts: `2026-07-${String(i).padStart(2, '0')}T00:00:00Z`,
        }),
      );
    }
    const tracePath = join(tmpDir, 'trace.jsonl');
    writeFileSync(tracePath, records.map((r) => JSON.stringify(r)).join('\n'));

    const summaries = await loadRecentVoyageSummaries(tracePath);
    expect(summaries.length).toBe(5);
  });

  test('sync version matches async for same input', async () => {
    const records: TraceRecord[] = [
      makeRecord({ waypoint_id: 'wp_a', voyage_id: 'v1', ts: '2026-07-21T00:00:00Z' }),
      makeRecord({ waypoint_id: 'wp_b', voyage_id: 'v2', ts: '2026-07-21T01:00:00Z' }),
    ];
    const tracePath = join(tmpDir, 'trace.jsonl');
    writeFileSync(tracePath, records.map((r) => JSON.stringify(r)).join('\n'));

    const asyncResult = await loadRecentVoyageSummaries(tracePath);
    const syncResult = loadRecentVoyageSummariesSync(tracePath);
    expect(JSON.stringify(syncResult)).toBe(JSON.stringify(asyncResult));
  });

  test('sync tolerates malformed JSON lines (skips it)', () => {
    const tracePath = join(tmpDir, 'trace.jsonl');
    const valid = JSON.stringify(makeRecord({ waypoint_id: 'wp_a', voyage_id: 'v1' }));
    writeFileSync(tracePath, `${valid}\n{not valid json}\n${valid}`);

    const syncResult = loadRecentVoyageSummariesSync(tracePath);
    // Two valid records, both in v1 → one voyage with 2 waypoints.
    expect(syncResult.length).toBe(1);
    expect(syncResult[0]?.waypoints.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Purity — formatVoyageSummariesMarkdown does not mutate input
// ---------------------------------------------------------------------------

describe('purity — formatVoyageSummariesMarkdown does not mutate input', () => {
  test('summaries array is not mutated', () => {
    const summaries: VoyageSummary[] = [
      {
        voyageId: 'v',
        startedAt: '',
        endedAt: '',
        waypoints: [],
        successCount: 0,
        failureCount: 0,
        abandonedCount: 0,
        totalIterations: 0,
      },
    ];
    const snapshot = JSON.stringify(summaries);
    formatVoyageSummariesMarkdown(summaries);
    expect(JSON.stringify(summaries)).toBe(snapshot);
  });

  test('individual VoyageSummary objects are not mutated', () => {
    const summary: VoyageSummary = {
      voyageId: 'v',
      startedAt: '',
      endedAt: '',
      waypoints: [
        { id: 'w', goal: 'g', outcome: 'success', failReason: null, iterationsUsed: 1, ts: '' },
      ],
      successCount: 1,
      failureCount: 0,
      abandonedCount: 0,
      totalIterations: 1,
    };
    const snapshot = JSON.stringify(summary);
    formatVoyageSummariesMarkdown([summary]);
    expect(JSON.stringify(summary)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism — same input → same output', () => {
  test('formatVoyageSummariesMarkdown is deterministic', () => {
    const summaries: VoyageSummary[] = [
      {
        voyageId: 'v',
        startedAt: '',
        endedAt: '',
        waypoints: [],
        successCount: 0,
        failureCount: 0,
        abandonedCount: 0,
        totalIterations: 0,
      },
    ];
    const a = formatVoyageSummariesMarkdown(summaries);
    const b = formatVoyageSummariesMarkdown(summaries);
    expect(a).toBe(b);
  });

  test('no shared state across calls', () => {
    const a = formatVoyageSummariesMarkdown([
      { voyageId: 'v1', startedAt: '', endedAt: '', waypoints: [], successCount: 0, failureCount: 0, abandonedCount: 0, totalIterations: 0 },
    ]);
    const b = formatVoyageSummariesMarkdown([
      { voyageId: 'v2', startedAt: '', endedAt: '', waypoints: [], successCount: 0, failureCount: 0, abandonedCount: 0, totalIterations: 0 },
    ]);
    expect(a).toContain('v1');
    expect(a).not.toContain('v2');
    expect(b).toContain('v2');
    expect(b).not.toContain('v1');
  });
});

// ---------------------------------------------------------------------------
// Adversarial inputs
// ---------------------------------------------------------------------------

describe('adversarial inputs', () => {
  test('very long goal (10000 chars) is truncated', () => {
    const goal = 'x'.repeat(10000);
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'v',
        startedAt: '',
        endedAt: '',
        waypoints: [
          { id: 'w', goal, outcome: 'success', failReason: null, iterationsUsed: 1, ts: '' },
        ],
        successCount: 1,
        failureCount: 0,
        abandonedCount: 0,
        totalIterations: 1,
      },
    ]);
    expect(md).toContain('x'.repeat(159) + '…');
    expect(md).not.toContain('x'.repeat(160));
  });

  test('unicode in goal preserved up to truncation', () => {
    const goal = '错误'.repeat(100); // 200 chars
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'v',
        startedAt: '',
        endedAt: '',
        waypoints: [
          { id: 'w', goal, outcome: 'success', failReason: null, iterationsUsed: 1, ts: '' },
        ],
        successCount: 1,
        failureCount: 0,
        abandonedCount: 0,
        totalIterations: 1,
      },
    ]);
    expect(md).toContain('…');
    expect(md).toContain('错误');
  });

  test('special markdown chars in goal are NOT escaped', () => {
    // The formatter does NOT escape markdown. A goal with `*` or `_` will
    // appear verbatim — downstream markdown renderer may interpret them.
    const md = formatVoyageSummariesMarkdown([
      {
        voyageId: 'v',
        startedAt: '',
        endedAt: '',
        waypoints: [
          { id: 'w', goal: 'fix *bold* and _italic_', outcome: 'success', failReason: null, iterationsUsed: 1, ts: '' },
        ],
        successCount: 1,
        failureCount: 0,
        abandonedCount: 0,
        totalIterations: 1,
      },
    ]);
    expect(md).toContain('fix *bold* and _italic_');
  });

  test('100+ voyages — output grows linearly', () => {
    const summaries: VoyageSummary[] = [];
    for (let i = 0; i < 100; i++) {
      summaries.push({
        voyageId: `v_${i}`,
        startedAt: '',
        endedAt: '',
        waypoints: [],
        successCount: 0,
        failureCount: 0,
        abandonedCount: 0,
        totalIterations: 0,
      });
    }
    const md = formatVoyageSummariesMarkdown(summaries);
    const sectionCount = (md.match(/^### /gm) || []).length;
    expect(sectionCount).toBe(100);
  });
});
