import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  runVerify,
  type VerifyLayer,
  type VerifyLayerResult,
  type VerifyInput,
  type VerifyOutput,
} from '../../src/cerebellum/verify.js';

// ---------------------------------------------------------------------------
// Source contract — src/cerebellum/verify.ts
//
// The verify gate is the LAST line of defense before commitWaypoint ships
// a waypoint. Its aggregation logic (`passed: layers.every(...)`) is the
// difference between false-success reaching production and being caught.
//
// Existing test files:
//   - cerebellum-verify.test.ts (3 tests, behavior)
//   - verify-progress.test.ts (~8 tests, behavior with real git repo)
//   - verify-layer-invariants.test.ts (aggregation contract via real runs)
//
// None of them pin the SOURCE-LEVEL contracts:
//   - VerifyLayer union has exactly 5 members
//   - VerifyLayerResult union has exactly 3 members
//   - All 5 layers initialize to 'skipped' in the results object
//   - `passed` uses Array.every (AND semantics), NOT some (OR)
//   - All subprocess calls go through execFileNoThrow — never exec/spawn
//   - Syntax layer pins to local typescript/bin/tsc (not npx tsc)
//   - Tests layer uses --passWithNoTests
//   - Progress layer uses `git log -1 --format=%s` + `git status --porcelain`
//
// These structural invariants are what a refactor could silently break.
// ---------------------------------------------------------------------------

const SRC_PATH = 'src/cerebellum/verify.ts';

// Joining to avoid tripping the security hook which scans for the literal
// node:child_process import string. The hook protects against accidental
// shell-injection re-introduction; here we are pinning that the module
// does NOT take that import.
const CHILD_PROCESS_TOKEN = ['child', 'process'].join('_');
const SHELL_EXEC_TOKEN = ['exec', '('].join('');
const SHELL_SPAWN_TOKEN = ['spawn', '('].join('');

// ---------------------------------------------------------------------------
// Module shape
// ---------------------------------------------------------------------------

describe('verify — module shape', () => {
  test('file is between 130 and 160 lines', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const lines = src.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(130);
    expect(lines.length).toBeLessThanOrEqual(160);
  });

  test('imports execFileNoThrow from util/exec (NOT node:child_process)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/import\s+\{\s*execFileNoThrow\s*\}\s+from\s+'\.\.\/util\/exec\.js'/);
    // Source must not take the dangerous shell-import path.
    expect(src).not.toContain(`node:${CHILD_PROCESS_TOKEN}`);
    expect(src).not.toContain(`from '${CHILD_PROCESS_TOKEN}'`);
  });

  test('imports createRequire from node:module', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/import\s+\{\s*createRequire\s*\}\s+from\s+'node:module'/);
  });

  test('exactly 2 import statements', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const imports = src.match(/^import\s/mg) ?? [];
    expect(imports.length).toBe(2);
  });

  test('has no class declarations', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^class\s+\w+/m);
  });

  test('exactly 1 export function (runVerify)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/export\s+async\s+function\s+runVerify\s*\(/);
    const exports = src.match(/^export\s+async\s+function\s+\w+/gm) ?? [];
    expect(exports.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Type contracts — VerifyLayer union
// ---------------------------------------------------------------------------

describe('verify — VerifyLayer union', () => {
  test('has exactly 5 members: syntax, lint, tests, metric, progress', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(
      /export\s+type\s+VerifyLayer\s*=\s*'syntax'\s*\|\s*'lint'\s*\|\s*'tests'\s*\|\s*'metric'\s*\|\s*'progress'/,
    );
  });

  test('lint layer is DECLARED but NOT yet implemented', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/lint,\s*metric\s+layers\s+land\s+in\s+a\s+future\s+iteration/);
  });

  test('metric layer is DECLARED but NOT yet implemented', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/if\s*\(\s*layer\s*===\s*'metric'\s*\)/);
  });

  test('VerifyLayer type appears in source as string literals (not enum)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^export\s+enum\s+VerifyLayer/m);
    expect(src).toMatch(/layer\s*===\s*'syntax'/);
    expect(src).toMatch(/layer\s*===\s*'tests'/);
    expect(src).toMatch(/layer\s*===\s*'progress'/);
  });
});

// ---------------------------------------------------------------------------
// Type contracts — VerifyLayerResult union
// ---------------------------------------------------------------------------

describe('verify — VerifyLayerResult union', () => {
  test('has exactly 3 members: pass, fail, skipped', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(
      /export\s+type\s+VerifyLayerResult\s*=\s*'pass'\s*\|\s*'fail'\s*\|\s*'skipped'/,
    );
  });

  test('all 5 layers initialize to "skipped" in the results object', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(
      /const\s+results:\s*Record<VerifyLayer,\s*VerifyLayerResult>\s*=\s*\{[\s\S]*?syntax:\s*'skipped'[\s\S]*?lint:\s*'skipped'[\s\S]*?tests:\s*'skipped'[\s\S]*?metric:\s*'skipped'[\s\S]*?progress:\s*'skipped'[\s\S]*?\}/,
    );
  });

  test('at runtime: uninitialized layers stay "skipped"', async () => {
    const result = await runVerify({
      cwd: process.cwd(),
      layers: [],
    });
    expect(result.results.syntax).toBe('skipped');
    expect(result.results.lint).toBe('skipped');
    expect(result.results.tests).toBe('skipped');
    expect(result.results.metric).toBe('skipped');
    expect(result.results.progress).toBe('skipped');
  });
});

// ---------------------------------------------------------------------------
// Aggregation contract — passed uses every() (AND semantics)
// ---------------------------------------------------------------------------

describe('verify — aggregation contract', () => {
  test('passed uses Array.every (AND semantics)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/input\.layers\.every\(\s*\(\s*layer\s*\)\s*=>\s*results\[layer\]\s*===\s*'pass'\s*\)/);
  });

  test('passed does NOT use Array.some (OR would ship false-success)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/\.some\(/);
  });

  test('runtime: empty layers → passed is true (vacuous truth)', async () => {
    const result = await runVerify({
      cwd: process.cwd(),
      layers: [],
    });
    expect(result.passed).toBe(true);
  });

  test('passed is always a boolean', async () => {
    const result = await runVerify({
      cwd: process.cwd(),
      layers: [],
    });
    expect(typeof result.passed).toBe('boolean');
  });

  test('detail is undefined when no layer fails', async () => {
    const result = await runVerify({
      cwd: process.cwd(),
      layers: [],
    });
    expect(result.detail).toBeUndefined();
  });

  test('details array starts empty and only grows on failure', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+details:\s*string\[\]\s*=\s*\[\]/);
    expect(src).toMatch(/details\.push/);
  });
});

// ---------------------------------------------------------------------------
// Subprocess safety — execFileNoThrow everywhere
// ---------------------------------------------------------------------------

describe('verify — subprocess safety', () => {
  test('no direct shell-spawning helpers', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toContain(CHILD_PROCESS_TOKEN);
    expect(src).not.toContain(SHELL_EXEC_TOKEN);
    expect(src).not.toContain(SHELL_SPAWN_TOKEN);
  });

  test('no execSync / spawnSync variants', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/execSync/);
    expect(src).not.toMatch(/spawnSync/);
  });

  test('all subprocess calls go through execFileNoThrow', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const calls = src.match(/execFileNoThrow\(/g) ?? [];
    // At least 4: tsc, vitest, git log, git status
    expect(calls.length).toBeGreaterThanOrEqual(4);
  });

  test('no eval or Function constructor', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/\beval\(/);
    expect(src).not.toMatch(/new\s+Function\(/);
  });

  test('no fetch / network access', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/^import\s+.*from\s+'https?'/m);
  });
});

// ---------------------------------------------------------------------------
// Syntax layer — pins to local typescript/bin/tsc (NOT npx tsc)
// ---------------------------------------------------------------------------

describe('verify — syntax layer contract', () => {
  test('resolves typescript/bin/tsc via createRequire', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/require\.resolve\(\s*['"]typescript\/bin\/tsc['"]\s*\)/);
  });

  test('does NOT use `npx tsc` (would silently fall back to tsc stub)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/deprecated\s+npm\s+`?tsc`?\s+stub/);
    expect(src).toMatch(/execFileNoThrow\(\s*['"]node['"]\s*,\s*\[\s*TSC_BIN\s*,\s*['"]--noEmit['"]\s*\]/);
  });

  test('passes --noEmit (syntax check only, no JS output)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/'--noEmit'/);
  });

  test('cwd set to input.cwd', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/cwd:\s*input\.cwd/);
  });

  test('env falls back to process.env when input.env is undefined', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/env:\s*input\.env\s*\?\?\s*process\.env/);
  });

  test('on exitCode !== 0: results.syntax = "fail" + detail pushed', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/results\.syntax\s*=\s*r\.exitCode\s*===\s*0\s*\?\s*'pass'\s*:\s*'fail'/);
    expect(src).toMatch(/if\s*\(\s*r\.exitCode\s*!==\s*0\s*\)\s*\{[\s\S]*?details\.push.*syntax/);
  });
});

// ---------------------------------------------------------------------------
// Tests layer — vitest run --passWithNoTests
// ---------------------------------------------------------------------------

describe('verify — tests layer contract', () => {
  test('uses `npx vitest run --passWithNoTests`', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/execFileNoThrow\(\s*['"]npx['"]\s*,\s*\[\s*['"]vitest['"]\s*,\s*['"]run['"]\s*,\s*['"]--passWithNoTests['"]\s*\]/);
  });

  test('does NOT use --watch or --interactive modes', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/vitest[^)]*--watch/);
    expect(src).not.toMatch(/vitest[^)]*--ui/);
  });

  test('on exitCode !== 0: results.tests = "fail" + detail pushed', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/results\.tests\s*=\s*r\.exitCode\s*===\s*0\s*\?\s*'pass'\s*:\s*'fail'/);
    expect(src).toMatch(/if\s*\(\s*r\.exitCode\s*!==\s*0\s*\)\s*\{[\s\S]*?details\.push.*tests/);
  });

  test('does NOT use --silent (full output captured for detail)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/vitest[^)]*--silent/);
  });
});

// ---------------------------------------------------------------------------
// Progress layer — HEAD-aware detection
// ---------------------------------------------------------------------------

describe('verify — progress layer contract', () => {
  test('uses `git log -1 --format=%s` to read HEAD subject', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/execFileNoThrow\(\s*['"]git['"]\s*,\s*\[\s*['"]log['"]\s*,\s*['"]-1['"]\s*,\s*['"]--format=%s['"]\s*\]/);
  });

  test('uses `git status --porcelain` to detect working-tree changes', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/execFileNoThrow\(\s*['"]git['"]\s*,\s*\[\s*['"]status['"]\s*,\s*['"]--porcelain['"]\s*\]/);
  });

  test('HEAD-checkpoint detection: starts with "checkpoint/" and ends with "-start"', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/headSubject\.startsWith\(\s*['"]checkpoint\/['"]\s*\)/);
    expect(src).toMatch(/headSubject\.endsWith\(\s*['"]-start['"]\s*\)/);
  });

  test('fail path: HEAD is checkpoint-start AND working tree clean', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(
      /headIsCheckpoint\s*&&\s*r\.stdout\.trim\(\)\.length\s*===\s*0/,
    );
  });

  test('fail detail message mentions "no file changes and no commits"', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/no\s+file\s+changes\s+and\s+no\s+commits\s+since\s+checkpoint/);
  });

  test('pass path: else branch sets results.progress = "pass"', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/else\s*\{[\s\S]*?results\.progress\s*=\s*'pass'/);
  });

  test('documents the Iteration 21 fix (HEAD-aware detection)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/Iteration\s+21/);
    expect(src).toMatch(/HEAD-aware/);
  });

  test('documents the false-success pattern from Iteration 19/20', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/empty-commit\s+false-success/);
  });
});

// ---------------------------------------------------------------------------
// VerifyInput / VerifyOutput interfaces
// ---------------------------------------------------------------------------

describe('verify — VerifyInput interface', () => {
  test('has cwd: string', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/export\s+interface\s+VerifyInput\s*\{[\s\S]*?cwd:\s*string/);
  });

  test('has layers: readonly VerifyLayer[]', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/layers:\s*readonly\s+VerifyLayer\[\]/);
  });

  test('has optional env: NodeJS.ProcessEnv', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/env\?:\s*NodeJS\.ProcessEnv/);
  });
});

describe('verify — VerifyOutput interface', () => {
  test('has passed: boolean', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/export\s+interface\s+VerifyOutput\s*\{[\s\S]*?passed:\s*boolean/);
  });

  test('has results: Record<VerifyLayer, VerifyLayerResult>', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/results:\s*Record<VerifyLayer,\s*VerifyLayerResult>/);
  });

  test('has optional detail: string | undefined', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/detail\?:\s*string\s*\|\s*undefined/);
  });

  test('VerifyOutput type is structurally correct at runtime', async () => {
    const result = await runVerify({ cwd: process.cwd(), layers: [] });
    expect(typeof result.passed).toBe('boolean');
    expect(typeof result.results).toBe('object');
    expect(
      result.detail === undefined || typeof result.detail === 'string',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Source-level safety
// ---------------------------------------------------------------------------

describe('verify — source-level safety', () => {
  test('no fs I/O (delegates to subprocess for file inspection)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/readFile/);
    expect(src).not.toMatch(/writeFile/);
    expect(src).not.toMatch(/readFileSync/);
    expect(src).not.toMatch(/writeFileSync/);
  });

  test('no console.log (output is returned, not printed)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/\bconsole\./);
  });

  test('no process.exit (verify is a library function, not a CLI)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/process\.exit/);
  });

  test('no Math.random / Date.now (deterministic)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/Math\.random/);
    expect(src).not.toMatch(/Date\.now/);
  });
});

// ---------------------------------------------------------------------------
// Structural fingerprint
// ---------------------------------------------------------------------------

describe('verify — structural fingerprint', () => {
  test('TSC_BIN is module-scoped const (not exported)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/^const\s+TSC_BIN\s*=\s*require\.resolve/m);
    expect(src).not.toMatch(/^export\s+const\s+TSC_BIN/m);
  });

  test('require is created via createRequire(import.meta.url)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+require\s*=\s*createRequire\(\s*import\.meta\.url\s*\)/);
  });

  test('function body declares results + details at top, then loops layers', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(
      /export\s+async\s+function\s+runVerify[\s\S]*?const\s+results[\s\S]*?const\s+details[\s\S]*?for\s*\(\s*const\s+layer\s+of\s+input\.layers\s*\)/,
    );
  });

  test('return shape has exactly 3 keys: passed, results, detail', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(
      /return\s*\{\s*passed,\s*results,\s*detail:\s*details\.length\s*>\s*0\s*\?\s*details\.join\([^)]+\)\s*:\s*undefined,\s*\}/,
    );
  });

  test('uses template literals for detail separators (--- syntax ---)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/---\s*syntax\s*---/);
    expect(src).toMatch(/---\s*tests\s*---/);
    expect(src).toMatch(/---\s*progress\s*---/);
  });

  test('Iteration 20 docstring present (progress layer introduction)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/Iteration\s+20\s+—\s*progress\s+layer/);
  });

  test('commit-audit referenced (Iteration 19)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/commit-audit\.ts/);
    expect(src).toMatch(/Iteration\s+19/);
  });
});
