import { describe, test, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Source-tree audit — locks invariants about where files live.
 *
 * Iteration 41 context: while reviewing the source tree for the
 * Iteration 40 PROJECT CONVENTIONS prompt, found two ghost files
 * under src/cerebellum/:
 *
 *   - goalValidator.ts (60 lines) + goalValidator.test.ts (334 lines)
 *     — the boolean `goalValidator` was unused in production (callers
 *       use `validateGoal` from goal-validator.ts). The test file
 *       covered 334 lines of a dead function. vitest didn't even run
 *       it (wrong location) so the coverage was imaginary.
 *
 *   - completedGoals.test.ts (150 lines) — duplicate of the real
 *     tests/unit/cerebellum-completedGoals.test.ts. vitest didn't
 *     run this either.
 *
 * These accumulated because earlier agent iterations didn't know
 * (or forgot) that vitest's include glob is `tests/`-prefixed only
 * (see `vitest.config.ts` — `test.include`).
 * The Iteration 40 prompt fix teaches this to the agent at runtime;
 * this meta-test catches regressions at CI time. Belt + suspenders.
 *
 * If this test fails: a test file was written under src/. Move it
 * to tests/unit/<module>.test.ts (or tests/integration/, tests/e2e/
 * if appropriate) and re-run.
 */

const PROJECT_ROOT = process.cwd();

function* walk(dir: string): Generator<string> {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function listFilesUnder(dir: string, predicate: (name: string) => boolean): string[] {
  const root = join(PROJECT_ROOT, dir);
  let stat;
  try {
    stat = statSync(root);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [];
  const matches: string[] = [];
  for (const path of walk(root)) {
    if (predicate(path)) {
      matches.push(relative(PROJECT_ROOT, path));
    }
  }
  return matches.sort();
}

describe('source-tree audit (Iteration 41)', () => {
  test('no test files under src/', () => {
    // vitest.config.ts hard-includes the glob 'tests' + '/-star/star/star.test.ts'
    // (the literal sequence would close this block comment early — see the
    // file header for the trap). A test file anywhere under src/ will NOT
    // run. Ghost test files are worse than missing tests because they
    // create the illusion of coverage while silently rotting. This
    // assertion keeps src/ test-free.
    //
    // Allowed patterns:
    //   - tests/unit/<module>.test.ts
    //   - tests/integration/<module>.test.ts (when added)
    //   - tests/e2e/<module>.test.ts (when added)
    const ghosts = listFilesUnder('src', (p) =>
      /\.test\.[tj]sx?$/.test(p) || /\.spec\.[tj]sx?$/.test(p),
    );
    expect(
      ghosts,
      `Found test files under src/ (they won't run — vitest only includes tests/**):\n  ${ghosts.join('\n  ')}\n` +
        'Move each file to tests/unit/ with the same base name before re-running.',
    ).toEqual([]);
  });

  test('no leftover .js build artifacts committed under src/', () => {
    // ESM TypeScript project: we import via `.js` specifiers but the source
    // is .ts. Compiled .js files under src/ would either be stale (from an
    // old build) or accidentally written by a tool. Either way, confusing.
    const jsArtifacts = listFilesUnder('src', (p) => p.endsWith('.js'));
    expect(
      jsArtifacts,
      `Found .js files under src/ — should be .ts sources only:\n  ${jsArtifacts.join('\n  ')}`,
    ).toEqual([]);
  });
});
