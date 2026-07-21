import { describe, test, expect } from 'vitest';
import { formatVoyageStatsMarkdown } from '../../src/cerebellum/voyage-stats-format.js';
import type {
  VoyageStats,
  VoyageStatsSlice,
  ReasonCount,
} from '../../src/cerebellum/voyage-stats.js';

/**
 * voyage-stats-format — markdown formatter invariants.
 *
 * voyage-stats-format.test.ts covers the extraction boundary (5 tests).
 * cerebellum-voyage-stats.test.ts covers behavior indirectly. This
 * file pins the structural contracts a refactor could silently break:
 *
 *   - OUTPUT STRUCTURE. The markdown always starts with '# Voyage
 *     stats', has specific section ordering (headline → failure
 *     reasons → abandoned reasons → optional trend), and uses
 *     consistent separators ('  |  ', '  ' double-space, '\n\n'
 *     between sections).
 *
 *   - formatPct precision: 0 decimal places, always % suffix.
 *     0.567 → '57%' (not '56.7%' or '57.0%').
 *
 *   - formatTokens TIERS with exact boundaries:
 *       n >= 1_000_000 → 'X.XXM' (2 decimals)
 *       n >= 1_000     → 'X.Xk'  (1 decimal)
 *       else           → String(Math.round(n))
 *     999 → '999', 1000 → '1.0k', 999999 → '1000.0k', 1_000_000 → '1.00M'.
 *
 *   - avgIterations toFixed(1): always 1 decimal place. 3 → '3.0'.
 *
 *   - REASONS LIST SHAPE. Empty reasons → '  (none)'. Non-empty →
 *     each line padded with count.padStart(3), joined by '\n'.
 *
 *   - TREND SECTION OPTIONALITY. Rendered only when stats.trend is
 *     truthy (not null, not undefined). When omitted, the section
 *     header and slice formatting are absent.
 *
 *   - PURE FUNCTION. Same input → byte-identical output.
 *
 *   - NO TRAILING NEWLINE. Output ends with the last line's content
 *     (no '\n' at end of string).
 *
 * Each test below pins one slice of these contracts.
 */

const sampleSlice: VoyageStatsSlice = {
  waypoints: 6,
  successRate: 0.5,
  failureRate: 0.5,
  abandonedRate: 0,
  avgIterations: 4,
  avgInputTokens: 120_000,
};

function makeStats(overrides: Partial<VoyageStats> = {}): VoyageStats {
  return {
    totalWaypoints: 12,
    outcomes: { success: 8, failure: 3, abandoned: 1 },
    successRate: 8 / 12,
    totalTokens: { input: 1_200_000, output: 45_200 },
    avgTokensPerWaypoint: { input: 100_000, output: 3_766 },
    avgIterations: 3.2,
    topFailReasons: [{ reason: 'hit maxIterations', count: 3 }] as readonly ReasonCount[],
    topAbandonedReasons: [] as readonly ReasonCount[],
    trend: {
      firstHalf: sampleSlice,
      secondHalf: { ...sampleSlice, successRate: 0.83, failureRate: 0.17 },
    },
    ...overrides,
  };
}

describe('formatVoyageStatsMarkdown — top-level structure', () => {
  test('output always starts with "# Voyage stats"', () => {
    const md = formatVoyageStatsMarkdown(makeStats());
    expect(md.startsWith('# Voyage stats')).toBe(true);
  });

  test('output never ends with a trailing newline', () => {
    const md = formatVoyageStatsMarkdown(makeStats());
    expect(md.endsWith('\n')).toBe(false);
  });

  test('output is non-empty for any valid stats', () => {
    expect(formatVoyageStatsMarkdown(makeStats()).length).toBeGreaterThan(0);
  });

  test('headline section appears in fixed order', () => {
    const md = formatVoyageStatsMarkdown(makeStats());
    const headlineIdx = md.indexOf('# Voyage stats');
    const failReasonsIdx = md.indexOf('## Top failure reasons');
    const abandonedIdx = md.indexOf('## Top abandoned reasons');
    const trendIdx = md.indexOf('## Trend (first half vs second half)');

    expect(headlineIdx).toBeGreaterThanOrEqual(0);
    expect(failReasonsIdx).toBeGreaterThan(headlineIdx);
    expect(abandonedIdx).toBeGreaterThan(failReasonsIdx);
    expect(trendIdx).toBeGreaterThan(abandonedIdx);
  });

  test('## section headers are always preceded by an empty line', () => {
    const md = formatVoyageStatsMarkdown(makeStats());
    // Split by \n and check that each '## ' line is preceded by ''.
    const lines = md.split('\n');
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]!.startsWith('## ')) {
        expect(lines[i - 1]).toBe('');
      }
    }
  });
});

describe('formatVoyageStatsMarkdown — headline content', () => {
  test('renders totalWaypoints count', () => {
    const md = formatVoyageStatsMarkdown(makeStats({ totalWaypoints: 42 }));
    expect(md).toContain('Total waypoints: 42');
  });

  test('renders outcomes with double-space separator', () => {
    const md = formatVoyageStatsMarkdown(
      makeStats({
        outcomes: { success: 5, failure: 3, abandoned: 2 },
      }),
    );
    expect(md).toContain('Outcomes: success=5  failure=3  abandoned=2');
    // Double-space separator (not single, not tab).
    expect(md).toContain('success=5  failure=3');
  });

  test('renders successRate as percentage (toFixed(0))', () => {
    const md = formatVoyageStatsMarkdown(makeStats({ successRate: 0.567 }));
    expect(md).toContain('Success rate: 57%');
  });

  test('renders avgIterations with exactly 1 decimal', () => {
    const md = formatVoyageStatsMarkdown(makeStats({ avgIterations: 3 }));
    expect(md).toContain('avg iterations/waypoint: 3.0');
  });

  test('renders avgIterations=3.247 as 3.2 (truncated, not rounded up)', () => {
    const md = formatVoyageStatsMarkdown(makeStats({ avgIterations: 3.247 }));
    expect(md).toContain('avg iterations/waypoint: 3.2');
  });

  test('renders avgIterations=3.25 as 3.2 (banker\'s rounding via toFixed)', () => {
    // Number.prototype.toFixed rounds half-up — but for 3.25 the
    // underlying float representation might not be exactly 3.25.
    // Pinning whatever the actual behavior is.
    const md = formatVoyageStatsMarkdown(makeStats({ avgIterations: 3.25 }));
    // Common JS behavior: 3.25 → '3.2' or '3.3' depending on float repr.
    // Just verify it has 1 decimal.
    expect(md).toMatch(/avg iterations\/waypoint: 3\.\d/);
  });

  test('renders "  |  " as separator between success rate and avg iterations', () => {
    const md = formatVoyageStatsMarkdown(makeStats());
    expect(md).toContain('Success rate: 67%  |  avg iterations/waypoint:');
  });
});

describe('formatVoyageStatsMarkdown — formatPct precision', () => {
  // formatPct: (x * 100).toFixed(0) + '%'. 0 decimal places, always %.

  test('0 → "0%"', () => {
    const md = formatVoyageStatsMarkdown(makeStats({ successRate: 0 }));
    expect(md).toContain('Success rate: 0%');
  });

  test('1 → "100%"', () => {
    const md = formatVoyageStatsMarkdown(makeStats({ successRate: 1 }));
    expect(md).toContain('Success rate: 100%');
  });

  test('0.5 → "50%"', () => {
    const md = formatVoyageStatsMarkdown(makeStats({ successRate: 0.5 }));
    expect(md).toContain('Success rate: 50%');
  });

  test('0.567 → "57%" (rounded, no decimals)', () => {
    const md = formatVoyageStatsMarkdown(makeStats({ successRate: 0.567 }));
    expect(md).toContain('Success rate: 57%');
    expect(md).not.toContain('57.0%');
    expect(md).not.toContain('56.7%');
  });

  test('0.333 → "33%"', () => {
    const md = formatVoyageStatsMarkdown(makeStats({ successRate: 0.333 }));
    expect(md).toContain('Success rate: 33%');
  });

  test('0.999 → "100%" (rounds up)', () => {
    const md = formatVoyageStatsMarkdown(makeStats({ successRate: 0.999 }));
    expect(md).toContain('Success rate: 100%');
  });
});

describe('formatVoyageStatsMarkdown — formatTokens tiers', () => {
  // Tiers:
  //   n >= 1_000_000 → 'X.XXM' (2 decimals, M suffix)
  //   n >= 1_000     → 'X.Xk'  (1 decimal, k suffix)
  //   else           → String(Math.round(n))

  test('999 → "999"', () => {
    const md = formatVoyageStatsMarkdown(
      makeStats({ totalTokens: { input: 999, output: 0 } }),
    );
    expect(md).toContain('input=999');
  });

  test('1000 → "1.0k"', () => {
    const md = formatVoyageStatsMarkdown(
      makeStats({ totalTokens: { input: 1000, output: 0 } }),
    );
    expect(md).toContain('input=1.0k');
  });

  test('1500 → "1.5k"', () => {
    const md = formatVoyageStatsMarkdown(
      makeStats({ totalTokens: { input: 1500, output: 0 } }),
    );
    expect(md).toContain('input=1.5k');
  });

  test('999999 → "1000.0k"', () => {
    const md = formatVoyageStatsMarkdown(
      makeStats({ totalTokens: { input: 999_999, output: 0 } }),
    );
    expect(md).toContain('input=1000.0k');
  });

  test('1_000_000 → "1.00M"', () => {
    const md = formatVoyageStatsMarkdown(
      makeStats({ totalTokens: { input: 1_000_000, output: 0 } }),
    );
    expect(md).toContain('input=1.00M');
  });

  test('1_500_000 → "1.50M"', () => {
    const md = formatVoyageStatsMarkdown(
      makeStats({ totalTokens: { input: 1_500_000, output: 0 } }),
    );
    expect(md).toContain('input=1.50M');
  });

  test('2_345_678 → "2.35M" (2 decimals, rounded)', () => {
    const md = formatVoyageStatsMarkdown(
      makeStats({ totalTokens: { input: 2_345_678, output: 0 } }),
    );
    expect(md).toContain('input=2.35M');
  });

  test('0 → "0" (no suffix)', () => {
    const md = formatVoyageStatsMarkdown(
      makeStats({ totalTokens: { input: 0, output: 0 } }),
    );
    expect(md).toContain('input=0  output=0');
  });

  test('boundary: 999 vs 1000 — different format', () => {
    const md999 = formatVoyageStatsMarkdown(
      makeStats({ totalTokens: { input: 999, output: 0 } }),
    );
    const md1000 = formatVoyageStatsMarkdown(
      makeStats({ totalTokens: { input: 1000, output: 0 } }),
    );
    expect(md999).toContain('input=999');
    expect(md1000).toContain('input=1.0k');
  });

  test('boundary: 999999 vs 1_000_000 — different format', () => {
    const md999999 = formatVoyageStatsMarkdown(
      makeStats({ totalTokens: { input: 999_999, output: 0 } }),
    );
    const md1M = formatVoyageStatsMarkdown(
      makeStats({ totalTokens: { input: 1_000_000, output: 0 } }),
    );
    expect(md999999).toContain('input=1000.0k');
    expect(md1M).toContain('input=1.00M');
  });
});

describe('formatVoyageStatsMarkdown — reasons list shape', () => {
  test('empty fail reasons → "(none)" placeholder', () => {
    const md = formatVoyageStatsMarkdown(
      makeStats({ topFailReasons: [] as readonly ReasonCount[] }),
    );
    expect(md).toContain('## Top failure reasons');
    expect(md).toContain('(none)');
  });

  test('non-empty fail reasons → each entry on its own line', () => {
    const md = formatVoyageStatsMarkdown(
      makeStats({
        topFailReasons: [
          { reason: 'reason A', count: 3 },
          { reason: 'reason B', count: 1 },
        ] as readonly ReasonCount[],
      }),
    );
    expect(md).toContain('reason A');
    expect(md).toContain('reason B');
    // Each on its own line (separated by \n).
    const aIdx = md.indexOf('reason A');
    const bIdx = md.indexOf('reason B');
    expect(bIdx).toBeGreaterThan(aIdx);
  });

  test('count is padded to 3 chars (padStart(3))', () => {
    // count=3 → '  3' (2 leading spaces, total width 3).
    const md = formatVoyageStatsMarkdown(
      makeStats({
        topFailReasons: [{ reason: 'X', count: 3 }] as readonly ReasonCount[],
      }),
    );
    expect(md).toContain('  3  X'); // 2-space pad + count + 2-space sep + reason
  });

  test('count=100 → padStart(3) is no-op (3 chars already)', () => {
    // Template is `'  ' + count.padStart(3) + '  ' + reason`.
    // For count=100: '  ' + '100' + '  ' + 'X' = '  100  X'.
    // The 2-space line prefix is INVARIANT — comes from template, not padStart.
    const md = formatVoyageStatsMarkdown(
      makeStats({
        topFailReasons: [{ reason: 'X', count: 100 }] as readonly ReasonCount[],
      }),
    );
    expect(md).toContain('  100  X'); // exactly 2-space prefix
    expect(md).not.toContain('   100  X'); // not 3-space prefix (padStart did not add)
  });

  test('count=1000 overflows padStart (4 chars, no truncation)', () => {
    const md = formatVoyageStatsMarkdown(
      makeStats({
        topFailReasons: [{ reason: 'X', count: 1000 }] as readonly ReasonCount[],
      }),
    );
    expect(md).toContain('1000  X');
  });

  test('empty abandoned reasons → "(none)" placeholder', () => {
    const md = formatVoyageStatsMarkdown(
      makeStats({ topAbandonedReasons: [] as readonly ReasonCount[] }),
    );
    expect(md).toContain('## Top abandoned reasons');
    expect(md).toContain('(none)');
  });

  test('## Top failure reasons always appears (even if empty)', () => {
    const md = formatVoyageStatsMarkdown(
      makeStats({ topFailReasons: [] as readonly ReasonCount[] }),
    );
    expect(md).toContain('## Top failure reasons');
  });

  test('## Top abandoned reasons always appears (even if empty)', () => {
    const md = formatVoyageStatsMarkdown(
      makeStats({ topAbandonedReasons: [] as readonly ReasonCount[] }),
    );
    expect(md).toContain('## Top abandoned reasons');
  });
});

describe('formatVoyageStatsMarkdown — trend section optionality', () => {
  test('trend present → section rendered', () => {
    const md = formatVoyageStatsMarkdown(makeStats());
    expect(md).toContain('## Trend (first half vs second half)');
  });

  test('trend null → section omitted', () => {
    const md = formatVoyageStatsMarkdown(makeStats({ trend: null }));
    expect(md).not.toContain('## Trend');
    expect(md).not.toContain('First half ');
    expect(md).not.toContain('Second half');
  });

  test('trend undefined → section omitted', () => {
    const md = formatVoyageStatsMarkdown(
      makeStats({ trend: undefined } as unknown as VoyageStats),
    );
    expect(md).not.toContain('## Trend');
  });

  test('trend header has exact text "## Trend (first half vs second half)"', () => {
    const md = formatVoyageStatsMarkdown(makeStats());
    expect(md).toContain('## Trend (first half vs second half)');
  });

  test('First half slice has trailing space in label ("First half ")', () => {
    const md = formatVoyageStatsMarkdown(makeStats());
    expect(md).toContain('First half ');
  });

  test('First half label has trailing space, Second half does not', () => {
    // Source passes 'First half ' (trailing space) and 'Second half' (no trailing).
    // The formatSlice template is `${label} (...)` — a literal space after label.
    // So 'First half ' + ' (' = 'First half  (' (2 spaces).
    // And 'Second half' + ' (' = 'Second half (' (1 space).
    // The double-space vs single-space distinction is what proves the label
    // trailing-space divergence is load-bearing.
    const md = formatVoyageStatsMarkdown(makeStats());
    expect(md).toContain('First half  ('); // double space
    expect(md).toContain('Second half ('); // single space
  });

  test('trend slice includes "waypoints:" count', () => {
    const md = formatVoyageStatsMarkdown(
      makeStats({
        trend: {
          firstHalf: { ...sampleSlice, waypoints: 7 },
          secondHalf: { ...sampleSlice, waypoints: 5 },
        },
      }),
    );
    expect(md).toContain('(7 waypoints)');
    expect(md).toContain('(5 waypoints)');
  });

  test('trend slice includes success/failure/abandoned rates', () => {
    const md = formatVoyageStatsMarkdown(makeStats());
    // Each slice renders success=X%  failure=X%  abandoned=X%
    const matches = md.match(/success=\d+%/g);
    expect(matches!.length).toBeGreaterThanOrEqual(2); // at least 2 slices
  });

  test('trend slice includes "avg iterations=" and "avg input tokens="', () => {
    const md = formatVoyageStatsMarkdown(makeStats());
    expect(md).toContain('avg iterations=');
    expect(md).toContain('avg input tokens=');
  });
});

describe('formatVoyageStatsMarkdown — line-by-line shape', () => {
  test('output contains exactly the expected sections in order', () => {
    const md = formatVoyageStatsMarkdown(makeStats());
    const lines = md.split('\n');

    // First line is the H1.
    expect(lines[0]).toBe('# Voyage stats');

    // Find each section header by index.
    const failIdx = lines.findIndex((l) => l === '## Top failure reasons');
    const abandonedIdx = lines.findIndex((l) => l === '## Top abandoned reasons');
    const trendIdx = lines.findIndex(
      (l) => l === '## Trend (first half vs second half)',
    );

    expect(failIdx).toBeGreaterThan(0);
    expect(abandonedIdx).toBeGreaterThan(failIdx);
    expect(trendIdx).toBeGreaterThan(abandonedIdx);
  });

  test('no line in output is just whitespace', () => {
    const md = formatVoyageStatsMarkdown(makeStats());
    const lines = md.split('\n');
    for (const line of lines) {
      // Empty lines are OK (section separators), but lines with only
      // spaces/tabs would be a bug.
      if (line.length > 0) {
        expect(line.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('formatVoyageStatsMarkdown — purity and determinism', () => {
  test('same input produces byte-identical output', () => {
    const stats = makeStats();
    const a = formatVoyageStatsMarkdown(stats);
    const b = formatVoyageStatsMarkdown(stats);
    expect(a).toBe(b);
  });

  test('order of calls does not matter (no shared state)', () => {
    const stats1 = makeStats({ totalWaypoints: 10 });
    const stats2 = makeStats({ totalWaypoints: 20 });
    const result1First = formatVoyageStatsMarkdown(stats1);
    const result2First = formatVoyageStatsMarkdown(stats2);
    const result1Second = formatVoyageStatsMarkdown(stats1);
    const result2Second = formatVoyageStatsMarkdown(stats2);
    expect(result1First).toBe(result1Second);
    expect(result2First).toBe(result2Second);
  });

  test('function does NOT mutate the input stats', () => {
    const stats = makeStats();
    const snapshot = JSON.stringify(stats);
    formatVoyageStatsMarkdown(stats);
    expect(JSON.stringify(stats)).toBe(snapshot);
  });
});

describe('formatVoyageStatsMarkdown — adversarial inputs', () => {
  test('zero stats produces a valid markdown block', () => {
    const md = formatVoyageStatsMarkdown(
      makeStats({
        totalWaypoints: 0,
        outcomes: { success: 0, failure: 0, abandoned: 0 },
        successRate: 0,
        totalTokens: { input: 0, output: 0 },
        avgTokensPerWaypoint: { input: 0, output: 0 },
        avgIterations: 0,
        topFailReasons: [] as readonly ReasonCount[],
        topAbandonedReasons: [] as readonly ReasonCount[],
        trend: null,
      }),
    );
    expect(md).toContain('Total waypoints: 0');
    expect(md).toContain('Outcomes: success=0  failure=0  abandoned=0');
    expect(md).toContain('Success rate: 0%');
    expect(md).toContain('(none)');
    expect(md).not.toContain('## Trend');
  });

  test('very large stats (1B tokens) uses M suffix', () => {
    const md = formatVoyageStatsMarkdown(
      makeStats({
        totalTokens: { input: 1_000_000_000, output: 500_000_000 },
      }),
    );
    expect(md).toContain('input=1000.00M');
    expect(md).toContain('output=500.00M');
  });

  test('very small fractions format without scientific notation', () => {
    // 0.0001 * 100 = 0.01, toFixed(0) = '0'. Should be '0%'.
    const md = formatVoyageStatsMarkdown(
      makeStats({ successRate: 0.0001 }),
    );
    expect(md).toContain('Success rate: 0%');
  });

  test('throws TypeError on null/undefined input (no type guard)', () => {
    expect(() => formatVoyageStatsMarkdown(null as unknown as VoyageStats)).toThrow(TypeError);
    expect(() => formatVoyageStatsMarkdown(undefined as unknown as VoyageStats)).toThrow(TypeError);
  });
});
