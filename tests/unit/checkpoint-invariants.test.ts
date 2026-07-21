/**
 * Invariants for src/cerebellum/checkpoint.ts.
 *
 * The existing cerebellum-checkpoint.test.ts covers 3 behavior cases
 * (success path, empty-tree success, not-a-repo failure). This file
 * pins the load-bearing structural contracts that the orchestrator's
 * safety perimeter depends on:
 *
 *   - CheckpointInput / CheckpointOk / CheckpointErr type shapes
 *   - Tagged-union discrimination via `ok` (no stray fields on either branch)
 *   - Default allowEmpty === true (orchestrator relies on this for lazy
 *     pre-dispatch checkpoints)
 *   - Empty-diff rejection path fires only when allowEmpty === false
 *   - Commit message literal `checkpoint/${label}` (prefix is load-bearing
 *     — commit-audit.ts greps for it to exclude checkpoint commits from
 *     the empty-waypoint-success detection)
 *   - --allow-empty flag added only when nothingStaged AND allowEmpty
 *   - SHA trimming (no trailing newline in result.sha)
 *   - stderr trimming in all error templates
 *   - Exact error message templates (prefixes that downstream tooling
 *     may grow to depend on)
 *   - Git command sequence ordering
 *
 * Style: pin actual source behavior. The label is interpolated
 * VERBATIM into the commit message — there is no sanitization. This
 * is a known hazard (a malicious label could inject newlines), but
 * the orchestrator is the only caller and it uses waypoint IDs. The
 * invariant test pins the verbatim interpolation so a future "sanitize
 * labels" refactor surfaces explicitly.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileNoThrow } from '../../src/util/exec.js';
import {
  createCheckpoint,
  type CheckpointInput,
  type CheckpointResult,
  type CheckpointOk,
  type CheckpointErr,
} from '../../src/cerebellum/checkpoint.js';

async function initRepo(dir: string): Promise<void> {
  await execFileNoThrow('git', ['init'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.email', 'test@test.test'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

async function gitLogSubjects(cwd: string, n = 5): Promise<string[]> {
  const r = await execFileNoThrow(
    'git',
    ['log', `-${n}`, '--format=%s'],
    { cwd },
  );
  return r.stdout.split('\n').filter((l) => l.length > 0);
}

async function gitShowAllowEmptyFlag(cwd: string, sha: string): Promise<boolean> {
  // Inspect the commit to see if --allow-empty was used by checking if the
  // resulting commit has zero file changes.
  const r = await execFileNoThrow(
    'git',
    ['show', '--no-patch', '--format=%H', sha],
    { cwd },
  );
  if (r.exitCode !== 0) return false;
  const stat = await execFileNoThrow(
    'git',
    ['show', '--shortstat', '--format=', sha],
    { cwd },
  );
  // Empty stat output → empty commit → --allow-empty was used.
  return stat.stdout.trim().length === 0;
}

describe('checkpoint invariants', () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-cp-inv-'));
    await initRepo(workdir);
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  describe('CheckpointInput type shape', () => {
    test('cwd and label are required; allowEmpty is optional', () => {
      // Type-level check via construction; runtime verifies the fields exist.
      const input: CheckpointInput = { cwd: workdir, label: 't1' };
      expect(input.cwd).toBe(workdir);
      expect(input.label).toBe('t1');
      expect(input.allowEmpty).toBeUndefined();
    });

    test('allowEmpty can be present (true)', () => {
      const input: CheckpointInput = { cwd: workdir, label: 't2', allowEmpty: true };
      expect(input.allowEmpty).toBe(true);
    });

    test('allowEmpty can be present (false)', () => {
      const input: CheckpointInput = { cwd: workdir, label: 't3', allowEmpty: false };
      expect(input.allowEmpty).toBe(false);
    });
  });

  describe('CheckpointResult tagged union', () => {
    test('success branch has exactly {ok: true, sha}', async () => {
      await writeFile(join(workdir, 'a.txt'), 'initial');
      const result: CheckpointResult = await createCheckpoint({
        cwd: workdir,
        label: 'inv-tag-ok',
      });
      expect(result.ok).toBe(true);
      // Narrows to CheckpointOk.
      if (result.ok) {
        const ok: CheckpointOk = result;
        expect(Object.keys(ok).sort()).toEqual(['ok', 'sha']);
        expect(typeof ok.sha).toBe('string');
        expect(ok.sha.length).toBeGreaterThan(0);
      }
    });

    test('failure branch has exactly {ok: false, error}', async () => {
      // Force a failure: no git repo at this path.
      const empty = await mkdtemp(join(tmpdir(), 'ody-cp-inv-empty-'));
      try {
        const result: CheckpointResult = await createCheckpoint({
          cwd: empty,
          label: 'inv-tag-err',
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          const err: CheckpointErr = result;
          expect(Object.keys(err).sort()).toEqual(['error', 'ok']);
          expect(typeof err.error).toBe('string');
          expect(err.error.length).toBeGreaterThan(0);
        }
      } finally {
        await rm(empty, { recursive: true, force: true });
      }
    });

    test('the ok discriminant is strictly boolean (true/false, not truthy/falsy)', async () => {
      // No intermediate state like {ok: 1} or {ok: 'true'}.
      await writeFile(join(workdir, 'x.txt'), 'x');
      const result = await createCheckpoint({ cwd: workdir, label: 'strict-bool' });
      expect(typeof result.ok).toBe('boolean');
      expect(result.ok).toBe(true);
    });
  });

  describe('commit message format', () => {
    test('uses literal "checkpoint/" prefix followed by label verbatim', async () => {
      await writeFile(join(workdir, 'f.txt'), 'content');
      await createCheckpoint({ cwd: workdir, label: 'wp_abc123-start' });
      const subjects = await gitLogSubjects(workdir, 1);
      expect(subjects[0]).toBe('checkpoint/wp_abc123-start');
    });

    test('label is interpolated VERBATIM (no sanitization — load-bearing quirk)', async () => {
      // The orchestrator only ever passes waypoint IDs as labels, so the
      // lack of sanitization is not exploitable in practice. Pinning the
      // behavior so a future "sanitize" refactor surfaces explicitly.
      // Note: we use a safe-ish label with spaces/hyphens; we avoid
      // newlines because git commit -m treats them specially and the
      // test is about literal interpolation, not newline handling.
      await writeFile(join(workdir, 'f.txt'), 'content');
      const weirdLabel = 'label with spaces & symbols!';
      await createCheckpoint({ cwd: workdir, label: weirdLabel });
      const subjects = await gitLogSubjects(workdir, 1);
      expect(subjects[0]).toBe(`checkpoint/${weirdLabel}`);
    });

    test('empty string label produces subject "checkpoint/" (literal prefix only)', async () => {
      await writeFile(join(workdir, 'f.txt'), 'content');
      await createCheckpoint({ cwd: workdir, label: '' });
      const subjects = await gitLogSubjects(workdir, 1);
      expect(subjects[0]).toBe('checkpoint/');
    });

    test('checkpoint prefix is distinct from waypoint/* and checkpoint commits are excludable', async () => {
      // commit-audit.ts greps for "waypoint/" to find success commits and
      // explicitly EXCLUDES "checkpoint/*" commits. This test pins the
      // prefix distinction so neither side drifts.
      await writeFile(join(workdir, 'a.txt'), 'a');
      await createCheckpoint({ cwd: workdir, label: 'pre-dispatch' });
      const subjects = await gitLogSubjects(workdir, 1);
      const subject = subjects[0]!;
      expect(subject.startsWith('checkpoint/')).toBe(true);
      expect(subject.startsWith('waypoint/')).toBe(false);
    });
  });

  describe('allowEmpty default and --allow-empty flag', () => {
    test('default allowEmpty is true when field omitted', async () => {
      // Empty tree + default → commit succeeds (allowEmpty defaults true).
      const result = await createCheckpoint({ cwd: workdir, label: 'default-empty' });
      expect(result.ok).toBe(true);
    });

    test('default allowEmpty is true when field is undefined', async () => {
      const input: CheckpointInput = { cwd: workdir, label: 'undef-empty', allowEmpty: undefined };
      const result = await createCheckpoint(input);
      expect(result.ok).toBe(true);
    });

    test('allowEmpty=false with empty tree REJECTS before committing', async () => {
      // Empty diff + allowEmpty=false → error, no commit created.
      const result = await createCheckpoint({
        cwd: workdir,
        label: 'rejected-empty',
        allowEmpty: false,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('nothing to checkpoint (empty diff)');
      }
      // Verify no commit was actually created.
      const logR = await execFileNoThrow('git', ['log', '--oneline'], { cwd: workdir });
      expect(logR.exitCode).not.toBe(0); // no commits yet → exitCode nonzero on git log
    });

    test('allowEmpty=true with empty tree CREATES empty commit (--allow-empty flag)', async () => {
      const result = await createCheckpoint({
        cwd: workdir,
        label: 'forced-empty',
        allowEmpty: true,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Verify the commit is genuinely empty (no diff).
        const isEmpty = await gitShowAllowEmptyFlag(workdir, result.sha);
        expect(isEmpty).toBe(true);
      }
    });

    test('allowEmpty=false with REAL changes still commits (no --allow-empty flag)', async () => {
      await writeFile(join(workdir, 'real.txt'), 'real content');
      const result = await createCheckpoint({
        cwd: workdir,
        label: 'real-changes',
        allowEmpty: false,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Verify the commit is NOT empty.
        const isEmpty = await gitShowAllowEmptyFlag(workdir, result.sha);
        expect(isEmpty).toBe(false);
      }
    });

    test('--allow-empty flag is added only when nothingStaged AND allowEmpty', async () => {
      // Case A: nothing staged + allowEmpty → flag added (empty commit).
      const cp1 = await createCheckpoint({
        cwd: workdir,
        label: 'case-A',
        allowEmpty: true,
      });
      expect(cp1.ok).toBe(true);
      if (cp1.ok) {
        expect(await gitShowAllowEmptyFlag(workdir, cp1.sha)).toBe(true);
      }

      // Case B: staged content + allowEmpty → flag NOT added (non-empty commit).
      await writeFile(join(workdir, 'b.txt'), 'b');
      const cp2 = await createCheckpoint({
        cwd: workdir,
        label: 'case-B',
        allowEmpty: true,
      });
      expect(cp2.ok).toBe(true);
      if (cp2.ok) {
        expect(await gitShowAllowEmptyFlag(workdir, cp2.sha)).toBe(false);
      }
    });
  });

  describe('SHA trimming', () => {
    test('result.sha has no leading/trailing whitespace', async () => {
      await writeFile(join(workdir, 'trim.txt'), 'content');
      const result = await createCheckpoint({ cwd: workdir, label: 'trim-test' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.sha).toBe(result.sha.trim());
        expect(result.sha).not.toMatch(/^\s|\s$/);
      }
    });

    test('result.sha matches git rev-parse HEAD output (full 40-char SHA)', async () => {
      await writeFile(join(workdir, 'sha.txt'), 'content');
      const result = await createCheckpoint({ cwd: workdir, label: 'sha-test' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.sha).toMatch(/^[0-9a-f]{40}$/);
        // Cross-check with direct git rev-parse.
        const r = await execFileNoThrow('git', ['rev-parse', 'HEAD'], { cwd: workdir });
        expect(result.sha).toBe(r.stdout.trim());
      }
    });
  });

  describe('error message templates', () => {
    test('not-a-git-repo error starts with literal "not a git repository:"', async () => {
      const empty = await mkdtemp(join(tmpdir(), 'ody-cp-inv-nogit-'));
      try {
        const result = await createCheckpoint({ cwd: empty, label: 'x' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.startsWith('not a git repository:')).toBe(true);
        }
      } finally {
        await rm(empty, { recursive: true, force: true });
      }
    });

    test('not-a-git-repo error includes trimmed stderr from git rev-parse', async () => {
      // git rev-parse prints "fatal: not a git repository (or any parent up to mount point /)\n"
      // to stderr. The trim() in the source strips the trailing newline.
      const empty = await mkdtemp(join(tmpdir(), 'ody-cp-inv-stderr-'));
      try {
        const result = await createCheckpoint({ cwd: empty, label: 'x' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          // No trailing whitespace.
          expect(result.error).toBe(result.error.trim());
          // Includes some hint from git's own error.
          expect(result.error.length).toBeGreaterThan('not a git repository: '.length);
        }
      } finally {
        await rm(empty, { recursive: true, force: true });
      }
    });

    test('empty-diff rejection uses exact literal "nothing to checkpoint (empty diff)"', async () => {
      const result = await createCheckpoint({
        cwd: workdir,
        label: 'empty-diff',
        allowEmpty: false,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('nothing to checkpoint (empty diff)');
      }
    });
  });

  describe('git command sequence ordering', () => {
    // The orchestrator depends on a specific sequence:
    //   1. rev-parse --is-inside-work-tree (safety: must be a git repo)
    //   2. add -A (stage everything before diffing)
    //   3. diff --cached --quiet (check if there's anything to commit)
    //   4. commit -m checkpoint/${label} (create the checkpoint)
    //   5. rev-parse HEAD (read the resulting SHA)
    //
    // Each step depends on the previous one. Reordering any of them
    // breaks the contract.

    test('add -A stages files before commit (a newly-written file appears in the commit)', async () => {
      await writeFile(join(workdir, 'seq.txt'), 'sequence-test');
      const cp = await createCheckpoint({ cwd: workdir, label: 'seq-test' });
      expect(cp.ok).toBe(true);
      if (cp.ok) {
        const show = await execFileNoThrow(
          'git',
          ['show', '--stat', '--format=', cp.sha],
          { cwd: workdir },
        );
        expect(show.stdout).toContain('seq.txt');
      }
    });

    test('rev-parse HEAD returns the SHA of the just-created commit', async () => {
      await writeFile(join(workdir, 'head.txt'), 'h');
      const cp = await createCheckpoint({ cwd: workdir, label: 'head-test' });
      expect(cp.ok).toBe(true);
      if (cp.ok) {
        const headSubject = await execFileNoThrow(
          'git',
          ['log', '-1', '--format=%s'],
          { cwd: workdir },
        );
        expect(headSubject.stdout.trim()).toBe('checkpoint/head-test');
      }
    });
  });

  describe('idempotent stacking of empty checkpoints', () => {
    test('multiple allow-empty checkpoints on clean tree all succeed', async () => {
      // The orchestrator calls createCheckpoint before dispatching each
      // waypoint. If the tree is clean (no edits yet), each call creates
      // a fresh empty commit. Verify that N calls produce N commits.
      const cp1 = await createCheckpoint({ cwd: workdir, label: 'first' });
      const cp2 = await createCheckpoint({ cwd: workdir, label: 'second' });
      const cp3 = await createCheckpoint({ cwd: workdir, label: 'third' });

      expect(cp1.ok).toBe(true);
      expect(cp2.ok).toBe(true);
      expect(cp3.ok).toBe(true);

      const subjects = await gitLogSubjects(workdir, 5);
      // newest first → third, second, first.
      expect(subjects).toEqual([
        'checkpoint/third',
        'checkpoint/second',
        'checkpoint/first',
      ]);
    });

    test('each empty checkpoint has a distinct SHA', async () => {
      const cp1 = await createCheckpoint({ cwd: workdir, label: 'a' });
      const cp2 = await createCheckpoint({ cwd: workdir, label: 'b' });
      expect(cp1.ok).toBe(true);
      expect(cp2.ok).toBe(true);
      if (cp1.ok && cp2.ok) {
        expect(cp1.sha).not.toBe(cp2.sha);
      }
    });
  });

  describe('purity — input object is not mutated', () => {
    test('createCheckpoint does not modify the input object', async () => {
      const input: CheckpointInput = { cwd: workdir, label: 'pure-test', allowEmpty: true };
      const snapshot = { ...input };
      await createCheckpoint(input);
      expect(input).toEqual(snapshot);
    });

    test('input.allowEmpty undefined remains undefined after call', async () => {
      const input: CheckpointInput = { cwd: workdir, label: 'undef-after' };
      await createCheckpoint(input);
      expect(input.allowEmpty).toBeUndefined();
    });
  });

  describe('read-back round-trip', () => {
    test('a checkpoint commit is discoverable via git log immediately', async () => {
      await writeFile(join(workdir, 'rt.txt'), 'round-trip');
      const cp = await createCheckpoint({ cwd: workdir, label: 'rt-test' });
      expect(cp.ok).toBe(true);
      if (cp.ok) {
        const logR = await execFileNoThrow(
          'git',
          ['log', '--format=%s', '--grep=^checkpoint/'],
          { cwd: workdir },
        );
        expect(logR.stdout).toContain('checkpoint/rt-test');
      }
    });

    test('checkpoint SHA resolves via git cat-file -t', async () => {
      await writeFile(join(workdir, 'cat.txt'), 'c');
      const cp = await createCheckpoint({ cwd: workdir, label: 'cat-file-test' });
      expect(cp.ok).toBe(true);
      if (cp.ok) {
        const r = await execFileNoThrow('git', ['cat-file', '-t', cp.sha], { cwd: workdir });
        expect(r.exitCode).toBe(0);
        expect(r.stdout.trim()).toBe('commit');
      }
    });
  });
});
