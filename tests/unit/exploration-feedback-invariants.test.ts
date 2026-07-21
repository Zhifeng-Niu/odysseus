import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  computeExplorationStats,
  formatExplorationFeedback,
  DEMOTION_FAILURE_THRESHOLD,
  type ExplorationStats,
} from '../../src/cerebellum/exploration-feedback.js';
import type { ExplorationOutcome } from '../../src/cerebellum/exploration-log.js';
import type { TraceRecord } from '../../src/trace/jsonl.js';

// ---------------------------------------------------------------------------
// Source contract — src/cerebellum/exploration-feedback.ts
//
// Closes self-model aspiration #3: "Exploration-outcome feedback loop —
// demote for N voyages after 3 failures; mark closed when shipped."
//
// Extracted from exploration-log.ts to keep that file under the 260-line
// size cap. Pure module — no side effects, no I/O.
//
// Invariants pinned here:
//   - 3 imports (2 type-only from local modules + 1 value)
//   - DEMOTION_FAILURE_THRESHOLD = 3 (named, not magic)
//   - ExplorationStats interface: 8 readonly fields
//   - computeExplorationStats: indexes trace by normalized goal, walks
//     backward for consecutive failures, deduplicates outcomes by goalKey
//   - formatExplorationFeedback: filters to actionable signal only
//     (demoted OR lastSucceeded), returns '' when no signal
//   - truncate helper: ellipsis char '…' (not ASCII '...')
// ---------------------------------------------------------------------------

const SRC_PATH = 'src/cerebellum/exploration-feedback.ts';

// ---------------------------------------------------------------------------
// Source-level — module shape
// ---------------------------------------------------------------------------

describe('exploration-feedback — module shape', () => {
  test('file is between 140 and 170 lines', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const lines = src.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(140);
    expect(lines.length).toBeLessThanOrEqual(170);
  });

  test('has exactly 3 import statements', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const imports = src.match(/^import\s/mg) ?? [];
    expect(imports.length).toBe(3);
  });

  test('imports TraceRecord type from trace/jsonl.js', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/import\s+type\s+\{\s*TraceRecord\s*\}\s+from\s+'\.\.\/trace\/jsonl\.js'/);
  });

  test('imports ExplorationOutcome type from exploration-log.js', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/import\s+type\s+\{\s*ExplorationOutcome\s*\}\s+from\s+'\.\/exploration-log\.js'/);
  });

  test('imports normalizeGoal value from dreamer-dedup.js', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/import\s+\{\s*normalizeGoal\s*\}\s+from\s+'\.\/dreamer-dedup\.js'/);
  });

  test('all local imports use .js ESM extension', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const localImports = src.match(/^import[^;]+from\s+'\.[^']+'/gm) ?? [];
    for (const imp of localImports) {
      expect(imp).toMatch(/\.js'/);
    }
  });

  test('has module-level docstring mentioning aspiration #3', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/Exploration feedback loop/);
    expect(src).toMatch(/aspiration #3/);
    expect(src).toMatch(/3\s+failures/);
  });

  test('explains extraction from exploration-log.ts for size cap', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/Extracted from exploration-log\.ts/);
    expect(src).toMatch(/260-line size cap/);
  });
});

// ---------------------------------------------------------------------------
// DEMOTION_FAILURE_THRESHOLD
// ---------------------------------------------------------------------------

describe('exploration-feedback — DEMOTION_FAILURE_THRESHOLD', () => {
  test('exported as a named const', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/export\s+const\s+DEMOTION_FAILURE_THRESHOLD\s*=\s*\d+/);
  });

  test('value is 3 (named, not magic number)', () => {
    expect(DEMOTION_FAILURE_THRESHOLD).toBe(3);
  });

  test('documented with threshold semantics', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/after this many consecutive failures/);
    expect(src).toMatch(/DEMOTION_FAILURE_THRESHOLD/);
  });
});

// ---------------------------------------------------------------------------
// ExplorationStats interface
// ---------------------------------------------------------------------------

describe('exploration-feedback — ExplorationStats interface', () => {
  test('exported with 8 readonly fields', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const block = src.match(/export\s+interface\s+ExplorationStats\s*\{[\s\S]*?\}/)![0];
    const readonlyFields = block.match(/readonly\s+\w+/g) ?? [];
    expect(readonlyFields.length).toBe(8);
  });

  test('declares all 8 expected fields', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const block = src.match(/export\s+interface\s+ExplorationStats\s*\{[\s\S]*?\}/)![0];
    expect(block).toMatch(/readonly\s+goalKey:\s*string/);
    expect(block).toMatch(/readonly\s+goalSample:\s*string/);
    expect(block).toMatch(/readonly\s+totalAttempts:\s*number/);
    expect(block).toMatch(/readonly\s+successCount:\s*number/);
    expect(block).toMatch(/readonly\s+failureCount:\s*number/);
    expect(block).toMatch(/readonly\s+consecutiveFailures:\s*number/);
    expect(block).toMatch(/readonly\s+lastSucceeded:\s*boolean/);
    expect(block).toMatch(/readonly\s+demoted:\s*boolean/);
  });

  test('all fields are readonly (immutable record)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const block = src.match(/export\s+interface\s+ExplorationStats\s*\{[\s\S]*?\}/)![0];
    // every field declaration must include `readonly`
    const fields = block.match(/^\s+\w+:/gm) ?? [];
    const readonlys = block.match(/readonly\s+\w+:/g) ?? [];
    expect(readonlys.length).toBe(fields.length);
  });
});

// ---------------------------------------------------------------------------
// computeExplorationStats — source-level shape
// ---------------------------------------------------------------------------

describe('exploration-feedback — computeExplorationStats shape', () => {
  test('exported function with (outcomes, trace) -> ExplorationStats[]', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(
      /export\s+function\s+computeExplorationStats\s*\(\s*outcomes:\s*readonly\s+ExplorationOutcome\[\],\s*trace:\s*readonly\s+TraceRecord\[\],?\s*\):\s*ExplorationStats\[\]/,
    );
  });

  test('indexes trace by normalized goal into a Map<string, TraceRecord[]>', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+traceByGoal\s*=\s*new\s+Map<string,\s*TraceRecord\[\]>\(\)/);
  });

  test('skips empty-trim trace goals (r.goal.trim().length === 0)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/if\s*\(\s*r\.goal\.trim\(\)\.length\s*===\s*0\s*\)\s*continue/);
  });

  test('skips empty normalized keys', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/if\s*\(\s*key\.length\s*===\s*0\s*\)\s*continue/);
  });

  test('uses immutable Map insertion pattern (if undefined -> set, else push)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+existing\s*=\s*traceByGoal\.get\(\s*key\s*\)/);
    expect(src).toMatch(/if\s*\(\s*existing\s*===\s*undefined\s*\)\s*\{[\s\S]*?traceByGoal\.set\(\s*key,\s*\[\s*r\s*\]\s*\)/);
    expect(src).toMatch(/else\s*\{[\s\S]*?existing\.push\(\s*r\s*\)/);
  });

  test('uses a Set<string> seen to dedupe outcomes by goalKey', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+seen\s*=\s*new\s+Set<string>\(\)/);
    expect(src).toMatch(/if\s*\(\s*key\.length\s*===\s*0\s*\|\|\s*seen\.has\(\s*key\s*\)\s*\)\s*continue/);
    expect(src).toMatch(/seen\.add\(\s*key\s*\)/);
  });

  test('omits explorations with no trace match (never executed)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+records\s*=\s*traceByGoal\.get\(\s*key\s*\)/);
    expect(src).toMatch(/if\s*\(\s*records\s*===\s*undefined\s*\)\s*continue/);
  });

  test('sorts chronologically via localeCompare on ts', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+sorted\s*=\s*\[\.\.\.records\]\.sort\(\s*\(a,\s*b\)\s*=>\s*a\.ts\.localeCompare\(\s*b\.ts\s*\)\s*\)/);
  });

  test('counts successes and failures via if/else-if', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/if\s*\(\s*r\.outcome\s*===\s*'success'\s*\)\s*successCount\s*\+=\s*1/);
    expect(src).toMatch(/else\s+if\s*\(\s*r\.outcome\s*===\s*'failure'\s*\)\s*failureCount\s*\+=\s*1/);
  });

  test('walks backward for consecutive failures (i-- loop with break)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/for\s*\(\s*let\s+i\s*=\s*sorted\.length\s*-\s*1;\s*i\s*>=\s*0;\s*i--\s*\)/);
    expect(src).toMatch(/if\s*\(\s*sorted\[i\]!?\.\s*outcome\s*===\s*'failure'\s*\)\s*\{[\s\S]*?consecutiveFailures\s*\+=\s*1/);
    expect(src).toMatch(/else\s*\{\s*break;/);
  });

  test('lastSucceeded derived from most recent sorted entry', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/lastSucceeded\s*=\s*sorted\[sorted\.length\s*-\s*1\]!?\.\s*outcome\s*===\s*'success'/);
  });

  test('demoted derived from consecutiveFailures >= threshold', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/demoted:\s*consecutiveFailures\s*>=\s*DEMOTION_FAILURE_THRESHOLD/);
  });

  test('returns a fresh array (not mutating inputs)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+stats:\s*ExplorationStats\[\]\s*=\s*\[\]/);
    expect(src).toMatch(/return\s+stats/);
  });

  test('does not mutate outcomes or trace inputs (no .push on inputs)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    // The only .push() calls should be on the local `existing` (Map value)
    // and the local `stats` array — never on `outcomes` or `trace`.
    expect(src).not.toMatch(/outcomes\.push\(/);
    expect(src).not.toMatch(/trace\.push\(/);
  });
});

// ---------------------------------------------------------------------------
// formatExplorationFeedback — source-level shape
// ---------------------------------------------------------------------------

describe('exploration-feedback — formatExplorationFeedback shape', () => {
  test('exported function with (stats) -> string', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(
      /export\s+function\s+formatExplorationFeedback\s*\(\s*stats:\s*readonly\s+ExplorationStats\[\],?\s*\):\s*string/,
    );
  });

  test('filters stats to actionable signal (demoted || lastSucceeded)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+signal\s*=\s*stats\.filter\(\s*\(\s*s\s*\)\s*=>\s*s\.demoted\s*\|\|\s*s\.lastSucceeded\s*\)/);
  });

  test('returns empty string when signal.length === 0', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/if\s*\(\s*signal\.length\s*===\s*0\s*\)\s*return\s+''/);
  });

  test('emits a "### Exploration feedback" header line', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/'### Exploration feedback'/);
  });

  test('DEMOTED line includes consecutive failure count and goal sample', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/`- DEMOTED \(\$\{s\.consecutiveFailures\} consecutive failures\): \$\{truncate\(s\.goalSample,\s*100\)\} — skip for now, pick a different aspiration`/);
  });

  test('SHIPPED line marks aspiration closed', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/`- SHIPPED \(succeeded\): \$\{truncate\(s\.goalSample,\s*100\)\} — aspiration closed, do not re-propose`/);
  });

  test('joins lines with newline (no trailing newline)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/return\s+lines\.join\('\\n'\)/);
  });

  test('demoted branch takes priority (checked first in if/else)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    // if (s.demoted) ... else if (s.lastSucceeded) ...
    expect(src).toMatch(/if\s*\(\s*s\.demoted\s*\)\s*\{[\s\S]*?\}\s*else\s+if\s*\(\s*s\.lastSucceeded\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// truncate helper
// ---------------------------------------------------------------------------

describe('exploration-feedback — truncate helper', () => {
  test('declared as a private (non-exported) function', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/^function\s+truncate\s*\(\s*s:\s*string,\s*max:\s*number\s*\):\s*string/m);
    expect(src).not.toMatch(/^export\s+function\s+truncate/m);
  });

  test('returns s unchanged when length <= max', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/if\s*\(\s*s\.length\s*<=\s*max\s*\)\s*return\s+s/);
  });

  test('truncates with ellipsis char — uses Unicode … (NOT ASCII ...)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/return\s+s\.slice\(\s*0,\s*max\s*-\s*1\s*\)\s*\+\s*'…'/);
    // Explicitly forbid ASCII ellipsis
    expect(src).not.toMatch(/return\s+s\.slice\(\s*0,\s*max\s*-\s*1\s*\)\s*\+\s*'\.\.\.'/);
  });
});

// ---------------------------------------------------------------------------
// Source-level safety
// ---------------------------------------------------------------------------

describe('exploration-feedback — source-level safety', () => {
  test('no child_process / exec / spawn', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/child_process/);
    expect(src).not.toMatch(/\bexec\(/);
    expect(src).not.toMatch(/\bspawn\(/);
  });

  test('no direct fetch (pure module)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/\bfetch\(/);
  });

  test('no eval or Function constructor', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/\beval\(/);
    expect(src).not.toMatch(/new\s+Function\(/);
  });

  test('no console.log (pure module)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/\bconsole\./);
  });

  test('no fs I/O (pure module)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/readFileSync/);
    expect(src).not.toMatch(/writeFileSync/);
    expect(src).not.toMatch(/readFile/);
    expect(src).not.toMatch(/writeFile/);
  });
});

// ---------------------------------------------------------------------------
// Behavioral — DEMOTION_FAILURE_THRESHOLD
// ---------------------------------------------------------------------------

describe('exploration-feedback — behavioral: threshold semantics', () => {
  test('DEMOTION_FAILURE_THRESHOLD is exactly 3', () => {
    expect(DEMOTION_FAILURE_THRESHOLD).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Behavioral — computeExplorationStats
// ---------------------------------------------------------------------------

function makeTrace(overrides: Partial<TraceRecord> = {}): TraceRecord {
  return {
    ts: '2026-07-21T00:00:00Z',
    waypoint_id: 'wp',
    goal: 'test goal',
    strategy: 'direct',
    parent: null,
    outcome: 'success',
    checkpoint_sha: null,
    iterations_used: 1,
    tokens_consumed: { input: 0, output: 0 },
    verify_result: {},
    fail_reason: null,
    diff_summary: null,
    ...overrides,
  };
}

function makeOutcome(goal: string): ExplorationOutcome {
  // Minimal shape — ExplorationOutcome is wider but we only need .exploration.goal
  // for computeExplorationStats. Cast through unknown to satisfy TS.
  return {
    exploration: { goal },
  } as unknown as ExplorationOutcome;
}

describe('computeExplorationStats — behavior', () => {
  test('returns empty array for empty inputs', () => {
    expect(computeExplorationStats([], [])).toEqual([]);
  });

  test('returns empty array when outcomes is non-empty but trace is empty', () => {
    const outcomes = [makeOutcome('search github')];
    expect(computeExplorationStats(outcomes, [])).toEqual([]);
  });

  test('returns empty array when trace is non-empty but outcomes is empty', () => {
    const trace = [makeTrace({ goal: 'search github', outcome: 'success' })];
    expect(computeExplorationStats([], trace)).toEqual([]);
  });

  test('skips trace records with whitespace-only goals', () => {
    const trace = [makeTrace({ goal: '   ', outcome: 'success' })];
    const outcomes = [makeOutcome('search github')];
    expect(computeExplorationStats(outcomes, trace)).toEqual([]);
  });

  test('omits outcomes that never executed (no trace match)', () => {
    const trace = [makeTrace({ goal: 'executed goal', outcome: 'success' })];
    const outcomes = [
      makeOutcome('executed goal'),
      makeOutcome('never executed'),
    ];
    const stats = computeExplorationStats(outcomes, trace);
    expect(stats.length).toBe(1);
    expect(stats[0].goalSample).toBe('executed goal');
  });

  test('deduplicates outcomes with same normalized goal', () => {
    const trace = [makeTrace({ goal: 'Search GitHub', outcome: 'success' })];
    // Both normalize to 'search github' (lowercased + trimmed)
    const outcomes = [
      makeOutcome('search github'),
      makeOutcome('Search GitHub'),
      makeOutcome(' SEARCH GITHUB '),
    ];
    const stats = computeExplorationStats(outcomes, trace);
    expect(stats.length).toBe(1);
  });

  test('counts totalAttempts = number of trace records for that goal', () => {
    const trace = [
      makeTrace({ goal: 'g', outcome: 'success', ts: 't1' }),
      makeTrace({ goal: 'g', outcome: 'failure', ts: 't2' }),
      makeTrace({ goal: 'g', outcome: 'abandoned', ts: 't3' }),
    ];
    const stats = computeExplorationStats([makeOutcome('g')], trace);
    expect(stats[0].totalAttempts).toBe(3);
  });

  test('counts successCount correctly', () => {
    const trace = [
      makeTrace({ goal: 'g', outcome: 'success', ts: 't1' }),
      makeTrace({ goal: 'g', outcome: 'failure', ts: 't2' }),
      makeTrace({ goal: 'g', outcome: 'success', ts: 't3' }),
    ];
    const stats = computeExplorationStats([makeOutcome('g')], trace);
    expect(stats[0].successCount).toBe(2);
  });

  test('counts failureCount correctly (ignores abandoned)', () => {
    const trace = [
      makeTrace({ goal: 'g', outcome: 'failure', ts: 't1' }),
      makeTrace({ goal: 'g', outcome: 'abandoned', ts: 't2' }),
      makeTrace({ goal: 'g', outcome: 'failure', ts: 't3' }),
    ];
    const stats = computeExplorationStats([makeOutcome('g')], trace);
    expect(stats[0].failureCount).toBe(2);
  });

  test('consecutiveFailures: 0 when most recent succeeded', () => {
    const trace = [
      makeTrace({ goal: 'g', outcome: 'failure', ts: 't1' }),
      makeTrace({ goal: 'g', outcome: 'success', ts: 't2' }),
    ];
    const stats = computeExplorationStats([makeOutcome('g')], trace);
    expect(stats[0].consecutiveFailures).toBe(0);
    expect(stats[0].lastSucceeded).toBe(true);
  });

  test('consecutiveFailures: walks back through failures, stops at non-failure', () => {
    const trace = [
      makeTrace({ goal: 'g', outcome: 'failure', ts: 't1' }),
      makeTrace({ goal: 'g', outcome: 'success', ts: 't2' }),
      makeTrace({ goal: 'g', outcome: 'failure', ts: 't3' }),
      makeTrace({ goal: 'g', outcome: 'failure', ts: 't4' }),
    ];
    const stats = computeExplorationStats([makeOutcome('g')], trace);
    expect(stats[0].consecutiveFailures).toBe(2);
    expect(stats[0].lastSucceeded).toBe(false);
  });

  test('consecutiveFailures counts abandoned as breaking the streak', () => {
    const trace = [
      makeTrace({ goal: 'g', outcome: 'failure', ts: 't1' }),
      makeTrace({ goal: 'g', outcome: 'failure', ts: 't2' }),
      makeTrace({ goal: 'g', outcome: 'abandoned', ts: 't3' }),
      makeTrace({ goal: 'g', outcome: 'failure', ts: 't4' }),
    ];
    const stats = computeExplorationStats([makeOutcome('g')], trace);
    expect(stats[0].consecutiveFailures).toBe(1);
  });

  test('demoted = true when consecutiveFailures >= 3', () => {
    const trace = [
      makeTrace({ goal: 'g', outcome: 'failure', ts: 't1' }),
      makeTrace({ goal: 'g', outcome: 'failure', ts: 't2' }),
      makeTrace({ goal: 'g', outcome: 'failure', ts: 't3' }),
    ];
    const stats = computeExplorationStats([makeOutcome('g')], trace);
    expect(stats[0].consecutiveFailures).toBe(3);
    expect(stats[0].demoted).toBe(true);
  });

  test('demoted = false when consecutiveFailures = 2 (below threshold)', () => {
    const trace = [
      makeTrace({ goal: 'g', outcome: 'failure', ts: 't1' }),
      makeTrace({ goal: 'g', outcome: 'failure', ts: 't2' }),
    ];
    const stats = computeExplorationStats([makeOutcome('g')], trace);
    expect(stats[0].consecutiveFailures).toBe(2);
    expect(stats[0].demoted).toBe(false);
  });

  test('does not mutate input trace', () => {
    const trace = [
      makeTrace({ goal: 'g', outcome: 'success', ts: 't1' }),
    ];
    const snapshot = JSON.stringify(trace);
    computeExplorationStats([makeOutcome('g')], trace);
    expect(JSON.stringify(trace)).toBe(snapshot);
  });

  test('does not mutate input outcomes', () => {
    const outcomes = [makeOutcome('g')];
    const snapshot = JSON.stringify(outcomes);
    const trace = [makeTrace({ goal: 'g', outcome: 'success', ts: 't1' })];
    computeExplorationStats(outcomes, trace);
    expect(JSON.stringify(outcomes)).toBe(snapshot);
  });

  test('sorts trace chronologically before walking (handles unsorted input)', () => {
    // Insert in reverse chronological order; compute should still detect
    // consecutive failures correctly after sorting.
    const trace = [
      makeTrace({ goal: 'g', outcome: 'failure', ts: 't4' }),
      makeTrace({ goal: 'g', outcome: 'failure', ts: 't3' }),
      makeTrace({ goal: 'g', outcome: 'success', ts: 't2' }),
      makeTrace({ goal: 'g', outcome: 'failure', ts: 't1' }),
    ];
    const stats = computeExplorationStats([makeOutcome('g')], trace);
    expect(stats[0].totalAttempts).toBe(4);
    expect(stats[0].consecutiveFailures).toBe(2);
    expect(stats[0].successCount).toBe(1);
    expect(stats[0].failureCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Behavioral — formatExplorationFeedback
// ---------------------------------------------------------------------------

describe('formatExplorationFeedback — behavior', () => {
  function makeStats(overrides: Partial<ExplorationStats> = {}): ExplorationStats {
    return {
      goalKey: 'k',
      goalSample: 'sample goal',
      totalAttempts: 1,
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
      lastSucceeded: false,
      demoted: false,
      ...overrides,
    };
  }

  test('returns empty string for empty input', () => {
    expect(formatExplorationFeedback([])).toBe('');
  });

  test('returns empty string when no stats carry signal', () => {
    const stats = [
      makeStats({ demoted: false, lastSucceeded: false }),
      makeStats({ demoted: false, lastSucceeded: false }),
    ];
    expect(formatExplorationFeedback(stats)).toBe('');
  });

  test('starts with ### Exploration feedback header', () => {
    const stats = [makeStats({ demoted: true, consecutiveFailures: 3 })];
    const out = formatExplorationFeedback(stats);
    expect(out.startsWith('### Exploration feedback')).toBe(true);
  });

  test('DEMOTED line: includes consecutive failure count + goal + skip instruction', () => {
    const stats = [
      makeStats({
        demoted: true,
        consecutiveFailures: 5,
        goalSample: 'extract json helper',
      }),
    ];
    const out = formatExplorationFeedback(stats);
    expect(out).toContain('- DEMOTED (5 consecutive failures): extract json helper — skip for now, pick a different aspiration');
  });

  test('SHIPPED line: marks aspiration closed', () => {
    const stats = [
      makeStats({
        demoted: false,
        lastSucceeded: true,
        goalSample: 'add feedback loop',
      }),
    ];
    const out = formatExplorationFeedback(stats);
    expect(out).toContain('- SHIPPED (succeeded): add feedback loop — aspiration closed, do not re-propose');
  });

  test('demoted takes priority when both demoted AND lastSucceeded (mutually exclusive in practice, but demoted wins)', () => {
    // In practice computeExplorationStats can't set both, but the format
    // function should pick demoted if both were somehow set.
    const stats = [
      makeStats({
        demoted: true,
        lastSucceeded: true,
        consecutiveFailures: 3,
        goalSample: 'g',
      }),
    ];
    const out = formatExplorationFeedback(stats);
    expect(out).toContain('DEMOTED');
    expect(out).not.toContain('SHIPPED');
  });

  test('truncates goal samples over 100 chars (using Unicode ellipsis)', () => {
    const long = 'x'.repeat(150);
    const stats = [
      makeStats({
        demoted: true,
        consecutiveFailures: 3,
        goalSample: long,
      }),
    ];
    const out = formatExplorationFeedback(stats);
    // The truncate helper produces: first 99 chars + '…' = 100 chars total
    expect(out).toContain('x'.repeat(99) + '…');
    expect(out).not.toContain('x'.repeat(100));
  });

  test('does not truncate goal samples under 100 chars', () => {
    const stats = [
      makeStats({
        demoted: true,
        consecutiveFailures: 3,
        goalSample: 'short',
      }),
    ];
    const out = formatExplorationFeedback(stats);
    expect(out).toContain('short');
  });

  test('multiple signal stats: one line each, joined with newlines', () => {
    const stats = [
      makeStats({
        demoted: true,
        consecutiveFailures: 3,
        goalSample: 'goal A',
      }),
      makeStats({
        demoted: false,
        lastSucceeded: true,
        goalSample: 'goal B',
      }),
    ];
    const out = formatExplorationFeedback(stats);
    const lines = out.split('\n');
    expect(lines.length).toBe(3); // header + 2 entries
    expect(lines[0]).toBe('### Exploration feedback');
    expect(lines[1]).toContain('DEMOTED');
    expect(lines[1]).toContain('goal A');
    expect(lines[2]).toContain('SHIPPED');
    expect(lines[2]).toContain('goal B');
  });

  test('no trailing newline in output', () => {
    const stats = [makeStats({ demoted: true, consecutiveFailures: 3 })];
    const out = formatExplorationFeedback(stats);
    expect(out.endsWith('\n')).toBe(false);
  });
});
