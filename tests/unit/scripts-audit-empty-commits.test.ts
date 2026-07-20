import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseCliArgs,
  printReport,
  formatCommitLine,
  type CliOptions,
} from '../../src/scripts/audit-empty-commits.js';
import type { EmptyWaypointCommit } from '../../src/cerebellum/commit-audit.js';

/**
 * audit-empty-commits.ts — the CLI bin that closes the Iteration 19
 * "no consumer" gap. The audit logic itself is exhaustively tested in
 * commit-audit.test.ts; this file pins the CLI's own contracts:
 *
 * - Flag parsing: --since, --limit (with validation), --summary, --cwd
 * - Report format: ratio denominator handling (div-by-zero → "n/a"),
 *   --summary short form vs full report, "no empties" branch.
 *
 * These tests exist because the parser runs before any git invocation
 * — a regression here (e.g. `--limit 0` accepted, `--since ""` silent
 * success) would silently mis-report or crash the CLI, and the bug
 * would only surface when an operator ran it manually.
 */

const baseOptions = (overrides: Partial<CliOptions> = {}): CliOptions => ({
  since: undefined,
  limit: undefined,
  summary: false,
  cwd: '/tmp/repo',
  ...overrides,
});

describe('audit-empty-commits — parseCliArgs', () => {
  test('returns defaults when no flags are passed', () => {
    const opts = parseCliArgs([]);
    expect(opts.since).toBeUndefined();
    expect(opts.limit).toBeUndefined();
    expect(opts.summary).toBe(false);
    expect(opts.cwd).toBe(process.cwd());
  });

  test('parses --since <ref>', () => {
    const opts = parseCliArgs(['--since', 'HEAD~50']);
    expect(opts.since).toBe('HEAD~50');
  });

  test('parses --limit <N> as a positive integer', () => {
    const opts = parseCliArgs(['--limit', '100']);
    expect(opts.limit).toBe(100);
  });

  test('parses --summary as a boolean flag', () => {
    const opts = parseCliArgs(['--summary']);
    expect(opts.summary).toBe(true);
  });

  test('parses --cwd <path>', () => {
    const opts = parseCliArgs(['--cwd', '/some/other/repo']);
    expect(opts.cwd).toBe('/some/other/repo');
  });

  test('parses all flags together', () => {
    const opts = parseCliArgs([
      '--since', 'main',
      '--limit', '500',
      '--summary',
      '--cwd', '/repo',
    ]);
    expect(opts).toEqual({
      since: 'main',
      limit: 500,
      summary: true,
      cwd: '/repo',
    });
  });

  test('throws on --limit that is not a number', () => {
    expect(() => parseCliArgs(['--limit', 'abc'])).toThrow(/positive integer/);
  });

  test('throws on --limit that is zero', () => {
    expect(() => parseCliArgs(['--limit', '0'])).toThrow(/positive integer/);
  });

  test('throws on --limit that is negative', () => {
    // Use the `--limit=-5` form because Node's parseArgs treats
    // `--limit -5` as two separate args (it sees `-5` as another flag).
    // Either way, the parseCliArgs validation must reject negatives.
    expect(() => parseCliArgs(['--limit=-5'])).toThrow(/positive integer/);
  });

  test('throws on --since that is empty string', () => {
    // Empty --since would be silently ignored, producing a full-history
    // scan when the operator asked for a bounded one. Reject early.
    expect(() => parseCliArgs(['--since', ''])).toThrow(/cannot be empty/);
  });

  test('throws on unknown flag', () => {
    expect(() => parseCliArgs(['--bogus'])).toThrow();
  });
});

describe('audit-empty-commits — formatCommitLine', () => {
  test('formats SHA (10 chars), padded subject, ISO date', () => {
    const c: EmptyWaypointCommit = {
      sha: '43b6a7cae9abcdef12345678901234567890abcd',
      subject: 'waypoint/wp_xyz-ok',
      date: '2026-07-21T04:59:57+08:00',
    };
    const line = formatCommitLine(c);
    // Template: 2 leading spaces + 10-char SHA + 2 spaces + padEnd(28)
    // subject + 2 spaces + ISO date. "waypoint/wp_xyz-ok" is 18 chars,
    // so padEnd(28) adds 10 trailing spaces, then the template adds 2
    // more → 12 spaces between `-ok` and the date.
    expect(line).toBe('  43b6a7cae9  waypoint/wp_xyz-ok            2026-07-21T04:59:57+08:00');
  });

  test('truncates SHA to first 10 chars (not full 40)', () => {
    // The CLI is for humans scanning output — 10 chars is enough to
    // disambiguate and to feed back to `git show`. Full 40 wastes width.
    const c: EmptyWaypointCommit = {
      sha: 'a'.repeat(40),
      subject: 'waypoint/wp_x-ok',
      date: '2026-07-21T00:00:00+00:00',
    };
    expect(formatCommitLine(c)).toContain('a'.repeat(10));
    expect(formatCommitLine(c)).not.toContain('a'.repeat(11));
  });
});

describe('audit-empty-commits — printReport', () => {
  // The report writes directly to stdout via console.log. Intercepting
  // it keeps these tests deterministic (no TTY / pipe differences) and
  // lets us assert on the exact text.
  let logged: string[] = [];

  beforeEach(() => {
    logged = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('--summary prints a single ratio line', () => {
    const empties: EmptyWaypointCommit[] = [
      { sha: 'a'.repeat(40), subject: 'waypoint/wp_1-ok', date: '2026-07-21T00:00:00+00:00' },
    ];
    printReport(empties, 10, baseOptions({ summary: true }));
    expect(logged.join('\n')).toBe('1/10 (10.0%) empty waypoint commits in all history');
  });

  test('--summary respects --since range label', () => {
    printReport([], 0, baseOptions({ summary: true, since: 'HEAD~50' }));
    expect(logged.join('\n')).toBe('0/0 (n/a) empty waypoint commits in HEAD~50..HEAD');
  });

  test('full report includes header, count, ratio, and per-commit lines', () => {
    const empties: EmptyWaypointCommit[] = [
      { sha: 'a'.repeat(40), subject: 'waypoint/wp_a-ok', date: '2026-07-21T00:00:00+00:00' },
      { sha: 'b'.repeat(40), subject: 'waypoint/wp_b-ok', date: '2026-07-20T00:00:00+00:00' },
    ];
    printReport(empties, 5, baseOptions());
    const out = logged.join('\n');
    expect(out).toContain('Empty waypoint commits: 2/5 (40.0%)');
    expect(out).toContain('waypoint/wp_a-ok');
    expect(out).toContain('waypoint/wp_b-ok');
  });

  test('zero denominator → ratio is "n/a", not "NaN%" or crash', () => {
    // The repo may have zero `waypoint/wp_*-ok` commits (e.g. before any
    // waypoint has run). Division by zero would produce NaN — a useless
    // and ugly display. Pin the "n/a" fallback.
    printReport([], 0, baseOptions());
    const out = logged.join('\n');
    expect(out).toContain('0/0 (n/a)');
    expect(out).not.toContain('NaN');
  });

  test('no empties → prints a reassurance message, not just "0/N"', () => {
    // Operators running this audit are looking for trouble. A bare
    // "0/N" line is ambiguous — did the audit work, or did it silently
    // no-op? The reassurance line answers that.
    printReport([], 50, baseOptions());
    const out = logged.join('\n');
    expect(out).toContain('0/50 (0.0%)');
    expect(out).toContain('No empty waypoint commits found');
  });

  test('header reflects the scanned range', () => {
    printReport([], 0, baseOptions({ since: 'main' }));
    expect(logged.join('\n')).toContain('Range scanned: main..HEAD');
  });
});
