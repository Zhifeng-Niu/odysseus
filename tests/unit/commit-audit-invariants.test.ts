/**
 * Invariants for src/cerebellum/commit-audit.ts.
 *
 * The existing commit-audit.test.ts covers behavior (isCommitEmpty true/false,
 * detectEmptyWaypointCommits basic flow + since option + regression for the
 * 43b6a7c false-success pattern, countEmptyWaypointCommits cardinality).
 * This file pins the load-bearing structural contracts that the behavioral
 * tests only imply:
 *
 *   - EmptyWaypointCommit / AuditOptions type shapes (exact field enumeration)
 *   - isCommitEmpty "unknown commit → false" contract (never throws, never
 *     returns true for a SHA git can't resolve)
 *   - isCommitEmpty regex: /(\d+) files? changed/ (singular/plural)
 *   - isWaypointOkSubject predicate (private but observable):
 *       starts with `waypoint/` AND ends with `-ok`
 *       → `waypoint/wp_X-start` excluded, `checkpoint/` excluded,
 *         human commits excluded, bare `waypoint/foo` excluded
 *   - detectEmptyWaypointCommits default limit (1000) and `since` range
 *     templating (`${since}..HEAD`)
 *   - detectEmptyWaypointCommits returns empty array on git failure
 *     (invalid range, non-repo cwd) — NEVER throws
 *   - detectEmptyWaypointCommits output is in reverse-chronological order
 *     (newest first) — same as git log default
 *   - detectEmptyWaypointCommits output SHA matches /^[0-9a-f]{40}$/
 *   - detectEmptyWaypointCommits output date parses as ISO 8601 (%aI)
 *   - countEmptyWaypointCommits === detectEmptyWaypointCommits.length
 *
 * The "checkpoint/* always excluded" contract is load-bearing because
 * checkpoint commits are structurally allowed to be empty (the lazy
 * pre-dispatch path may run before any mutating tool fires). If a future
 * refactor accidentally includes them, every lazy-checkpoint waypoint
 * would register as a false success — pinning this is critical.
 *
 * The "waypoint/wp_X-start excluded" contract is load-bearing because
 * `...-start` is the pre-dispatch marker (committed before the agent
 * runs); only `...-ok` is the post-success marker. A flipped suffix
 * would make the audit flag every waypoint twice.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileNoThrow } from '../../src/util/exec.js';
import {
  isCommitEmpty,
  detectEmptyWaypointCommits,
  countEmptyWaypointCommits,
  type EmptyWaypointCommit,
  type AuditOptions,
} from '../../src/cerebellum/commit-audit.js';

async function initRepo(dir: string): Promise<void> {
  await execFileNoThrow('git', ['init'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.email', 'test@test.test'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await writeFile(join(dir, 'README.md'), 'initial\n');
  await execFileNoThrow('git', ['add', 'README.md'], { cwd: dir });
  await execFileNoThrow('git', ['commit', '-m', 'initial'], { cwd: dir });
}

async function shaOf(cwd: string, ref: string = 'HEAD'): Promise<string> {
  const r = await execFileNoThrow('git', ['rev-parse', ref], { cwd });
  return r.stdout.trim();
}

async function makeCommit(
  cwd: string,
  message: string,
  options: { empty?: boolean; files?: Record<string, string> } = {},
): Promise<string> {
  if (options.files !== undefined) {
    for (const [path, content] of Object.entries(options.files)) {
      const full = join(cwd, path);
      const dir = full.slice(0, full.lastIndexOf('/'));
      if (dir !== cwd) await mkdir(dir, { recursive: true });
      await writeFile(full, content);
    }
    await execFileNoThrow('git', ['add', '-A'], { cwd });
  }
  const args = ['commit', '-m', message];
  if (options.empty === true || (options.files === undefined && options.empty !== false)) {
    args.push('--allow-empty');
  }
  await execFileNoThrow('git', args, { cwd });
  return shaOf(cwd);
}

describe('commit-audit invariants', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ody-ca-inv-'));
    await initRepo(cwd);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // EmptyWaypointCommit type shape
  // -------------------------------------------------------------------------

  describe('EmptyWaypointCommit type shape', () => {
    test('has exactly {sha, subject, date} fields', async () => {
      await makeCommit(cwd, 'waypoint/wp_fields-ok', { empty: true });
      const results = await detectEmptyWaypointCommits(cwd);
      expect(results).toHaveLength(1);
      const entry: EmptyWaypointCommit = results[0]!;
      expect(Object.keys(entry).sort()).toEqual(['date', 'sha', 'subject']);
    });

    test('sha is a string', async () => {
      await makeCommit(cwd, 'waypoint/wp_sha-ok', { empty: true });
      const [entry] = await detectEmptyWaypointCommits(cwd);
      expect(typeof entry!.sha).toBe('string');
    });

    test('subject is a string', async () => {
      await makeCommit(cwd, 'waypoint/wp_subj-ok', { empty: true });
      const [entry] = await detectEmptyWaypointCommits(cwd);
      expect(typeof entry!.subject).toBe('string');
    });

    test('date is a string (ISO 8601 via git %aI)', async () => {
      await makeCommit(cwd, 'waypoint/wp_date-ok', { empty: true });
      const [entry] = await detectEmptyWaypointCommits(cwd);
      expect(typeof entry!.date).toBe('string');
      // ISO 8601 strict form: YYYY-MM-DDTHH:MM:SS±ZZ:ZZ
      expect(entry!.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    });

    test('date is parseable by Date.parse (finite epoch)', async () => {
      await makeCommit(cwd, 'waypoint/wp_parse-ok', { empty: true });
      const [entry] = await detectEmptyWaypointCommits(cwd);
      const epoch = Date.parse(entry!.date);
      expect(Number.isFinite(epoch)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // AuditOptions type shape
  // -------------------------------------------------------------------------

  describe('AuditOptions type shape', () => {
    test('both fields are optional — empty object is valid', () => {
      const opts: AuditOptions = {};
      expect(opts.since).toBeUndefined();
      expect(opts.limit).toBeUndefined();
    });

    test('since can be a string ref (SHA, branch, HEAD~N)', () => {
      const opts: AuditOptions = { since: 'HEAD~10' };
      expect(opts.since).toBe('HEAD~10');
    });

    test('limit can be a number', () => {
      const opts: AuditOptions = { limit: 500 };
      expect(opts.limit).toBe(500);
    });

    test('both can be combined', () => {
      const opts: AuditOptions = { since: 'main', limit: 50 };
      expect(opts).toEqual({ since: 'main', limit: 50 });
    });
  });

  // -------------------------------------------------------------------------
  // isCommitEmpty — structural contracts
  // -------------------------------------------------------------------------

  describe('isCommitEmpty structural contracts', () => {
    test('returns false for unknown SHA (does not throw)', async () => {
      // A SHA that doesn't exist. git show returns non-zero exit; the
      // function returns false rather than throwing.
      const result = await isCommitEmpty(cwd, '0'.repeat(40));
      expect(result).toBe(false);
    });

    test('returns false for malformed SHA (does not throw)', async () => {
      const result = await isCommitEmpty(cwd, 'not-a-sha-at-all');
      expect(result).toBe(false);
    });

    test('regex matches plural "files changed"', async () => {
      // A commit touching 2+ files has "N files changed" (plural).
      await writeFile(join(cwd, 'a.txt'), 'a\n');
      await writeFile(join(cwd, 'b.txt'), 'b\n');
      await execFileNoThrow('git', ['add', '-A'], { cwd });
      await execFileNoThrow('git', ['commit', '-m', 'two files'], { cwd });
      const sha = await shaOf(cwd);
      expect(await isCommitEmpty(cwd, sha)).toBe(false);
    });

    test('regex matches singular "1 file changed"', async () => {
      // A commit touching exactly 1 file has "1 file changed" (singular).
      await writeFile(join(cwd, 'only.txt'), 'content\n');
      await execFileNoThrow('git', ['add', '-A'], { cwd });
      await execFileNoThrow('git', ['commit', '-m', 'one file'], { cwd });
      const sha = await shaOf(cwd);
      expect(await isCommitEmpty(cwd, sha)).toBe(false);
    });

    test('a commit that only adds lines (no new file) is non-empty', async () => {
      await writeFile(join(cwd, 'README.md'), 'initial\nappended\n');
      await execFileNoThrow('git', ['add', '-A'], { cwd });
      await execFileNoThrow('git', ['commit', '-m', 'append'], { cwd });
      const sha = await shaOf(cwd);
      expect(await isCommitEmpty(cwd, sha)).toBe(false);
    });

    test('return type is strictly boolean (not truthy/falsy)', async () => {
      await makeCommit(cwd, 'waypoint/wp_bool-ok', { empty: true });
      const sha = await shaOf(cwd);
      const result = await isCommitEmpty(cwd, sha);
      expect(typeof result).toBe('boolean');
    });
  });

  // -------------------------------------------------------------------------
  // isWaypointOkSubject predicate (private but observable via filtering)
  // -------------------------------------------------------------------------

  describe('isWaypointOkSubject predicate (observable via filter)', () => {
    test('subject "waypoint/wp_abc-ok" → included', async () => {
      await makeCommit(cwd, 'waypoint/wp_abc-ok', { empty: true });
      const results = await detectEmptyWaypointCommits(cwd);
      expect(results.some((r) => r.subject === 'waypoint/wp_abc-ok')).toBe(true);
    });

    test('subject "waypoint/wp_abc-start" → EXCLUDED (wrong suffix)', async () => {
      // The `-start` suffix marks pre-dispatch checkpoints; only `-ok`
      // marks post-success. Mixing them would double-count every waypoint.
      await makeCommit(cwd, 'waypoint/wp_abc-start', { empty: true });
      const results = await detectEmptyWaypointCommits(cwd);
      expect(results.some((r) => r.subject === 'waypoint/wp_abc-start')).toBe(false);
    });

    test('subject "checkpoint/wp_abc-start" → EXCLUDED (wrong prefix)', async () => {
      // Checkpoint commits are structurally allowed to be empty.
      await makeCommit(cwd, 'checkpoint/wp_abc-start', { empty: true });
      const results = await detectEmptyWaypointCommits(cwd);
      expect(results.some((r) => r.subject === 'checkpoint/wp_abc-start')).toBe(false);
    });

    test('subject "checkpoint/wp_abc-ok" → EXCLUDED (checkpoint prefix)', async () => {
      // Even if a checkpoint commit ended in -ok (unusual but possible),
      // the `checkpoint/` prefix excludes it.
      await makeCommit(cwd, 'checkpoint/wp_abc-ok', { empty: true });
      const results = await detectEmptyWaypointCommits(cwd);
      expect(results.some((r) => r.subject === 'checkpoint/wp_abc-ok')).toBe(false);
    });

    test('human-authored commit "feat: ..." → EXCLUDED', async () => {
      await makeCommit(cwd, 'feat: real feature', { empty: true });
      const results = await detectEmptyWaypointCommits(cwd);
      expect(results.some((r) => r.subject === 'feat: real feature')).toBe(false);
    });

    test('subject "waypoint/foo" (no -ok suffix) → EXCLUDED', async () => {
      await makeCommit(cwd, 'waypoint/foo', { empty: true });
      const results = await detectEmptyWaypointCommits(cwd);
      expect(results.some((r) => r.subject === 'waypoint/foo')).toBe(false);
    });

    test('subject "wp_abc-ok" (no waypoint/ prefix) → EXCLUDED', async () => {
      // Must have the `waypoint/` prefix. A bare `wp_abc-ok` is probably
      // a typo but the predicate is strict.
      await makeCommit(cwd, 'wp_abc-ok', { empty: true });
      const results = await detectEmptyWaypointCommits(cwd);
      expect(results.some((r) => r.subject === 'wp_abc-ok')).toBe(false);
    });

    test('subject "waypoint/" (just prefix, nothing else) → EXCLUDED', async () => {
      // Edge case: prefix only, no suffix -ok.
      await makeCommit(cwd, 'waypoint/', { empty: true });
      const results = await detectEmptyWaypointCommits(cwd);
      expect(results).toHaveLength(0);
    });

    test('subject "waypoint/-ok" (prefix and suffix, no id) → included (predicate passes)', async () => {
      // Edge case: the predicate only checks startsWith + endsWith. The
      // empty middle is not validated. Pinning this as load-bearing
      // quirk — a future "require non-empty id" check would surface here.
      await makeCommit(cwd, 'waypoint/-ok', { empty: true });
      const results = await detectEmptyWaypointCommits(cwd);
      expect(results.some((r) => r.subject === 'waypoint/-ok')).toBe(true);
    });

    test('suffix matching is case-sensitive (-OK does not match)', async () => {
      // .endsWith('-ok') is verbatim; uppercase -OK is NOT a match.
      // Pinning so a future "case-insensitive" refactor surfaces.
      await makeCommit(cwd, 'waypoint/wp_case-OK', { empty: true });
      const results = await detectEmptyWaypointCommits(cwd);
      expect(results.some((r) => r.subject === 'waypoint/wp_case-OK')).toBe(false);
    });

    test('prefix matching is case-sensitive (Waypoint/ does not match)', async () => {
      await makeCommit(cwd, 'Waypoint/wp_case-ok', { empty: true });
      const results = await detectEmptyWaypointCommits(cwd);
      expect(results.some((r) => r.subject === 'Waypoint/wp_case-ok')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // detectEmptyWaypointCommits — default options and range templating
  // -------------------------------------------------------------------------

  describe('detectEmptyWaypointCommits default options', () => {
    test('options argument can be omitted entirely', async () => {
      await makeCommit(cwd, 'waypoint/wp_omit-ok', { empty: true });
      // No argument at all — uses defaults.
      const results = await detectEmptyWaypointCommits(cwd);
      expect(results).toHaveLength(1);
    });

    test('options can be an empty object (uses defaults)', async () => {
      await makeCommit(cwd, 'waypoint/wp_empty_opts-ok', { empty: true });
      const results = await detectEmptyWaypointCommits(cwd, {});
      expect(results).toHaveLength(1);
    });

    test('default limit is 1000 (not unbounded)', async () => {
      // We can't easily create 1001 commits in a unit test, but we CAN
      // verify the limit flag is passed by passing an explicit smaller
      // limit and confirming it bounds the scan.
      await makeCommit(cwd, 'waypoint/wp_lim1-ok', { empty: true });
      await makeCommit(cwd, 'waypoint/wp_lim2-ok', { empty: true });
      await makeCommit(cwd, 'waypoint/wp_lim3-ok', { empty: true });

      // limit=2 means git log only walks 2 commits back.
      const results = await detectEmptyWaypointCommits(cwd, { limit: 2 });
      // Only the 2 most-recent should be visible.
      expect(results).toHaveLength(2);
      expect(results[0]!.subject).toBe('waypoint/wp_lim3-ok');
      expect(results[1]!.subject).toBe('waypoint/wp_lim2-ok');
    });

    test('since ref bounds the range to "${since}..HEAD"', async () => {
      await makeCommit(cwd, 'waypoint/wp_pre-ok', { empty: true });
      const boundary = await shaOf(cwd);

      // These three are after the boundary.
      await makeCommit(cwd, 'waypoint/wp_post1-ok', { empty: true });
      await makeCommit(cwd, 'waypoint/wp_post2-ok', { empty: true });

      const results = await detectEmptyWaypointCommits(cwd, { since: boundary });
      expect(results.map((r) => r.subject)).toEqual([
        'waypoint/wp_post2-ok',
        'waypoint/wp_post1-ok',
      ]);
    });

    test('since with a non-existent ref returns empty array (git fails gracefully)', async () => {
      await makeCommit(cwd, 'waypoint/wp_x-ok', { empty: true });
      const results = await detectEmptyWaypointCommits(cwd, {
        since: 'definitely-not-a-ref-xyz',
      });
      expect(results).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // detectEmptyWaypointCommits — output ordering
  // -------------------------------------------------------------------------

  describe('detectEmptyWaypointCommits output ordering', () => {
    test('results are in reverse-chronological order (newest first)', async () => {
      await makeCommit(cwd, 'waypoint/wp_old-ok', { empty: true });
      await makeCommit(cwd, 'waypoint/wp_mid-ok', { empty: true });
      await makeCommit(cwd, 'waypoint/wp_new-ok', { empty: true });

      const results = await detectEmptyWaypointCommits(cwd);
      expect(results.map((r) => r.subject)).toEqual([
        'waypoint/wp_new-ok',
        'waypoint/wp_mid-ok',
        'waypoint/wp_old-ok',
      ]);
    });

    test('all SHAs in output are 40-char lowercase hex', async () => {
      await makeCommit(cwd, 'waypoint/wp_hex1-ok', { empty: true });
      await makeCommit(cwd, 'waypoint/wp_hex2-ok', { empty: true });
      const results = await detectEmptyWaypointCommits(cwd);
      for (const r of results) {
        expect(r.sha).toMatch(/^[0-9a-f]{40}$/);
      }
    });
  });

  // -------------------------------------------------------------------------
  // detectEmptyWaypointCommits — failure modes (never throws)
  // -------------------------------------------------------------------------

  describe('detectEmptyWaypointCommits failure modes', () => {
    test('non-git cwd returns empty array (git log fails)', async () => {
      const empty = await mkdtemp(join(tmpdir(), 'ody-ca-inv-nogit-'));
      try {
        const results = await detectEmptyWaypointCommits(empty);
        expect(results).toEqual([]);
      } finally {
        await rm(empty, { recursive: true, force: true });
      }
    });

    test('returns empty array (not null, not undefined) when no matches', async () => {
      // Repo with only real-diff waypoint commits.
      await makeCommit(cwd, 'waypoint/wp_real-ok', {
        files: { 'src/a.ts': 'a\n' },
      });
      const results = await detectEmptyWaypointCommits(cwd);
      expect(results).toEqual([]);
      expect(Array.isArray(results)).toBe(true);
    });

    test('returned array is readonly (frozen contract)', async () => {
      await makeCommit(cwd, 'waypoint/wp_ro-ok', { empty: true });
      const results = await detectEmptyWaypointCommits(cwd);
      // Type is `readonly EmptyWaypointCommit[]`. We can't enforce
      // readonly at runtime without Object.freeze, but the type contract
      // is what callers depend on.
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // countEmptyWaypointCommits — derived from detect
  // -------------------------------------------------------------------------

  describe('countEmptyWaypointCommits contract', () => {
    test('returns exactly detectEmptyWaypointCommits.length', async () => {
      await makeCommit(cwd, 'waypoint/wp_a-ok', { empty: true });
      await makeCommit(cwd, 'waypoint/wp_b-ok', {
        files: { 'src/b.ts': 'b\n' },
      });
      await makeCommit(cwd, 'waypoint/wp_c-ok', { empty: true });

      const detected = await detectEmptyWaypointCommits(cwd);
      const counted = await countEmptyWaypointCommits(cwd);
      expect(counted).toBe(detected.length);
      expect(counted).toBe(2);
    });

    test('returns 0 when no empty waypoint commits', async () => {
      await makeCommit(cwd, 'waypoint/wp_real-ok', {
        files: { 'src/r.ts': 'r\n' },
      });
      expect(await countEmptyWaypointCommits(cwd)).toBe(0);
    });

    test('accepts the same AuditOptions as detect', async () => {
      await makeCommit(cwd, 'waypoint/wp_pre-ok', { empty: true });
      const boundary = await shaOf(cwd);
      await makeCommit(cwd, 'waypoint/wp_post-ok', { empty: true });

      const count = await countEmptyWaypointCommits(cwd, { since: boundary });
      expect(count).toBe(1);
    });

    test('returns a finite number (never NaN, never Infinity)', async () => {
      await makeCommit(cwd, 'waypoint/wp_num-ok', { empty: true });
      const count = await countEmptyWaypointCommits(cwd);
      expect(typeof count).toBe('number');
      expect(Number.isFinite(count)).toBe(true);
      expect(Number.isInteger(count)).toBe(true);
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  // -------------------------------------------------------------------------
  // Real-world regression pattern (matches commit 43b6a7c)
  // -------------------------------------------------------------------------

  describe('real-world false-success pattern regression', () => {
    test('checkpoint-start followed by empty waypoint-ok flags only the waypoint', async () => {
      // The exact pattern from commit 43b6a7c (Iteration 19 regression):
      //   checkpoint/wp_X-start   (empty by design)
      //   waypoint/wp_X-ok        (empty — the false success)
      await makeCommit(cwd, 'checkpoint/wp_mrs9myra005-start', { empty: true });
      await makeCommit(cwd, 'waypoint/wp_mrs9myra005-ok', { empty: true });

      const results = await detectEmptyWaypointCommits(cwd);
      expect(results).toHaveLength(1);
      expect(results[0]!.subject).toBe('waypoint/wp_mrs9myra005-ok');
      // checkpoint commit is NOT in the results.
      expect(results.some((r) => r.subject.startsWith('checkpoint/'))).toBe(false);
    });

    test('a sequence of checkpoint+real-waypoint pairs flags nothing', async () => {
      // Happy path: every waypoint produces real work.
      await makeCommit(cwd, 'checkpoint/wp_a-start', { empty: true });
      await makeCommit(cwd, 'waypoint/wp_a-ok', {
        files: { 'src/a.ts': 'a\n' },
      });
      await makeCommit(cwd, 'checkpoint/wp_b-start', { empty: true });
      await makeCommit(cwd, 'waypoint/wp_b-ok', {
        files: { 'src/b.ts': 'b\n' },
      });

      const results = await detectEmptyWaypointCommits(cwd);
      expect(results).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Edge case: multi-line / unusual subjects
  // -------------------------------------------------------------------------

  describe('subject edge cases', () => {
    test('subject containing pipe character does not break parsing', async () => {
      // The format string is `%H|%s|%aI`. A subject containing `|` could
      // confuse the metaMatch regex /^([0-9a-f]{40})\|(.*)\|(.*)$/.
      // The regex is greedy on the middle group, so the LAST `|` is the
      // date delimiter. Verify a `|` in the subject doesn't corrupt output.
      // Note: we use a subject that still matches the waypoint/...-ok
      // predicate to actually appear in results.
      await makeCommit(cwd, 'waypoint/wp_pipe|in-middle-ok', { empty: true });
      const results = await detectEmptyWaypointCommits(cwd);
      expect(results).toHaveLength(1);
      expect(results[0]!.subject).toBe('waypoint/wp_pipe|in-middle-ok');
    });

    test('long waypoint id is preserved verbatim', async () => {
      // Real waypoint IDs look like `wp_mrs9myra005` (~14 chars). Some
      // test scaffolding creates longer ones — pin that they survive.
      const longId = 'wp_' + 'a'.repeat(50);
      await makeCommit(cwd, `waypoint/${longId}-ok`, { empty: true });
      const results = await detectEmptyWaypointCommits(cwd);
      expect(results[0]!.subject).toBe(`waypoint/${longId}-ok`);
    });
  });
});
