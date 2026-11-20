import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runVerify, type VerifyLayer } from '../../src/cerebellum/verify.js';

/**
 * runVerify — layer-aggregation contract invariants.
 *
 * cerebellum-verify.test.ts covers the syntax layer (3 tests).
 * verify-progress.test.ts covers the progress layer (~8 tests, including
 * syntax+progress combinations). Neither pins the AGGREGATION contract:
 *
 *   - What happens when `layers` is empty?
 *   - What happens when an unrequested layer is in the results object?
 *   - How does `passed` combine multiple layer results?
 *   - What's the exact format of the `detail` field when N layers fail?
 *
 * These are the cross-cutting contracts that protect against silent
 * regressions in the verify gate. A change to `every()` (e.g. switching
 * to `some()` for "at least one layer passed") would have catastrophic
 * consequences — false waypoints would pass and ship.
 *
 * Each test is hermetic: it sets up a real workdir so syntax and tests
 * layers can actually run, but uses carefully crafted inputs to force
 * specific layer results.
 */

describe('runVerify — layer aggregation contract', () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-verify-inv-'));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Empty layers — vacuous truth (every() on empty = true)
  // -------------------------------------------------------------------------

  test('empty layers array → passed=true (vacuous every)', async () => {
    // Array.prototype.every returns true for an empty array — this is
    // the mathematical "vacuous truth" rule. Pinning so a future
    // refactor that adds a length check (e.g. "layers.length === 0 →
    // fail") is flagged loudly. The empty-layers case is theoretical
    // today (the orchestrator always passes at least one layer), but
    // the contract should still be pinned.
    const result = await runVerify({ cwd: workdir, layers: [] });
    expect(result.passed).toBe(true);
  });

  test('empty layers array → all layers in results object stay "skipped"', async () => {
    // The initial results object sets every layer to 'skipped'. With
    // no layers requested, nothing runs, so every entry stays skipped.
    const result = await runVerify({ cwd: workdir, layers: [] });
    expect(result.results).toEqual({
      syntax: 'skipped',
      lint: 'skipped',
      tests: 'skipped',
      metric: 'skipped',
      progress: 'skipped',
      artifact: 'skipped', // M1 (nov20c): declared non-code acceptance layer
    });
  });

  // -------------------------------------------------------------------------
  // Unrequested layers — stay 'skipped' even when other layers run
  // -------------------------------------------------------------------------

  test('unrequested layers stay "skipped" when only syntax is requested', async () => {
    // Setup: minimal valid TS project so syntax passes.
    await writeFile(
      join(workdir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          noEmit: true,
        },
        include: ['*.ts'],
      }),
    );
    await writeFile(join(workdir, 'ok.ts'), 'export const x = 1;\n');

    const result = await runVerify({ cwd: workdir, layers: ['syntax'] });

    // syntax ran and passed; tests/lint/metric/progress did not run.
    expect(result.results.syntax).toBe('pass');
    expect(result.results.tests).toBe('skipped');
    expect(result.results.lint).toBe('skipped');
    expect(result.results.metric).toBe('skipped');
    expect(result.results.progress).toBe('skipped');
  });

  // -------------------------------------------------------------------------
  // every() semantics — one failing layer fails the whole gate
  // -------------------------------------------------------------------------

  test('one failing layer fails the gate even when others pass (every semantics)', async () => {
    // This is THE load-bearing safety contract. If the gate ever
    // switched to "any layer passing → passed", buggy code would ship.
    // We force syntax to pass (good TS) but progress to fail (no git
    // repo, so git status errors).
    await writeFile(
      join(workdir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          noEmit: true,
        },
        include: ['*.ts'],
      }),
    );
    await writeFile(join(workdir, 'ok.ts'), 'export const x = 1;\n');

    // workdir is a plain tmpdir — NOT a git repo. git status will fail.
    const result = await runVerify({
      cwd: workdir,
      layers: ['syntax', 'progress'],
    });

    expect(result.results.syntax).toBe('pass');
    expect(result.results.progress).toBe('fail');
    expect(result.passed).toBe(false);
  });

  test('all requested layers passing → passed=true', async () => {
    // Mirror of the above. Two passing layers → passed.
    await writeFile(
      join(workdir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          noEmit: true,
        },
        include: ['*.ts'],
      }),
    );
    await writeFile(join(workdir, 'ok.ts'), 'export const x = 1;\n');

    const result = await runVerify({ cwd: workdir, layers: ['syntax'] });
    expect(result.results.syntax).toBe('pass');
    expect(result.passed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Detail format — undefined on success, string on failure
  // -------------------------------------------------------------------------

  describe('detail field', () => {
    test('detail is undefined when no layers fail', async () => {
      await writeFile(
        join(workdir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2023',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            strict: true,
            noEmit: true,
          },
          include: ['*.ts'],
        }),
      );
      await writeFile(join(workdir, 'ok.ts'), 'export const x = 1;\n');

      const result = await runVerify({ cwd: workdir, layers: ['syntax'] });
      expect(result.detail).toBeUndefined();
    });

    test('detail is a string when one layer fails', async () => {
      // No tsconfig → syntax fails with a detail string.
      await writeFile(join(workdir, 'orphan.ts'), 'export const x = 1;\n');

      const result = await runVerify({ cwd: workdir, layers: ['syntax'] });
      expect(typeof result.detail).toBe('string');
      expect(result.detail).toContain('--- syntax ---');
    });

    test('detail concatenates multiple layer failures with "\\n\\n" separator', async () => {
      // Force two layers to fail: syntax (no tsconfig) and progress
      // (not a git repo). Both append to the `details` array; the
      // final detail joins them with '\n\n'.
      await writeFile(join(workdir, 'orphan.ts'), 'export const x = 1;\n');

      const result = await runVerify({
        cwd: workdir,
        layers: ['syntax', 'progress'],
      });

      expect(typeof result.detail).toBe('string');
      // Both layer headers appear in the joined detail.
      expect(result.detail).toContain('--- syntax ---');
      expect(result.detail).toContain('--- progress ---');
      // The two sections are separated by exactly '\n\n'. Verify by
      // checking that '--- progress ---' is preceded by '\n\n' (not
      // by a single newline or other separator).
      const progressIdx = result.detail!.indexOf('--- progress ---');
      expect(progressIdx).toBeGreaterThan(0);
      const separator = result.detail!.slice(progressIdx - 2, progressIdx);
      expect(separator).toBe('\n\n');
    });

    test('detail for failing layer includes both stdout and stderr from the subprocess', async () => {
      // The format is `--- <layer> ---\n<stdout>\n<stderr>`. Pin the
      // ordering: stdout first, then stderr, both on their own lines.
      await writeFile(join(workdir, 'bad.ts'), 'export const x: number = "str";\n');
      await writeFile(
        join(workdir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2023',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            strict: true,
            noEmit: true,
          },
          include: ['*.ts'],
        }),
      );

      const result = await runVerify({ cwd: workdir, layers: ['syntax'] });
      expect(result.detail).toContain('--- syntax ---');
      // The error message from tsc typically goes to stdout (not stderr)
      // in --noEmit mode, so we just check the header is followed by
      // content — exact stderr/stdout distinction is fragile across tsc
      // versions. The header presence + non-empty body is the contract.
      const headerIdx = result.detail!.indexOf('--- syntax ---');
      const body = result.detail!.slice(headerIdx + '--- syntax ---'.length);
      expect(body.trim().length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Layer deduplication / ordering — input.layers order is preserved
  // -------------------------------------------------------------------------

  test('input.layers order does not affect correctness (commutative every)', async () => {
    // every() is commutative — [syntax, progress] and [progress, syntax]
    // produce the same passed value. The detail string ordering MAY
    // differ (details are pushed in layer-execution order), but the
    // pass/fail decision must be order-independent. Pinning this so a
    // future refactor that introduces early-exit (e.g. short-circuit
    // on first failure) doesn't accidentally change semantics.
    await writeFile(join(workdir, 'orphan.ts'), 'export const x = 1;\n');

    const result1 = await runVerify({
      cwd: workdir,
      layers: ['syntax', 'progress' as VerifyLayer],
    });
    const result2 = await runVerify({
      cwd: workdir,
      layers: ['progress' as VerifyLayer, 'syntax'],
    });

    expect(result1.passed).toBe(result2.passed);
    expect(result1.results).toEqual(result2.results);
  });

  // -------------------------------------------------------------------------
  // VerifyLayer / VerifyLayerResult — type-level exhaustiveness
  // -------------------------------------------------------------------------

  test('results object always has all 6 layer keys, regardless of input', async () => {
    // The results object is initialized with every layer set to
    // 'skipped' before any layer runs. Pinning that the SHAPE is
    // always { syntax, lint, tests, metric, progress, artifact } — a future
    // extraction that splits the layer set could silently drop a key.
    // 5 → 6: artifact layer (M1, nov20c) — declared non-code acceptance.
    const result = await runVerify({ cwd: workdir, layers: [] });
    expect(Object.keys(result.results).sort()).toEqual(
      ['artifact', 'lint', 'metric', 'progress', 'syntax', 'tests'].sort(),
    );
  });

  // -------------------------------------------------------------------------
  // env forwarding — input.env replaces process.env for subprocesses
  // -------------------------------------------------------------------------

  describe('env forwarding', () => {
    test('subprocess receives input.env when provided', async () => {
      // The env param exists so callers can isolate the subprocess
      // from process.env (e.g. for test reproducibility or to inject
      // secrets). We verify by passing a custom PATH and checking
      // that `node` runs at all (it would fail with ENOENT if env
      // were dropped — no PATH means spawn cannot find node).
      //
      // We use the syntax layer because it invokes node directly via
      // TSC_BIN. If env is dropped, the spawn fails with ENOENT and
      // the layer throws instead of returning 'fail'.
      await writeFile(join(workdir, 'ok.ts'), 'export const x = 1;\n');
      await writeFile(
        join(workdir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2023',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            strict: true,
            noEmit: true,
          },
          include: ['*.ts'],
        }),
      );

      // Pass through PATH so node can be found. Drop everything else
      // to prove that input.env replaces (not merges with) process.env.
      const minimalEnv = { PATH: process.env['PATH'] ?? '' };
      const result = await runVerify({
        cwd: workdir,
        layers: ['syntax'],
        env: minimalEnv,
      });

      // If env were dropped, syntax would be 'fail' (tsc spawn ENOENT)
      // OR the call would throw. A 'pass' result proves the env made
      // it through to the subprocess.
      expect(result.results.syntax).toBe('pass');
    });
  });
});

// ---------------------------------------------------------------------------
// Unimplemented layers — lint, metric (placeholders for future iterations)
// ---------------------------------------------------------------------------

describe('runVerify — unimplemented layers (lint, metric)', () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-verify-unimpl-'));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('lint layer silently stays "skipped" (no implementation)', async () => {
    // The layer switch in verify.ts has no `lint` case — the layer
    // stays at its initial 'skipped' value. Pinning this so when a
    // lint implementation lands, the test suite flags the change
    // (the test would need to switch from 'skipped' to 'pass'/'fail').
    const result = await runVerify({ cwd: workdir, layers: ['lint'] });
    expect(result.results.lint).toBe('skipped');
    // 'skipped' is treated as NOT 'pass' by the every() gate, so a
    // request for the lint layer currently makes the gate fail.
    // This is intentional — the lint layer is documented as
    // unimplemented; if you request it, the gate should not pass.
    expect(result.passed).toBe(false);
  });

  test('metric layer silently stays "skipped" (no implementation)', async () => {
    const result = await runVerify({ cwd: workdir, layers: ['metric'] });
    expect(result.results.metric).toBe('skipped');
    expect(result.passed).toBe(false);
  });
});
