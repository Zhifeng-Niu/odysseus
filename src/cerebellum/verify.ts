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
      // Iteration 21 — HEAD-aware progress detection.
      //
      // Iteration 20's initial implementation only checked the working
      // tree. That was correct for the common case (agent writes files,
      // commitWaypoint commits them) but wrong for an important edge
      // case: when the agent itself calls `git commit` during the
      // waypoint, the working tree ends up clean by verify time, even
      // though real work happened. The original implementation would
      // fail this case, triggering orchestrator.ts:911's rollback path
      // and LOSING the agent's manually-committed work. That's a worse
      // failure mode than the false-success pattern we were trying to
      // block.
      //
      // The fix uses HEAD's subject as the signal. The orchestrator's
      // lazy-checkpoint path creates a `checkpoint/wp_*-start` commit
      // at the first mutating tool call. If HEAD's subject still IS
      // a checkpoint-start, the agent made no commits this waypoint —
      // progress must come from the working tree. If HEAD's subject is
      // anything else, HEAD moved past the checkpoint (or no checkpoint
      // was created), so real progress exists regardless of working
      // tree state.
      const headR = await execFileNoThrow(
        'git',
        ['log', '-1', '--format=%s'],
        { cwd: input.cwd, env: input.env ?? process.env },
      );
      const headSubject = headR.exitCode === 0 ? headR.stdout.trim() : '';
      const headIsCheckpoint =
        headSubject.startsWith('checkpoint/') && headSubject.endsWith('-start');

      const r = await execFileNoThrow('git', ['status', '--porcelain'], {
        cwd: input.cwd,
        env: input.env ?? process.env,
      });
      if (r.exitCode !== 0) {
        results.progress = 'fail';
        details.push(`--- progress ---\n${r.stdout}\n${r.stderr}`);
      } else if (headIsCheckpoint && r.stdout.trim().length === 0) {
        // HEAD is the checkpoint-start AND working tree is clean → the
        // agent did nothing. This is the false-success pattern.
        results.progress = 'fail';
        details.push(
          '--- progress ---\nwaypoint produced no file changes and no commits since checkpoint'
        );
      } else {
        // Either HEAD moved past the checkpoint (agent committed) OR
        // the working tree has changes (agent wrote files). Both count
        // as real progress.
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
