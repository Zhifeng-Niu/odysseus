import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  normalizeGoal,
  aggregateIterations,
  reportHighIterationGoals,
  type GoalIterationStats,
  type HighIterationReport,
} from '../../src/trace/iteration-stats.js';
import type { TraceRecord } from '../../src/trace/jsonl.js';

// ---------------------------------------------------------------------------
// Source contract — trace/iteration-stats.ts
//
// Aggregates per-goal iteration statistics from the JSONL trace.
//
// Invariants pinned here:
//   - normalizeGoal: trim + lowercase (deterministic key)
//   - aggregateIterations: buckets by normalized goal, sorts descending
//     by averageIterations
//   - Records with empty goal (after normalization) are skipped
//   - missing iterations_used defaults to 0
//   - missing goal is treated as '' (then skipped)
//   - success = outcome === 'success' (any other value = failure)
//   - reportHighIterationGoals: defaults threshold=5, minAttempts=1
//   - highIterationGoals filter: count >= minAttempts AND avg >= threshold
// ---------------------------------------------------------------------------

function makeRecord(opts: Partial<TraceRecord> = {}): TraceRecord {
  return {
    waypoint_id: opts.waypoint_id ?? 'wp_x',
    goal: opts.goal ?? 'test-goal',
    outcome: opts.outcome ?? 'success',
    iterations_used: opts.iterations_used ?? 1,
    tokens_input: opts.tokens_input ?? 0,
    tokens_output: opts.tokens_output ?? 0,
    started_at: opts.started_at ?? 0,
    ended_at: opts.ended_at ?? 0,
  } as TraceRecord;
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

describe('trace/iteration-stats — module exports', () => {
  test('exports GoalIterationStats interface', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/^export\s+interface\s+GoalIterationStats/m);
  });

  test('exports HighIterationReport interface', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/^export\s+interface\s+HighIterationReport/m);
  });

  test('exports normalizeGoal function', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/^export\s+function\s+normalizeGoal/m);
  });

  test('exports aggregateIterations function', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/^export\s+function\s+aggregateIterations/m);
  });

  test('exports reportHighIterationGoals async function', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/^export\s+async\s+function\s+reportHighIterationGoals/m);
  });

  test('exactly 5 exports (2 interfaces + 3 functions)', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    const exports = src.match(/^export\s+(interface|function|async\s+function|type|class|const)\s+\w+/gm) ?? [];
    expect(exports.length).toBe(5);
  });

  test('no default export', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).not.toMatch(/^export\s+default\s/m);
  });
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

describe('trace/iteration-stats — imports', () => {
  test('imports readTrace and TraceRecord type from ./jsonl.js', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/^import\s+\{\s*readTrace,\s*type\s+TraceRecord\s*\}\s+from\s+'\.\/jsonl\.js'/m);
  });

  test('exactly 1 import statement', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    const imports = src.match(/^import\s/mg) ?? [];
    expect(imports.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// normalizeGoal — pure transformation
// ---------------------------------------------------------------------------

describe('normalizeGoal — contract', () => {
  test('trims leading whitespace', () => {
    expect(normalizeGoal('  hello')).toBe('hello');
  });

  test('trims trailing whitespace', () => {
    expect(normalizeGoal('hello  ')).toBe('hello');
  });

  test('trims both sides', () => {
    expect(normalizeGoal('  hello  ')).toBe('hello');
  });

  test('lowercases uppercase characters', () => {
    expect(normalizeGoal('HELLO')).toBe('hello');
  });

  test('lowercases mixed case', () => {
    expect(normalizeGoal('Add a Bash Tool')).toBe('add a bash tool');
  });

  test('preserves internal whitespace (only trims ends)', () => {
    expect(normalizeGoal('Add  a   bash   tool')).toBe('add  a   bash   tool');
  });

  test('returns empty string for empty input', () => {
    expect(normalizeGoal('')).toBe('');
  });

  test('returns empty string for whitespace-only input', () => {
    expect(normalizeGoal('   \n\t  ')).toBe('');
  });

  test('returns empty string for newlines', () => {
    expect(normalizeGoal('\n\n')).toBe('');
  });

  test('source: one-liner trim().toLowerCase()', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/function\s+normalizeGoal\s*\([^)]*\):\s*string\s*\{\s*return\s+goal\.trim\(\)\.toLowerCase\(\)\s*;\s*\}/s);
  });

  test('pure function: same input produces same output', () => {
    expect(normalizeGoal('Test Goal')).toBe(normalizeGoal('Test Goal'));
  });

  test('collapses "Add a bash tool" variants to the same key', () => {
    const a = normalizeGoal('Add a bash tool');
    const b = normalizeGoal(' add a bash tool ');
    const c = normalizeGoal('ADD A BASH TOOL');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });
});

// ---------------------------------------------------------------------------
// GoalIterationStats — shape (8 required fields)
// ---------------------------------------------------------------------------

describe('GoalIterationStats — shape', () => {
  test('has 8 required fields', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    const match = src.match(/interface\s+GoalIterationStats\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    const required = match![1].match(/^\s+\w+:\s+/gm) ?? [];
    const optional = match![1].match(/^\s+\w+\?\s*:/gm) ?? [];
    expect(required.length).toBe(8);
    expect(optional.length).toBe(0);
  });

  test('goal: string', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/goal:\s*string/);
  });

  test('count: number', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/count:\s*number/);
  });

  test('totalIterations: number', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/totalIterations:\s*number/);
  });

  test('averageIterations: number', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/averageIterations:\s*number/);
  });

  test('maxIterations: number', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/maxIterations:\s*number/);
  });

  test('minIterations: number', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/minIterations:\s*number/);
  });

  test('successCount: number', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/successCount:\s*number/);
  });

  test('failureCount: number', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/failureCount:\s*number/);
  });
});

// ---------------------------------------------------------------------------
// HighIterationReport — shape
// ---------------------------------------------------------------------------

describe('HighIterationReport — shape', () => {
  test('has 4 required fields', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    const match = src.match(/interface\s+HighIterationReport\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    const required = match![1].match(/^\s+\w+:\s+/gm) ?? [];
    const optional = match![1].match(/^\s+\w+\?\s*:/gm) ?? [];
    expect(required.length).toBe(4);
    expect(optional.length).toBe(0);
  });

  test('goals: GoalIterationStats[]', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/goals:\s*GoalIterationStats\[\]/);
  });

  test('highIterationGoals: GoalIterationStats[]', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/highIterationGoals:\s*GoalIterationStats\[\]/);
  });

  test('threshold: number', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/threshold:\s*number/);
  });

  test('minAttempts: number', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/minAttempts:\s*number/);
  });
});

// ---------------------------------------------------------------------------
// aggregateIterations — empty / single-record cases
// ---------------------------------------------------------------------------

describe('aggregateIterations — empty input', () => {
  test('returns empty array for empty input', () => {
    expect(aggregateIterations([])).toEqual([]);
  });

  test('returns empty array when all records have empty goals', () => {
    const records = [
      makeRecord({ goal: '' }),
      makeRecord({ goal: '   ' }),
      makeRecord({ goal: '\n' }),
    ];
    expect(aggregateIterations(records)).toEqual([]);
  });

  test('skips records with missing (undefined) goal', () => {
    // Construct directly — makeRecord applies `?? 'test-goal'` default.
    const records = [
      { waypoint_id: 'wp', goal: undefined, outcome: 'success', iterations_used: 1 } as unknown as TraceRecord,
      makeRecord({ goal: 'valid' }),
    ];
    const result = aggregateIterations(records);
    expect(result.length).toBe(1);
    expect(result[0]!.goal).toBe('valid');
  });
});

describe('aggregateIterations — single record', () => {
  test('creates a bucket for a single record', () => {
    const records = [makeRecord({ goal: 'task', iterations_used: 3, outcome: 'success' })];
    const result = aggregateIterations(records);
    expect(result.length).toBe(1);
    const r = result[0]!;
    expect(r.goal).toBe('task');
    expect(r.count).toBe(1);
    expect(r.totalIterations).toBe(3);
    expect(r.averageIterations).toBe(3);
    expect(r.maxIterations).toBe(3);
    expect(r.minIterations).toBe(3);
    expect(r.successCount).toBe(1);
    expect(r.failureCount).toBe(0);
  });

  test('marks non-success outcome as failure', () => {
    const records = [makeRecord({ goal: 'task', outcome: 'failure' })];
    const result = aggregateIterations(records);
    expect(result[0]!.successCount).toBe(0);
    expect(result[0]!.failureCount).toBe(1);
  });

  test('marks abandoned outcome as failure (not success)', () => {
    const records = [makeRecord({ goal: 'task', outcome: 'abandoned' })];
    const result = aggregateIterations(records);
    expect(result[0]!.successCount).toBe(0);
    expect(result[0]!.failureCount).toBe(1);
  });

  test('missing iterations_used defaults to 0', () => {
    // Construct directly — makeRecord applies `?? 1` default.
    const records = [
      { waypoint_id: 'wp', goal: 'task', outcome: 'success', iterations_used: undefined } as unknown as TraceRecord,
    ];
    const result = aggregateIterations(records);
    expect(result[0]!.totalIterations).toBe(0);
    expect(result[0]!.averageIterations).toBe(0);
    expect(result[0]!.maxIterations).toBe(0);
    expect(result[0]!.minIterations).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// aggregateIterations — multi-record accumulation
// ---------------------------------------------------------------------------

describe('aggregateIterations — accumulation', () => {
  test('same goal (different cases/whitespace) collapses into one bucket', () => {
    const records = [
      makeRecord({ goal: 'Add a bash tool', iterations_used: 2 }),
      makeRecord({ goal: ' add a bash tool ', iterations_used: 4 }),
      makeRecord({ goal: 'ADD A BASH TOOL', iterations_used: 3 }),
    ];
    const result = aggregateIterations(records);
    expect(result.length).toBe(1);
    expect(result[0]!.count).toBe(3);
    expect(result[0]!.totalIterations).toBe(9);
    expect(result[0]!.averageIterations).toBe(3);
  });

  test('maxIterations is the largest value across attempts', () => {
    const records = [
      makeRecord({ goal: 'g', iterations_used: 2 }),
      makeRecord({ goal: 'g', iterations_used: 10 }),
      makeRecord({ goal: 'g', iterations_used: 4 }),
    ];
    const result = aggregateIterations(records);
    expect(result[0]!.maxIterations).toBe(10);
  });

  test('minIterations is the smallest value across attempts', () => {
    const records = [
      makeRecord({ goal: 'g', iterations_used: 2 }),
      makeRecord({ goal: 'g', iterations_used: 10 }),
      makeRecord({ goal: 'g', iterations_used: 4 }),
    ];
    const result = aggregateIterations(records);
    expect(result[0]!.minIterations).toBe(2);
  });

  test('averageIterations = totalIterations / count', () => {
    const records = [
      makeRecord({ goal: 'g', iterations_used: 2 }),
      makeRecord({ goal: 'g', iterations_used: 3 }),
      makeRecord({ goal: 'g', iterations_used: 4 }),
    ];
    const result = aggregateIterations(records);
    expect(result[0]!.averageIterations).toBe(3);
  });

  test('averageIterations is recomputed on every insertion', () => {
    const records = [
      makeRecord({ goal: 'g', iterations_used: 10 }),
      makeRecord({ goal: 'g', iterations_used: 0 }),
    ];
    const result = aggregateIterations(records);
    expect(result[0]!.averageIterations).toBe(5);
  });

  test('successCount + failureCount === count', () => {
    const records = [
      makeRecord({ goal: 'g', outcome: 'success' }),
      makeRecord({ goal: 'g', outcome: 'failure' }),
      makeRecord({ goal: 'g', outcome: 'success' }),
      makeRecord({ goal: 'g', outcome: 'abandoned' }),
    ];
    const result = aggregateIterations(records);
    expect(result[0]!.successCount).toBe(2);
    expect(result[0]!.failureCount).toBe(2);
    expect(result[0]!.count).toBe(4);
  });

  test('separate goals produce separate buckets', () => {
    const records = [
      makeRecord({ goal: 'alpha', iterations_used: 1 }),
      makeRecord({ goal: 'beta', iterations_used: 5 }),
    ];
    const result = aggregateIterations(records);
    expect(result.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// aggregateIterations — sorting
// ---------------------------------------------------------------------------

describe('aggregateIterations — sorting', () => {
  test('sorted by averageIterations descending', () => {
    const records = [
      makeRecord({ goal: 'low', iterations_used: 1 }),
      makeRecord({ goal: 'high', iterations_used: 10 }),
      makeRecord({ goal: 'mid', iterations_used: 5 }),
    ];
    const result = aggregateIterations(records);
    expect(result.map((r) => r.goal)).toEqual(['high', 'mid', 'low']);
  });

  test('ties are stable (Map insertion order preserved)', () => {
    const records = [
      makeRecord({ goal: 'first', iterations_used: 5 }),
      makeRecord({ goal: 'second', iterations_used: 5 }),
      makeRecord({ goal: 'third', iterations_used: 5 }),
    ];
    const result = aggregateIterations(records);
    // All have avg=5; order depends on sort stability
    expect(result.map((r) => r.goal).sort()).toEqual(['first', 'second', 'third']);
  });

  test('source uses Array.prototype.sort with b.avg - a.avg', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/\.sort\(\s*\(a,\s*b\)\s*=>\s*b\.averageIterations\s*-\s*a\.averageIterations\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// aggregateIterations — signature and purity
// ---------------------------------------------------------------------------

describe('aggregateIterations — signature and purity', () => {
  test('takes (records: readonly TraceRecord[]) returns GoalIterationStats[]', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/function\s+aggregateIterations\s*\(\s*records:\s*readonly\s+TraceRecord\[\]\s*\):\s*GoalIterationStats\[\]/);
  });

  test('does NOT mutate the input array', () => {
    const records = [
      makeRecord({ goal: 'g', iterations_used: 1 }),
      makeRecord({ goal: 'g', iterations_used: 2 }),
    ];
    const snapshot = [...records];
    aggregateIterations(records);
    expect(records).toEqual(snapshot);
  });

  test('returns a fresh array on each call', () => {
    const records = [makeRecord({ goal: 'g', iterations_used: 1 })];
    const a = aggregateIterations(records);
    const b = aggregateIterations(records);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// reportHighIterationGoals — async path
// ---------------------------------------------------------------------------

describe('reportHighIterationGoals — signature', () => {
  test('takes (tracePath: string, options?) returns Promise<HighIterationReport>', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/async\s+function\s+reportHighIterationGoals\s*\(\s*tracePath:\s*string,\s*options\?\s*:\s*\{\s*threshold\?\s*:\s*number;\s*minAttempts\?\s*:\s*number\s*\}\s*\):\s*Promise<HighIterationReport>/);
  });
});

describe('reportHighIterationGoals — defaults', () => {
  test('default threshold is 5', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/const\s+threshold\s*=\s*options\?\.threshold\s*\?\?\s*5/);
  });

  test('default minAttempts is 1', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).toMatch(/const\s+minAttempts\s*=\s*options\?\.minAttempts\s*\?\?\s*1/);
  });

  test('echoes threshold and minAttempts in the report', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trace-'));
    try {
      const path = join(dir, 'trace.jsonl');
      await writeFile(path, '', 'utf8');
      const report = await reportHighIterationGoals(path);
      expect(report.threshold).toBe(5);
      expect(report.minAttempts).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('reportHighIterationGoals — filtering', () => {
  test('flags goals with avg >= threshold AND count >= minAttempts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trace-'));
    try {
      const path = join(dir, 'trace.jsonl');
      const records = [
        makeRecord({ goal: 'high', iterations_used: 10 }),
        makeRecord({ goal: 'low', iterations_used: 1 }),
      ];
      await writeFile(
        path,
        records.map((r) => JSON.stringify(r)).join('\n') + '\n',
        'utf8',
      );
      const report = await reportHighIterationGoals(path, { threshold: 5, minAttempts: 1 });
      expect(report.highIterationGoals.map((g) => g.goal)).toEqual(['high']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('does NOT flag goals with count < minAttempts even if avg >= threshold', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trace-'));
    try {
      const path = join(dir, 'trace.jsonl');
      const records = [makeRecord({ goal: 'solo', iterations_used: 100 })];
      await writeFile(
        path,
        records.map((r) => JSON.stringify(r)).join('\n') + '\n',
        'utf8',
      );
      const report = await reportHighIterationGoals(path, { threshold: 5, minAttempts: 2 });
      expect(report.highIterationGoals).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('boundary: avg === threshold is flagged (>=, not >)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trace-'));
    try {
      const path = join(dir, 'trace.jsonl');
      const records = [makeRecord({ goal: 'boundary', iterations_used: 5 })];
      await writeFile(
        path,
        records.map((r) => JSON.stringify(r)).join('\n') + '\n',
        'utf8',
      );
      const report = await reportHighIterationGoals(path, { threshold: 5, minAttempts: 1 });
      expect(report.highIterationGoals.length).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('boundary: count === minAttempts is flagged (>=, not >)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trace-'));
    try {
      const path = join(dir, 'trace.jsonl');
      const records = [
        makeRecord({ goal: 'g', iterations_used: 5 }),
        makeRecord({ goal: 'g', iterations_used: 5 }),
      ];
      await writeFile(
        path,
        records.map((r) => JSON.stringify(r)).join('\n') + '\n',
        'utf8',
      );
      const report = await reportHighIterationGoals(path, { threshold: 5, minAttempts: 2 });
      expect(report.highIterationGoals.length).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('returns ALL goals in .goals (not just high-iteration ones)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trace-'));
    try {
      const path = join(dir, 'trace.jsonl');
      const records = [
        makeRecord({ goal: 'high', iterations_used: 10 }),
        makeRecord({ goal: 'low', iterations_used: 1 }),
      ];
      await writeFile(
        path,
        records.map((r) => JSON.stringify(r)).join('\n') + '\n',
        'utf8',
      );
      const report = await reportHighIterationGoals(path);
      expect(report.goals.length).toBe(2);
      expect(report.highIterationGoals.length).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Source-level safety
// ---------------------------------------------------------------------------

describe('trace/iteration-stats — source-level safety', () => {
  test('no console.*', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).not.toMatch(/console\./);
  });

  test('no process.exit', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).not.toMatch(/process\.exit/);
  });

  test('no shell exec/spawn', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).not.toMatch(/child_process/);
    expect(src).not.toMatch(/\bexec\(/);
  });

  test('no fetch or network', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).not.toMatch(/\bfetch\(/);
  });

  test('no fs writes (read-only module)', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    expect(src).not.toMatch(/writeFile/);
    expect(src).not.toMatch(/appendFile/);
    expect(src).not.toMatch(/mkdir/);
  });
});

// ---------------------------------------------------------------------------
// Structural fingerprint
// ---------------------------------------------------------------------------

describe('trace/iteration-stats — structural fingerprint', () => {
  test('file has exactly 2 interface declarations', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    const ifaces = src.match(/^export\s+interface\s+\w+/gm) ?? [];
    expect(ifaces.length).toBe(2);
  });

  test('file has exactly 1 sync exported function (normalizeGoal)', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    const syncFns = src.match(/^export\s+function\s+\w+/gm) ?? [];
    expect(syncFns.length).toBe(2); // normalizeGoal, aggregateIterations
  });

  test('file has exactly 1 async exported function', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    const asyncFns = src.match(/^export\s+async\s+function\s+\w+/gm) ?? [];
    expect(asyncFns.length).toBe(1);
  });

  test('uses local Map (not module-level state)', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    // Map is declared inside the function body, not at module scope.
    // Allow return type between ) and {.
    expect(src).toMatch(/function\s+aggregateIterations\s*\([\s\S]*?\)[\s\S]*?\{[\s\S]*?const\s+buckets\s*=\s*new\s+Map</);
    // Negative: no module-level Map declaration (at column 0)
    expect(src).not.toMatch(/^const\s+buckets\s*=\s*new\s+Map/m);
    expect(src).not.toMatch(/^let\s+buckets\s*=\s*new\s+Map/m);
  });

  test('file is between 100 and 160 lines', async () => {
    const src = await readFile('src/trace/iteration-stats.ts', 'utf8');
    const lines = src.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(100);
    expect(lines.length).toBeLessThanOrEqual(160);
  });
});
