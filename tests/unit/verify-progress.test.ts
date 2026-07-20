import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileNoThrow } from '../../src/util/exec.js';
import { runVerify } from '../../src/cerebellum/verify.js';

/**
 * Iteration 20→21 — progress verify layer.
 *
 * Blocks the "empty-commit false-success" pattern by failing the verify
 * gate when the waypoint produced zero progress. Progress is defined as
 * EITHER the working tree has changes vs HEAD OR HEAD itself has moved
 * past the checkpoint commit (i.e., the agent manually committed).
 *
 * Iteration 21 added the HEAD-aware check after realizing the original
 * (working-tree-only) implementation would have triggered rollback and
 * LOST the agent's manually-committed work — strictly worse than the
 * bug it was trying to fix.
 *
 * Tests pin the contract:
 *   - passes when there is ANY working-tree change
 *   - passes when HEAD has moved past the checkpoint (agent committed)
 *   - fails when HEAD is still the checkpoint AND the tree is clean
 *   - fails when git itself errors (non-repo, corrupt HEAD)
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

/** Creates a `checkpoint/wp_*-start` commit so HEAD looks like the
 * orchestrator's lazy-checkpoint output. Required to test the
 * false-success case (HEAD is checkpoint AND tree is clean). */
async function makeCheckpointCommit(
  cwd: string,
  waypointId: string
): Promise<void> {
  await execFileNoThrow(
    'git',
    ['commit', '--allow-empty', '-m', `checkpoint/${waypointId}-start`],
    { cwd }
  );
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

  test('passes when agent manually committed (HEAD moved past checkpoint, clean tree)', async () => {
    // Reproduces the wp_mrtpf2n5002 scenario: orchestrator creates a
    // checkpoint/wp_X-start commit, agent modifies files AND commits
    // them manually (e.g., via BashTool). By verify time the working
    // tree is clean but HEAD is no longer the checkpoint-start commit.
    // This MUST pass — otherwise the orchestrator would roll back and
    // lose the agent's manual commit.
    await makeCheckpointCommit(cwd, 'wp_manual001');
    await writeFile(join(cwd, 'work.ts'), 'export const done = true;\n');
    await execFileNoThrow('git', ['add', '-A'], { cwd });
    await execFileNoThrow(
      'git',
      ['commit', '-m', 'feat: real work committed manually by agent'],
      { cwd }
    );

    const result = await runVerify({ cwd, layers: ['progress'] });
    expect(result.passed).toBe(true);
    expect(result.results.progress).toBe('pass');
  });

  test('fails when HEAD is checkpoint-start AND working tree is clean (false-success)', async () => {
    // The exact pattern Iteration 19 surfaced: checkpoint created, agent
    // does nothing, verify runs with HEAD still on the checkpoint commit
    // and no working-tree changes.
    await makeCheckpointCommit(cwd, 'wp_empty001');

    const result = await runVerify({ cwd, layers: ['progress'] });
    expect(result.passed).toBe(false);
    expect(result.results.progress).toBe('fail');
    expect(result.detail).toMatch(/progress/);
    expect(result.detail).toMatch(/no commits since checkpoint/);
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

  test('combines with syntax layer — progress fail blocks the gate', async () => {
    // Even when syntax would pass, a progress failure must fail the overall
    // gate. This is the property that blocks the empty-commit path: the
    // orchestrator checks `verify.passed` (not per-layer state) before
    // calling commitWaypoint.
    await makeCheckpointCommit(cwd, 'wp_combined001');
    const result = await runVerify({ cwd, layers: ['syntax', 'progress'] });
    expect(result.passed).toBe(false);
    expect(result.results.progress).toBe('fail');
  });
});
