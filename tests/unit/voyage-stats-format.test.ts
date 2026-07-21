import { describe, test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { formatVoyageStatsMarkdown } from '../../src/cerebellum/voyage-stats-format.js';
import type {
  VoyageStats,
  VoyageStatsSlice,
  ReasonCount,
} from '../../src/cerebellum/voyage-stats.js';

/**
 * Direct unit tests for the voyage-stats markdown formatter module
 * extracted from voyage-stats.ts in Iteration 55.
 *
 * Behavior coverage for formatVoyageStatsMarkdown still lives in
 * cerebellum-voyage-stats.test.ts (it imports via the re-export from
 * voyage-stats.ts). These tests pin the extraction itself so a future
 * refactor cannot silently re-inline the code.
 */

const sampleSlice: VoyageStatsSlice = {
  waypoints: 6,
  successRate: 0.5,
  failureRate: 0.5,
  abandonedRate: 0,
  avgIterations: 4,
  avgInputTokens: 120_000,
};

const sampleStats: VoyageStats = {
  totalWaypoints: 12,
  outcomes: { success: 8, failure: 3, abandoned: 1 },
  successRate: 8 / 12,
  totalTokens: { input: 1_200_000, output: 45_200 },
  avgTokensPerWaypoint: { input: 100_000, output: 3_766 },
  avgIterations: 3.2,
  topFailReasons: [
    { reason: 'hit maxIterations', count: 3 },
  ] as readonly ReasonCount[],
  topAbandonedReasons: [] as readonly ReasonCount[],
  trend: {
    firstHalf: sampleSlice,
    secondHalf: { ...sampleSlice, successRate: 0.83, failureRate: 0.17 },
  },
};

describe('formatVoyageStatsMarkdown (direct from format module)', () => {
  test('renders headline numbers via the format module', () => {
    const md = formatVoyageStatsMarkdown(sampleStats);
    expect(md).toContain('# Voyage stats');
    expect(md).toContain('Total waypoints: 12');
    expect(md).toContain('Outcomes: success=8  failure=3  abandoned=1');
  });

  test('renders top failure reasons section', () => {
    const md = formatVoyageStatsMarkdown(sampleStats);
    expect(md).toContain('## Top failure reasons');
    expect(md).toContain('hit maxIterations');
  });

  test('renders trend section when present', () => {
    const md = formatVoyageStatsMarkdown(sampleStats);
    expect(md).toContain('## Trend (first half vs second half)');
    expect(md).toContain('First half ');
    expect(md).toContain('Second half');
  });

  test('omits trend section when trend is null', () => {
    const md = formatVoyageStatsMarkdown({ ...sampleStats, trend: null });
    expect(md).not.toContain('## Trend');
  });

  test('(none) appears for empty reason lists', () => {
    const md = formatVoyageStatsMarkdown({
      ...sampleStats,
      topAbandonedReasons: [],
    });
    expect(md).toContain('## Top abandoned reasons');
    expect(md).toContain('(none)');
  });
});

describe('voyage-stats-format extraction (Iteration 55)', () => {
  // Iteration 55 moved the markdown formatter block (formatPct,
  // formatTokens, formatReasons, formatSlice, formatVoyageStatsMarkdown)
  // from voyage-stats.ts to voyage-stats-format.ts. These tests pin the
  // extraction so a future refactor cannot silently re-inline the code.

  test('formatter symbols live in voyage-stats-format.ts', async () => {
    const formatSrc = await readFile(
      'src/cerebellum/voyage-stats-format.ts',
      'utf8',
    );
    const statsSrc = await readFile(
      'src/cerebellum/voyage-stats.ts',
      'utf8',
    );
    expect(formatSrc).toContain('export function formatVoyageStatsMarkdown');
    // Must NOT be re-defined in voyage-stats.ts.
    expect(statsSrc).not.toContain('function formatVoyageStatsMarkdown');
    expect(statsSrc).not.toContain('function formatPct');
    expect(statsSrc).not.toContain('function formatTokens');
    expect(statsSrc).not.toContain('function formatReasons');
    expect(statsSrc).not.toContain('function formatSlice');
  });

  test('voyage-stats.ts re-exports the formatter for backwards compat', async () => {
    // cerebellum-voyage-stats.test.ts and src/scripts/voyage-stats.ts
    // import formatVoyageStatsMarkdown from voyage-stats.ts. The
    // re-export pattern preserves those import sites unchanged.
    // Mirrors Iter 53 memory.ts re-exporting memory-parse.js.
    const statsSrc = await readFile(
      'src/cerebellum/voyage-stats.ts',
      'utf8',
    );
    expect(statsSrc).toContain(
      "export { formatVoyageStatsMarkdown } from './voyage-stats-format.js';",
    );
  });
});
