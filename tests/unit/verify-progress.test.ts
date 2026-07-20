import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileNoThrow } from '../../src/util/exec.js';
import { runVerify } from '../../src/cerebellum/verify.js';

/**
 * Iteration 20 — progress verify layer.
 *
 * Blocks the "empty-commit false-success" pattern by failing the verify
 * gate when the working tree has no changes vs HEAD. These tests pin the
 * layer's contract:
 *   - passes when there is ANY working-tree change (added/modified/deleted/untracked)
 *   - fails when the tree matches HEAD exactly
 *   - fails when git itself fails (non-repo, corrupt HEAD)
 *
 * Each test owns its own tempdir + git repo so the porcelain output is
 * deterministic and isolated from the Odysseus repo's own state.
 */
async function initRepo(dir: string): Promise<void> {
  await execFileNoThrow('git', ['init'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.email', 'test@test.test'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.name', 'Test'], { cwd: dir });
  // Initial commit so HEAD exists; otherwise `git status --porcelain` on a
  // repo with no commits shows every file as untracked (different code path).
  await writeFile(join(dir, 'README.md'), 'initial\n');
  await execFileNoThrow('git', ['add', 'README.md'], { cwd: dir });
  await execFileNoThrow('git', ['commit', '-m', 'initial'], { cwd: dir });
}

describe('runVerify — progress layer', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ody-progress-'));
    await initRepo(cwd);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('passes when a new untracked file exists', async () => {
    await writeFile(join(cwd, 'new.ts'), 'export const x = 1;\n');
    const result = await runVerify({ cwd, layers: ['progress'] });
    expect(result.passed).toBe(true);
    expect(result.results.progress).toBe('pass');
  });

  test('passes when an existing tracked file is modified', async () => {
    await writeFile(join(cwd, 'README.md'), 'changed content\n');
    const result = await runVerify({ cwd, layers: ['progress'] });
    expect(result.passed).toBe(true);
    expect(result.results.progress).toBe('pass');
  });

  test('passes when a new file sits in a nested untracked directory', async () => {
    // Regression guard: mkdir + file mirrors how the agent's FileWrite tool
    // creates files in subdirectories. porcelain must pick this up.
    await mkdir(join(cwd, 'src', 'deep'), { recursive: true });
    await writeFile(join(cwd, 'src', 'deep', 'mod.ts'), 'export const y = 2;\n');
    const result = await runVerify({ cwd, layers: ['progress'] });
    expect(result.passed).toBe(true);
    expect(result.results.progress).toBe('pass');
  });

  test('passes when a file has been deleted', async () => {
    await rm(join(cwd, 'README.md'));
    const result = await runVerify({ cwd, layers: ['progress'] });
    expect(result.passed).toBe(true);
    expect(result.results.progress).toBe('pass');
  });

  test('fails when the working tree matches HEAD exactly (false-success case)', async () => {
    // This is the exact pattern Iteration 19 surfaced: commitWaypoint hits
    // `git diff --cached --quiet` with exit 0 and appends --allow-empty.
    // The progress layer must reject this BEFORE the commit path is taken.
    const result = await runVerify({ cwd, layers: ['progress'] });
    expect(result.passed).toBe(false);
    expect(result.results.progress).toBe('fail');
    expect(result.detail).toMatch(/progress/);
    expect(result.detail).toMatch(/empty working tree/);
  });

  test('fails when git itself errors (not a git repo)', async () => {
    // Fresh dir with no `git init`. `git status` exits non-zero — the layer
    // must treat this as a failure rather than silently passing the commit.
    const nonRepo = await mkdtemp(join(tmpdir(), 'ody-no-git-'));
    try {
      const result = await runVerify({ cwd: nonRepo, layers: ['progress'] });
      expect(result.passed).toBe(false);
      expect(result.results.progress).toBe('fail');
      expect(result.detail).toMatch(/progress/);
    } finally {
      await rm(nonRepo, { recursive: true, force: true });
    }
  });

  test('combines with syntax layer — progress fail short-circuits the gate', async () => {
    // Even when syntax would pass, a progress failure must fail the overall
    // gate. This is the property that blocks the empty-commit path: the
    // orchestrator checks `verify.passed` (not per-layer state) before
    // calling commitWaypoint.
    const result = await runVerify({ cwd, layers: ['syntax', 'progress'] });
    expect(result.passed).toBe(false);
    expect(result.results.progress).toBe('fail');
  });
});
