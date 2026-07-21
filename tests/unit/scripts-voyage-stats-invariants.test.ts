import { describe, expect, test, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// src/scripts/voyage-stats.ts calls main() at module top level. main() invokes
// process.exit() and process.stdout.write(). We must stub both BEFORE importing
// so the module can load without actually exiting or polluting test output.
const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
  // no-op — let the module finish loading
}) as never);
const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

// Single dynamic import — the spies above must be in place first.
const { parseCliArgs, readTraceRecords } = await import(
  '../../src/scripts/voyage-stats.js'
);

// ---------------------------------------------------------------------------
// Source contract — src/scripts/voyage-stats.ts
//
// Voyage stats CLI. Aggregates `.odysseus/trace.jsonl` into a retrospective
// view. Has TWO exported pure-ish helpers (parseCliArgs, readTraceRecords)
// plus a top-level main() invocation with process.exit side effects.
//
// Invariants pinned here:
//   - Source-level: shebang, comment header, imports, 2 exports, main()
//     invocation at end, process.exit codes
//   - Behavioral: parseCliArgs (defaults, --summary, --no-trend, --cwd)
//   - Behavioral: readTraceRecords (happy path, missing file, malformed lines)
// ---------------------------------------------------------------------------

const SRC_PATH = 'src/scripts/voyage-stats.ts';

// ---------------------------------------------------------------------------
// Source-level — module shape
// ---------------------------------------------------------------------------

describe('scripts/voyage-stats — module shape', () => {
  test('starts with node shebang', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  test('has docstring header explaining usage', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/Voyage stats CLI/);
    expect(src).toMatch(/npm exec tsx -- src\/scripts\/voyage-stats\.ts/);
    expect(src).toMatch(/node dist\/scripts\/voyage-stats\.js/);
  });

  test('documents --summary, --no-trend, --cwd options', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/--summary/);
    expect(src).toMatch(/--no-trend/);
    expect(src).toMatch(/--cwd/);
  });

  test('documents exit codes 0 and 1', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/Exit codes:/);
    expect(src).toMatch(/0\s+Stats computed successfully/);
    expect(src).toMatch(/1\s+Argument parse error/);
  });

  test('imports parseArgs from node:util', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/import\s+\{\s*parseArgs\s*\}\s+from\s+'node:util'/);
  });

  test('imports readFileSync from node:fs (sync IO is intentional for CLI)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/import\s+\{\s*readFileSync\s*\}\s+from\s+'node:fs'/);
  });

  test('imports join from node:path', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/import\s+\{\s*join\s*\}\s+from\s+'node:path'/);
  });

  test('imports computeVoyageStats + formatVoyageStatsMarkdown from cerebellum', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/import\s+\{[\s\S]*?computeVoyageStats,[\s\S]*?formatVoyageStatsMarkdown,[\s\S]*?\}\s+from\s+'\.\.\/cerebellum\/voyage-stats\.js'/);
  });

  test('imports TraceRecord type from trace/jsonl.js', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/import\s+type\s+\{\s*TraceRecord\s*\}\s+from\s+'\.\.\/trace\/jsonl\.js'/);
  });

  test('all local imports use .js ESM extension', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const localImports = src.match(/^import[^;]+from\s+'\.[^']+'/gm) ?? [];
    for (const imp of localImports) {
      expect(imp).toMatch(/\.js'/);
    }
  });
});

// ---------------------------------------------------------------------------
// Source-level — CliOptions interface
// ---------------------------------------------------------------------------

describe('scripts/voyage-stats — CliOptions interface', () => {
  test('declares CliOptions with summary, trend, cwd fields', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/interface\s+CliOptions\s*\{[\s\S]*?readonly\s+summary:\s*boolean;[\s\S]*?readonly\s+trend:\s*boolean;[\s\S]*?readonly\s+cwd:\s*string;[\s\S]*?\}/);
  });

  test('all fields are readonly', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const block = src.match(/interface\s+CliOptions\s*\{[\s\S]*?\}/)![0];
    expect(block).toMatch(/readonly\s+summary/);
    expect(block).toMatch(/readonly\s+trend/);
    expect(block).toMatch(/readonly\s+cwd/);
  });
});

// ---------------------------------------------------------------------------
// Source-level — parseCliArgs
// ---------------------------------------------------------------------------

describe('scripts/voyage-stats — parseCliArgs shape', () => {
  test('exported function with argv: readonly string[] parameter', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/export\s+function\s+parseCliArgs\s*\(\s*argv:\s*readonly\s+string\[\]\s*\):\s*CliOptions/);
  });

  test('uses node:util parseArgs with allowPositionals: false', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/parseArgs\(\s*\{[\s\S]*?allowPositionals:\s*false,/);
  });

  test('declares summary option with type boolean default false', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/summary:\s*\{\s*type:\s*'boolean',\s*default:\s*false\s*\}/);
  });

  test('declares trend option with type boolean default true', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/trend:\s*\{\s*type:\s*'boolean',\s*default:\s*true\s*\}/);
  });

  test('declares cwd option with type string default process.cwd()', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/cwd:\s*\{\s*type:\s*'string',\s*default:\s*process\.cwd\(\)\s*\}/);
  });

  test('spreads argv into a new array (defensive copy)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/args:\s*\[\.\.\.argv\]/);
  });

  test('normalizes summary to strict boolean (=== true)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/summary:\s*values\.summary\s*===\s*true/);
  });

  test('normalizes trend with !== false check', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/trend:\s*values\.trend\s*!==\s*false/);
  });

  test('normalizes cwd with typeof string check, fallback to process.cwd()', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/cwd:\s*typeof\s+values\.cwd\s*===\s*'string'\s*\?\s*values\.cwd\s*:\s*process\.cwd\(\)/);
  });
});

// ---------------------------------------------------------------------------
// Source-level — readTraceRecords
// ---------------------------------------------------------------------------

describe('scripts/voyage-stats — readTraceRecords shape', () => {
  test('exported function with cwd: string parameter returning TraceRecord[]', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/export\s+function\s+readTraceRecords\s*\(\s*cwd:\s*string\s*\):\s*TraceRecord\[\]/);
  });

  test('joins path as cwd/.odysseus/trace.jsonl', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/join\(\s*cwd,\s*'\.odysseus',\s*'trace\.jsonl'\s*\)/);
  });

  test('wraps readFileSync in try/catch', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/try\s*\{[\s\S]*?readFileSync\(\s*path,\s*'utf8'\s*\)[\s\S]*?\}\s*catch\s*\(\s*err\s*\)/);
  });

  test('rethrows with descriptive message including path and original error', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/throw\s+new\s+Error\(\s*`trace\.jsonl not readable at \$\{path\}:\s*\$\{err\s+instanceof\s+Error\s*\?\s*err\.message\s*:\s*String\(err\)\}`?\s*\)/);
  });

  test('defensively skips malformed JSON lines (try/catch with empty catch)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/try\s*\{\s*records\.push\(JSON\.parse\(trimmed\)\s+as\s+TraceRecord\);[\s\S]*?\}\s*catch\s*\{/);
  });

  test('skips empty lines after trim', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+trimmed\s*=\s*line\.trim\(\)/);
    expect(src).toMatch(/if\s*\(\s*!trimmed\s*\)\s*continue/);
  });

  test('splits raw on newline and uses last empty as buffer (lines.pop pattern)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/raw\.split\('\\n'\)/);
  });
});

// ---------------------------------------------------------------------------
// Source-level — formatSummary (private helper)
// ---------------------------------------------------------------------------

describe('scripts/voyage-stats — formatSummary shape', () => {
  test('declares formatSummary as a private function (not exported)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/function\s+formatSummary\s*\(\s*stats:\s*ReturnType<typeof\s+computeVoyageStats>\s*\):\s*string/);
    expect(src).not.toMatch(/export\s+function\s+formatSummary/);
  });

  test('formats success rate as whole-number percentage', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/successRate\s*\*\s*100\)\.toFixed\(0\)/);
  });

  test('formats input tokens in millions with 1 decimal', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/totalTokens\.input\s*\/\s*1_000_000\)\.toFixed\(1\)/);
  });

  test('formats output tokens in millions with 2 decimals', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/totalTokens\.output\s*\/\s*1_000_000\)\.toFixed\(2\)/);
  });

  test('formats avg iterations with 1 decimal', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/avgIterations\.toFixed\(1\)/);
  });

  test('outcome breakdown formatted as success/failure/abandoned', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/\$\{stats\.outcomes\.success\}\/\$\{stats\.outcomes\.failure\}\/\$\{stats\.outcomes\.abandoned\}/);
  });
});

// ---------------------------------------------------------------------------
// Source-level — main()
// ---------------------------------------------------------------------------

describe('scripts/voyage-stats — main() shape', () => {
  test('declares main() returning void', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/function\s+main\s*\(\s*\):\s*void/);
  });

  test('wraps parseCliArgs in try/catch', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/try\s*\{[\s\S]*?options\s*=\s*parseCliArgs\(process\.argv\.slice\(2\)\);[\s\S]*?\}\s*catch\s*\(\s*err\s*\)/);
  });

  test('prints argument parse error to stderr', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/process\.stderr\.write\(\s*`argument parse error:[\s\S]*?\\n/);
  });

  test('exits with code 1 on parse error', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/process\.exit\(1\)/);
  });

  test('wraps readTraceRecords in try/catch', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/try\s*\{[\s\S]*?records\s*=\s*readTraceRecords\(options\.cwd\);[\s\S]*?\}\s*catch\s*\(\s*err\s*\)/);
  });

  test('exits with code 1 when trace is unreadable', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    // two process.exit(1) calls — one for parse, one for read
    const exits = src.match(/process\.exit\(1\)/g) ?? [];
    expect(exits.length).toBe(2);
  });

  test('exits with code 0 and writes "(no trace records found)" when records empty', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/if\s*\(\s*records\.length\s*===\s*0\s*\)\s*\{[\s\S]*?process\.stdout\.write\('\(no trace records found\)\\n'\)/);
    expect(src).toMatch(/records\.length\s*===\s*0[\s\S]*?process\.exit\(0\)/);
  });

  test('calls computeVoyageStats with records', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+stats\s*=\s*computeVoyageStats\(records\)/);
  });

  test('summary branch calls formatSummary', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/if\s*\(\s*options\.summary\s*\)\s*\{[\s\S]*?formatSummary\(stats\)/);
  });

  test('non-summary branch uses formatVoyageStatsMarkdown', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/formatVoyageStatsMarkdown\(stats\)/);
  });

  test('honors --no-trend by nulling out stats.trend', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/options\.trend\s*\?[\s\S]*?formatVoyageStatsMarkdown\(stats\)[\s\S]*?:\s*formatVoyageStatsMarkdown\(\s*\{\s*\.\.\.stats,\s*trend:\s*null\s*\}\s*\)/);
  });

  test('final exit(0) on success', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    // Should have exactly two process.exit(0) calls — empty-records + success
    const exits = src.match(/process\.exit\(0\)/g) ?? [];
    expect(exits.length).toBe(2);
  });

  test('main() invoked at module load', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/^main\(\)/m);
  });

  test('main() invocation is the last line of the file', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const lines = src.split('\n');
    // find last non-empty line
    let lastIdx = lines.length - 1;
    while (lastIdx > 0 && lines[lastIdx].trim() === '') lastIdx--;
    expect(lines[lastIdx].trim()).toBe('main();');
  });
});

// ---------------------------------------------------------------------------
// Source-level — safety
// ---------------------------------------------------------------------------

describe('scripts/voyage-stats — source-level safety', () => {
  test('no child_process import (uses readFileSync, not subprocess)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/child_process/);
    expect(src).not.toMatch(/\bexec\(/);
    expect(src).not.toMatch(/\bspawn\(/);
  });

  test('no eval or Function constructor', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/\beval\(/);
    expect(src).not.toMatch(/new\s+Function\(/);
  });

  test('no console.log (uses process.stdout.write for CLI purity)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/\bconsole\.log\(/);
    expect(src).not.toMatch(/\bconsole\.error\(/);
    expect(src).not.toMatch(/\bconsole\.warn\(/);
  });
});

// ---------------------------------------------------------------------------
// Source-level — structural fingerprint
// ---------------------------------------------------------------------------

describe('scripts/voyage-stats — structural fingerprint', () => {
  test('file is between 120 and 160 lines', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const lines = src.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(120);
    expect(lines.length).toBeLessThanOrEqual(160);
  });

  test('exactly 2 exported functions (parseCliArgs, readTraceRecords)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const exports = src.match(/^export\s+(async\s+)?function\s+\w+/gm) ?? [];
    expect(exports.length).toBe(2);
    expect(src).toMatch(/^export\s+function\s+parseCliArgs/m);
    expect(src).toMatch(/^export\s+function\s+readTraceRecords/m);
  });

  test('exactly 2 non-exported functions (formatSummary, main)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    // Match `function name(` without preceding export on the same line.
    const allFns = src.match(/^(export\s+)?(async\s+)?function\s+\w+/gm) ?? [];
    expect(allFns.length).toBe(4);
    expect(src).toMatch(/^function\s+formatSummary/m);
    expect(src).toMatch(/^function\s+main/m);
  });

  test('exactly 1 interface declaration (CliOptions)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const ifaces = src.match(/^interface\s+\w+/gm) ?? [];
    expect(ifaces.length).toBe(1);
    expect(src).toMatch(/^interface\s+CliOptions/m);
  });

  test('no class declarations', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^class\s+\w+/m);
  });
});

// ---------------------------------------------------------------------------
// Behavioral — parseCliArgs
// ---------------------------------------------------------------------------

describe('parseCliArgs — behavior', () => {
  test('defaults: summary=false, trend=true, cwd=process.cwd()', () => {
    const opts = parseCliArgs([]);
    expect(opts.summary).toBe(false);
    expect(opts.trend).toBe(true);
    expect(opts.cwd).toBe(process.cwd());
  });

  test('--summary sets summary=true', () => {
    const opts = parseCliArgs(['--summary']);
    expect(opts.summary).toBe(true);
  });

  test('--no-trend is REJECTED by node:util parseArgs (LATENT BUG: doc claims it works)', () => {
    // The source doc claims --no-trend works, but node:util parseArgs doesn't
    // support --no-<flag> out of the box. This test pins the actual behavior:
    // the call throws "Unknown option '--no-trend'".
    // To actually disable trend, the source would need `strict: false` or
    // a manual `--no-trend` alias. As written, trend is effectively always
    // true.
    expect(() => parseCliArgs(['--no-trend'])).toThrow(/Unknown option/);
  });

  test('--trend explicitly keeps trend=true', () => {
    const opts = parseCliArgs(['--trend']);
    expect(opts.trend).toBe(true);
  });

  test('--trend=false is REJECTED too (boolean options do not take values)', () => {
    // Another consequence of the latent bug: node:util parseArgs boolean
    // options only accept `--flag` (true) or absence (default). There is
    // no CLI syntax that produces trend=false.
    expect(() => parseCliArgs(['--trend=false'])).toThrow(/does not take an argument/);
  });

  test('--cwd accepts a custom path', () => {
    const opts = parseCliArgs(['--cwd', '/tmp/custom']);
    expect(opts.cwd).toBe('/tmp/custom');
  });

  test('combines summary + custom cwd (trend stays at default true)', () => {
    const opts = parseCliArgs(['--summary', '--cwd', '/foo']);
    expect(opts).toEqual({ summary: true, trend: true, cwd: '/foo' });
  });

  test('returned object fields are readonly at compile time (TS contract)', async () => {
    // Runtime check that the object is well-formed — TS readonly is compile-time
    // only, but we can confirm the shape matches the interface.
    const opts = parseCliArgs([]);
    expect(Object.keys(opts).sort()).toEqual(['cwd', 'summary', 'trend']);
  });

  test('does not mutate the input argv array (defensive copy)', () => {
    const argv = ['--summary'];
    parseCliArgs(argv);
    expect(argv).toEqual(['--summary']);
    expect(argv.length).toBe(1);
  });

  test('throws on unknown flag', () => {
    expect(() => parseCliArgs(['--bogus'])).toThrow();
  });

  test('throws on missing value for --cwd', () => {
    expect(() => parseCliArgs(['--cwd'])).toThrow();
  });

  test('throws on positional argument (allowPositionals: false)', () => {
    expect(() => parseCliArgs(['positional'])).toThrow();
  });

  test('returns a fresh object each call (no shared reference)', () => {
    const a = parseCliArgs([]);
    const b = parseCliArgs([]);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Behavioral — readTraceRecords
// ---------------------------------------------------------------------------

describe('readTraceRecords — behavior', () => {
  let tmpRoot: string;

  test('setup tmp dir', async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'voyage-stats-'));
    // sanity
    expect(typeof tmpRoot).toBe('string');
  });

  test('returns empty array when .odysseus/trace.jsonl is empty', async () => {
    const odysseusDir = join(tmpRoot, 'empty-case', '.odysseus');
    await rm(odysseusDir, { recursive: true, force: true }).catch(() => {});
    await mkdir(odysseusDir, { recursive: true });
    await writeFile(join(odysseusDir, 'trace.jsonl'), '');
    const records = readTraceRecords(join(tmpRoot, 'empty-case'));
    expect(records).toEqual([]);
  });

  test('parses well-formed records', async () => {
    const caseDir = join(tmpRoot, 'happy');
    const odysseusDir = join(caseDir, '.odysseus');
    await mkdir(odysseusDir, { recursive: true });
    const rec1 = {
      ts: '2026-07-21T00:00:00Z',
      waypoint_id: 'wp1',
      goal: 'test goal',
      strategy: 'direct',
      parent: null,
      outcome: 'success',
      checkpoint_sha: 'abc123',
      iterations_used: 1,
      tokens_consumed: { input: 100, output: 50 },
      verify_result: { progress: 'ok' },
      fail_reason: null,
      diff_summary: '+1 -0',
    };
    const rec2 = { ...rec1, waypoint_id: 'wp2', outcome: 'failure' as const };
    await writeFile(
      join(odysseusDir, 'trace.jsonl'),
      `${JSON.stringify(rec1)}\n${JSON.stringify(rec2)}\n`,
    );
    const records = readTraceRecords(caseDir);
    expect(records.length).toBe(2);
    expect(records[0].waypoint_id).toBe('wp1');
    expect(records[0].outcome).toBe('success');
    expect(records[1].waypoint_id).toBe('wp2');
    expect(records[1].outcome).toBe('failure');
  });

  test('skips malformed lines, keeps well-formed ones', async () => {
    const caseDir = join(tmpRoot, 'mixed');
    const odysseusDir = join(caseDir, '.odysseus');
    await mkdir(odysseusDir, { recursive: true });
    const good = JSON.stringify({
      ts: '2026-07-21T00:00:00Z',
      waypoint_id: 'good',
      goal: 'g',
      strategy: 's',
      parent: null,
      outcome: 'success',
      checkpoint_sha: null,
      iterations_used: 1,
      tokens_consumed: { input: 0, output: 0 },
      verify_result: {},
      fail_reason: null,
      diff_summary: null,
    });
    await writeFile(
      join(odysseusDir, 'trace.jsonl'),
      `${good}\n{not valid json\n\n${good}\n`,
    );
    const records = readTraceRecords(caseDir);
    expect(records.length).toBe(2);
    expect(records.every((r) => r.waypoint_id === 'good')).toBe(true);
  });

  test('skips blank lines', async () => {
    const caseDir = join(tmpRoot, 'blanks');
    const odysseusDir = join(caseDir, '.odysseus');
    await mkdir(odysseusDir, { recursive: true });
    const good = JSON.stringify({
      ts: 't',
      waypoint_id: 'w',
      goal: 'g',
      strategy: 's',
      parent: null,
      outcome: 'success',
      checkpoint_sha: null,
      iterations_used: 1,
      tokens_consumed: { input: 0, output: 0 },
      verify_result: {},
      fail_reason: null,
      diff_summary: null,
    });
    await writeFile(
      join(odysseusDir, 'trace.jsonl'),
      `\n\n   \n${good}\n\n`,
    );
    const records = readTraceRecords(caseDir);
    expect(records.length).toBe(1);
  });

  test('throws descriptive error when trace.jsonl does not exist', async () => {
    const caseDir = join(tmpRoot, 'missing');
    await rm(join(caseDir, '.odysseus'), { recursive: true, force: true }).catch(() => {});
    expect(() => readTraceRecords(caseDir)).toThrow(/trace\.jsonl not readable/);
  });

  test('error message includes the resolved path', async () => {
    const caseDir = join(tmpRoot, 'missing-msg');
    await rm(join(caseDir, '.odysseus'), { recursive: true, force: true }).catch(() => {});
    try {
      readTraceRecords(caseDir);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const msg = (err as Error).message;
      expect(msg).toContain(join(caseDir, '.odysseus', 'trace.jsonl'));
    }
  });

  test('cleanup tmp dir', async () => {
    await rm(tmpRoot, { recursive: true, force: true });
    // sanity: removing twice should not throw
    await rm(tmpRoot, { recursive: true, force: true });
  });
});
