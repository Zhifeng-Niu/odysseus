/**
 * Invariants for src/cerebellum/rollback.ts.
 *
 * The existing cerebellum-rollback.test.ts covers 3 behavior cases
 * (happy-path reset, safety-list rejection, non-existent SHA). This
 * file pins the load-bearing structural contracts:
 *
 *   - RollbackInput / RollbackOk / RollbackErr type shapes
 *   - Tagged-union discrimination via `ok` (exact key enumeration)
 *   - allowedShas guard fires BEFORE any git call (zeroth-law safety)
 *   - SHA existence check via git cat-file -t (rejects unknown revisions
 *     before destructive reset)
 *   - git reset --hard ordering (guard → cat-file → reset → clean)
 *   - Untracked file cleanup via git clean -fd
 *   - gitignored files are PRESERVED by clean (not removed)
 *   - Error message templates with exact prefixes
 *   - Purity: input object never mutated
 *   - Safety list semantics: undefined list = no check; empty list =
 *     always-reject (different contracts, both load-bearing)
 *   - SHA case sensitivity in the allowedShas check
 *
 * The zeroth-law guard is the most security-critical primitive in the
 * rollback path — it prevents the agent from `git reset --hard` to an
 * arbitrary SHA that could wipe human-authored safety fixes. Pinning
 * its exact semantics (case-sensitive, includes() check, fires before
 * any git invocation) is load-bearing.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileNoThrow } from '../../src/util/exec.js';
import { createCheckpoint } from '../../src/cerebellum/checkpoint.js';
import {
  rollbackTo,
  type RollbackInput,
  type RollbackResult,
  type RollbackOk,
  type RollbackErr,
} from '../../src/cerebellum/rollback.js';

async function initRepo(dir: string): Promise<void> {
  await execFileNoThrow('git', ['init'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.email', 'test@test.test'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

async function getHeadSha(cwd: string): Promise<string> {
  const r = await execFileNoThrow('git', ['rev-parse', 'HEAD'], { cwd });
  return r.stdout.trim();
}

describe('rollback invariants', () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-rb-inv-'));
    await initRepo(workdir);
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  describe('RollbackInput type shape', () => {
    test('cwd and sha are required; allowedShas is optional', () => {
      const input: RollbackInput = { cwd: workdir, sha: 'abc' };
      expect(input.cwd).toBe(workdir);
      expect(input.sha).toBe('abc');
      expect(input.allowedShas).toBeUndefined();
    });

    test('allowedShas can be a readonly array of strings', () => {
      const input: RollbackInput = {
        cwd: workdir,
        sha: 'abc',
        allowedShas: ['abc', 'def', 'ghi'],
      };
      expect(input.allowedShas).toEqual(['abc', 'def', 'ghi']);
    });

    test('allowedShas accepts readonly tuple types', () => {
      // The `readonly string[]` annotation allows tuples, not just
      // mutable arrays. Load-bearing for callers that build the list
      // from checkpoint SHAs accumulated in this session.
      const shas: readonly string[] = Object.freeze(['a', 'b']);
      const input: RollbackInput = { cwd: workdir, sha: 'a', allowedShas: shas };
      expect(input.allowedShas).toBe(shas);
    });
  });

  describe('RollbackResult tagged union', () => {
    test('success branch has exactly {ok: true, sha}', async () => {
      await writeFile(join(workdir, 'f.txt'), 'v1');
      const cp = await createCheckpoint({ cwd: workdir, label: 'base' });
      if (!cp.ok) throw new Error('checkpoint setup failed');
      const sha = cp.sha;

      const result: RollbackResult = await rollbackTo({ cwd: workdir, sha });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const ok: RollbackOk = result;
        expect(Object.keys(ok).sort()).toEqual(['ok', 'sha']);
        expect(typeof ok.sha).toBe('string');
      }
    });

    test('failure branch has exactly {ok: false, error}', async () => {
      const result: RollbackResult = await rollbackTo({
        cwd: workdir,
        sha: 'abc',
        allowedShas: ['def'],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const err: RollbackErr = result;
        expect(Object.keys(err).sort()).toEqual(['error', 'ok']);
        expect(typeof err.error).toBe('string');
        expect(err.error.length).toBeGreaterThan(0);
      }
    });

    test('success sha equals input sha (rollback returns the target, not HEAD)', async () => {
      // rollbackTo returns the SHA it was asked to roll back to, not
      // the new HEAD. They happen to be equal after a successful reset,
      // but the contract is "echo the input".
      await writeFile(join(workdir, 'f.txt'), 'v1');
      const cp = await createCheckpoint({ cwd: workdir, label: 'base' });
      if (!cp.ok) throw new Error('setup failed');

      const result = await rollbackTo({ cwd: workdir, sha: cp.sha });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.sha).toBe(cp.sha);
      }
    });
  });

  describe('allowedShas guard (zeroth-law safety)', () => {
    test('undefined allowedShas = NO check (any SHA accepted subject to existence)', async () => {
      // No allowedShas → guard skipped, git cat-file proceeds.
      // Will fail at the cat-file check because 'not-a-real-sha' is not
      // a real commit. The point is: it does NOT fail at the guard.
      const result = await rollbackTo({
        cwd: workdir,
        sha: 'not-a-real-sha',
        // allowedShas omitted entirely
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Should mention the unknown revision, NOT the safety violation.
        expect(result.error).toMatch(/unknown revision/);
        expect(result.error).not.toMatch(/safety violation/);
      }
    });

    test('empty allowedShas array = ALWAYS reject (every SHA is not-in-list)', async () => {
      // An empty list is the strictest policy — nothing is allowed.
      // Different contract from undefined. Pin both.
      await writeFile(join(workdir, 'f.txt'), 'v1');
      const cp = await createCheckpoint({ cwd: workdir, label: 'base' });
      if (!cp.ok) throw new Error('setup failed');

      const result = await rollbackTo({
        cwd: workdir,
        sha: cp.sha,
        allowedShas: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/safety violation/);
      }
    });

    test('guard fires BEFORE any git invocation', async () => {
      // If the guard doesn't short-circuit, the function would proceed
      // to `git cat-file -t <sha>` which might succeed for an unrelated
      // commit. The safety property is: a SHA not in the allowlist
      // never reaches git, period.
      await writeFile(join(workdir, 'f.txt'), 'original');
      const cp = await createCheckpoint({ cwd: workdir, label: 'safe' });
      if (!cp.ok) throw new Error('setup failed');
      const safeSha = cp.sha;

      // Try to roll back to safeSha but with an allowlist that excludes it.
      const result = await rollbackTo({
        cwd: workdir,
        sha: safeSha,
        allowedShas: ['some-other-sha'],
      });
      expect(result.ok).toBe(false);

      // Verify HEAD was NOT moved (guard short-circuited before reset).
      const head = await getHeadSha(workdir);
      expect(head).toBe(safeSha);
    });

    test('SHA match is CASE-SENSITIVE (no lowercasing)', async () => {
      // SHAs are hex strings; case differs between git versions and
      // callers. The check uses .includes() verbatim — pinning so a
      // future "normalize case" refactor surfaces explicitly.
      await writeFile(join(workdir, 'f.txt'), 'v1');
      const cp = await createCheckpoint({ cwd: workdir, label: 'case-test' });
      if (!cp.ok) throw new Error('setup failed');
      const upperSha = cp.sha.toUpperCase();
      const lowerSha = cp.sha.toLowerCase();

      // git SHAs are lowercase by default. allowedShas with uppercase
      // variant will NOT match the lowercase SHA in the input.
      const result = await rollbackTo({
        cwd: workdir,
        sha: lowerSha,
        allowedShas: [upperSha],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/safety violation/);
      }
    });

    test('error message names the offending SHA verbatim', async () => {
      const result = await rollbackTo({
        cwd: workdir,
        sha: 'deadbeefdeadbeef',
        allowedShas: ['some-other'],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('deadbeefdeadbeef');
        expect(result.error).toMatch(/safety violation: SHA .* is not in this session's allowed list/);
      }
    });

    test('exact error template: "safety violation: SHA ${sha} is not in this session\'s allowed list"', async () => {
      const result = await rollbackTo({
        cwd: workdir,
        sha: 'abc123',
        allowedShas: ['def456'],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(
          `safety violation: SHA abc123 is not in this session's allowed list`,
        );
      }
    });
  });

  describe('SHA existence check (git cat-file -t)', () => {
    test('non-existent SHA returns error with "unknown revision" prefix', async () => {
      const result = await rollbackTo({
        cwd: workdir,
        sha: '0000000000000000000000000000000000000000',
        // no allowedShas → proceeds to cat-file check
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.startsWith('unknown revision ')).toBe(true);
      }
    });

    test('unknown revision error includes the SHA verbatim', async () => {
      const bogusSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
      const result = await rollbackTo({ cwd: workdir, sha: bogusSha });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain(bogusSha);
      }
    });
  });

  describe('git reset --hard behavior', () => {
    test('working tree files are reverted to checkpoint content', async () => {
      await writeFile(join(workdir, 'preserve.txt'), 'keep-me');
      const cp1 = await createCheckpoint({ cwd: workdir, label: 'base' });
      if (!cp1.ok) throw new Error('cp1 failed');

      // Mutate the file post-checkpoint.
      await writeFile(join(workdir, 'preserve.txt'), 'changed-bad');
      const cp2 = await createCheckpoint({ cwd: workdir, label: 'bad' });
      if (!cp2.ok) throw new Error('cp2 failed');

      // Roll back to cp1 — file should be restored to 'keep-me'.
      const result = await rollbackTo({ cwd: workdir, sha: cp1.sha });
      expect(result.ok).toBe(true);

      const after = await readFile(join(workdir, 'preserve.txt'), 'utf8');
      expect(after).toBe('keep-me');
    });

    test('HEAD ref points to target SHA after rollback', async () => {
      await writeFile(join(workdir, 'h.txt'), 'h1');
      const cp = await createCheckpoint({ cwd: workdir, label: 'target' });
      if (!cp.ok) throw new Error('cp failed');

      // Add another commit on top.
      await writeFile(join(workdir, 'h.txt'), 'h2');
      await createCheckpoint({ cwd: workdir, label: 'after' });

      // Roll back.
      const result = await rollbackTo({ cwd: workdir, sha: cp.sha });
      expect(result.ok).toBe(true);

      const head = await getHeadSha(workdir);
      expect(head).toBe(cp.sha);
    });

    test('intermediate commits are discarded from history (reset --hard, not revert)', async () => {
      // git reset --hard moves the branch ref; it does NOT create a
      // revert commit. The intermediate commits are no longer reachable
      // from HEAD (though they remain in the reflog until GC).
      await writeFile(join(workdir, 'f.txt'), 'v1');
      const cp1 = await createCheckpoint({ cwd: workdir, label: 'base' });
      if (!cp1.ok) throw new Error('cp1 failed');

      await writeFile(join(workdir, 'f.txt'), 'v2');
      await createCheckpoint({ cwd: workdir, label: 'middle' });

      await writeFile(join(workdir, 'f.txt'), 'v3');
      await createCheckpoint({ cwd: workdir, label: 'top' });

      // Roll back to base.
      await rollbackTo({ cwd: workdir, sha: cp1.sha });

      // git log should now show only the base commit.
      const logR = await execFileNoThrow(
        'git',
        ['log', '--format=%s'],
        { cwd: workdir },
      );
      const subjects = logR.stdout.trim().split('\n');
      expect(subjects).toEqual(['checkpoint/base']);
    });
  });

  describe('git clean -fd behavior (untracked file removal)', () => {
    test('untracked files created after the checkpoint are removed', async () => {
      await writeFile(join(workdir, 'tracked.txt'), 'v1');
      const cp = await createCheckpoint({ cwd: workdir, label: 'base' });
      if (!cp.ok) throw new Error('cp failed');

      // Write an untracked file (no git add).
      await writeFile(join(workdir, 'untracked.txt'), 'should-be-removed');

      // Roll back.
      const result = await rollbackTo({ cwd: workdir, sha: cp.sha });
      expect(result.ok).toBe(true);

      // Untracked file should be gone.
      const cat = await execFileNoThrow('cat', [join(workdir, 'untracked.txt')], {});
      expect(cat.exitCode).not.toBe(0);
    });

    test('untracked directories are removed (-d flag)', async () => {
      await writeFile(join(workdir, 'tracked.txt'), 'v1');
      const cp = await createCheckpoint({ cwd: workdir, label: 'base' });
      if (!cp.ok) throw new Error('cp failed');

      // Create an untracked directory with nested content.
      await execFileNoThrow('mkdir', ['-p', join(workdir, 'untracked-dir')], {});
      await writeFile(join(workdir, 'untracked-dir', 'nested.txt'), 'nested');

      await rollbackTo({ cwd: workdir, sha: cp.sha });

      // Directory should be gone.
      const lsR = await execFileNoThrow('ls', [workdir], {});
      expect(lsR.stdout).not.toContain('untracked-dir');
    });

    test('gitignored files are PRESERVED (clean without -x)', async () => {
      // The source uses `git clean -fd`, NOT `git clean -fdx`. Ignored
      // files survive rollback — this is load-bearing because the
      // .env file (containing real API keys) is gitignored and must
      // survive every rollback.
      await writeFile(join(workdir, '.gitignore'), 'secret.env\n');
      const cp = await createCheckpoint({ cwd: workdir, label: 'with-ignore' });
      if (!cp.ok) throw new Error('cp failed');

      // Create an ignored file.
      await writeFile(join(workdir, 'secret.env'), 'ODYSSEUS_LLM_API_KEY=fake');

      await rollbackTo({ cwd: workdir, sha: cp.sha });

      // The ignored file MUST still exist.
      const cat = await execFileNoThrow('cat', [join(workdir, 'secret.env')], {});
      expect(cat.exitCode).toBe(0);
      expect(cat.stdout).toContain('ODYSSEUS_LLM_API_KEY');
    });
  });

  describe('error handling — git failures', () => {
    test('not-a-git-repo cwd produces error', async () => {
      const empty = await mkdtemp(join(tmpdir(), 'ody-rb-inv-nogit-'));
      try {
        const result = await rollbackTo({ cwd: empty, sha: 'abc' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          // cat-file on a non-repo errors out.
          expect(result.error.length).toBeGreaterThan(0);
        }
      } finally {
        await rm(empty, { recursive: true, force: true });
      }
    });
  });

  describe('purity — input object is not mutated', () => {
    test('rollbackTo does not modify the input object', async () => {
      await writeFile(join(workdir, 'p.txt'), 'p');
      const cp = await createCheckpoint({ cwd: workdir, label: 'purity' });
      if (!cp.ok) throw new Error('cp failed');

      const input: RollbackInput = {
        cwd: workdir,
        sha: cp.sha,
        allowedShas: [cp.sha],
      };
      const snapshot = { ...input, allowedShas: [...input.allowedShas!] };
      await rollbackTo(input);
      expect(input).toEqual(snapshot);
    });
  });

  describe('combined safety: allowedShas + existence ordering', () => {
    test('guard fires before existence check (safe SHA rejected by list → never reaches git)', async () => {
      // If the list rejects, git cat-file is never called. Verify by
      // rejecting a SHA that doesn't even exist — the error must be
      // "safety violation", not "unknown revision".
      const result = await rollbackTo({
        cwd: workdir,
        sha: 'bogus-nonexistent-sha',
        allowedShas: ['some-different-sha'],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/safety violation/);
        expect(result.error).not.toMatch(/unknown revision/);
      }
    });

    test('allowed SHA passes guard, then existence check fires for bogus SHA', async () => {
      // SHA is in the list but doesn't exist in git → guard passes,
      // cat-file fails.
      const result = await rollbackTo({
        cwd: workdir,
        sha: 'bogus-but-allowed',
        allowedShas: ['bogus-but-allowed'],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/unknown revision/);
        expect(result.error).not.toMatch(/safety violation/);
      }
    });

    test('full happy path: real SHA in allowed list succeeds', async () => {
      await writeFile(join(workdir, 'happy.txt'), 'h');
      const cp = await createCheckpoint({ cwd: workdir, label: 'happy' });
      if (!cp.ok) throw new Error('cp failed');

      // Mutate then roll back.
      await writeFile(join(workdir, 'happy.txt'), 'changed');
      const result = await rollbackTo({
        cwd: workdir,
        sha: cp.sha,
        allowedShas: [cp.sha],
      });
      expect(result.ok).toBe(true);

      const after = await readFile(join(workdir, 'happy.txt'), 'utf8');
      expect(after).toBe('h');
    });
  });
});
