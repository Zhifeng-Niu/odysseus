import { execFileNoThrow } from '../util/exec.js';
import { createRequire } from 'node:module';

export type VerifyLayer = 'syntax' | 'lint' | 'tests' | 'metric' | 'progress';
export type VerifyLayerResult = 'pass' | 'fail' | 'skipped';

export interface VerifyInput {
  cwd: string;
  layers: readonly VerifyLayer[];
  env?: NodeJS.ProcessEnv;
}

export interface VerifyOutput {
  passed: boolean;
  results: Record<VerifyLayer, VerifyLayerResult>;
  detail?: string | undefined;
}

/**
 * Iteration 20 — progress layer.
 *
 * Detects the "empty-commit false-success" pattern surfaced by
 * commit-audit.ts (Iteration 19): when commitWaypoint hits
 * `git diff --cached --quiet` with exit 0, it appends `--allow-empty`
 * and creates a `waypoint/wp_*-ok` commit despite the agent having
 * produced zero work. About 40% of recent waypoint commits fell into
 * this pattern.
 *
 * The orchestrator's commitWaypoint cannot be patched in-place without
 * manual review (see CLAUDE.md "Key Constraints"). This layer blocks
 * the false-success path BEFORE commitWaypoint is reached: the verify
 * gate runs at orchestrator.ts:800, commitWaypoint at :867. A failing
 * progress layer makes `verify.passed === false`, which forces the
 * rollback/failure branch and never reaches the empty commit.
 *
 * Uses `git status --porcelain` to detect ANY working-tree change vs
 * HEAD: new files, modifications, deletions, untracked. An empty stdout
 * means the agent's tools produced no file effect — the waypoint burned
 * iterations and tokens without progressing the codebase.
 */

// Resolve the real TypeScript compiler shipped with Odysseus. `npx tsc`
// silently falls back to the deprecated npm `tsc` stub (which exits 0 with a
// help message) on systems that have it cached, defeating the syntax gate.
// Pinning to the local `typescript/bin/tsc` keeps the gate trustworthy.
const require = createRequire(import.meta.url);
const TSC_BIN = require.resolve('typescript/bin/tsc');

export async function runVerify(input: VerifyInput): Promise<VerifyOutput> {
  const results: Record<VerifyLayer, VerifyLayerResult> = {
    syntax: 'skipped',
    lint: 'skipped',
    tests: 'skipped',
    metric: 'skipped',
    progress: 'skipped',
  };
  const details: string[] = [];

  for (const layer of input.layers) {
    if (layer === 'syntax') {
      const r = await execFileNoThrow('node', [TSC_BIN, '--noEmit'], {
        cwd: input.cwd,
        env: input.env ?? process.env,
      });
      results.syntax = r.exitCode === 0 ? 'pass' : 'fail';
      if (r.exitCode !== 0) {
        details.push(`--- syntax ---\n${r.stdout}\n${r.stderr}`);
      }
    }
    if (layer === 'tests') {
      // Run the full vitest suite. --passWithNoTests ensures the layer
      // passes even when no test files exist (e.g. a brand-new codebase
      // or a waypoint that touches only non-test code). The agent's own
      // 442-test suite is the safety net that catches regressions before
      // they ship.
      const r = await execFileNoThrow(
        'npx',
        ['vitest', 'run', '--passWithNoTests'],
        { cwd: input.cwd, env: input.env ?? process.env },
      );
      results.tests = r.exitCode === 0 ? 'pass' : 'fail';
      if (r.exitCode !== 0) {
        details.push(`--- tests ---\n${r.stdout}\n${r.stderr}`);
      }
    }
    if (layer === 'progress') {
      // `git status --porcelain` prints one line per working-tree entry
      // that differs from HEAD (staged, unstaged, and untracked). Empty
      // output means the waypoint produced no file effect at all — the
      // false-success pattern we're blocking. A non-zero exit means git
      // itself failed (not a repo, corrupt HEAD, etc.) — treat as fail
      // rather than silently letting the commit through.
      const r = await execFileNoThrow('git', ['status', '--porcelain'], {
        cwd: input.cwd,
        env: input.env ?? process.env,
      });
      if (r.exitCode !== 0) {
        results.progress = 'fail';
        details.push(`--- progress ---\n${r.stdout}\n${r.stderr}`);
      } else if (r.stdout.trim().length === 0) {
        results.progress = 'fail';
        details.push(
          '--- progress ---\nwaypoint produced no file changes (empty working tree)'
        );
      } else {
        results.progress = 'pass';
      }
    }
    // lint, metric layers land in a future iteration via self-extension
  }

  const passed = input.layers.every((layer) => results[layer] === 'pass');
  return {
    passed,
    results,
    detail: details.length > 0 ? details.join('\n\n') : undefined,
  };
}
