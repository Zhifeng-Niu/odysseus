import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileNoThrow } from '../../src/util/exec.js';
import {
  isCommitEmpty,
  detectEmptyWaypointCommits,
  countEmptyWaypointCommits,
} from '../../src/cerebellum/commit-audit.js';

async function initRepo(dir: string): Promise<void> {
  await execFileNoThrow('git', ['init'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.email', 'test@test.test'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.name', 'Test'], { cwd: dir });
  // Initial commit so HEAD exists for range operations.
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
  options: { empty?: boolean; files?: Record<string, string> } = {}
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

describe('commit-audit — isCommitEmpty', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ody-audit-'));
    await initRepo(cwd);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('returns true for a commit with no file changes', async () => {
    const sha = await makeCommit(cwd, 'waypoint/wp_empty001-ok', { empty: true });
    expect(await isCommitEmpty(cwd, sha)).toBe(true);
  });

  test('returns false for a commit that changed files', async () => {
    const sha = await makeCommit(cwd, 'waypoint/wp_real001-ok', {
      files: { 'src/foo.ts': 'export const x = 1;\n' },
    });
    expect(await isCommitEmpty(cwd, sha)).toBe(false);
  });

  test('returns true for the very first (root) commit if it is empty', async () => {
    // Create a fresh repo with no initial commit, then make an empty commit.
    const fresh = await mkdtemp(join(tmpdir(), 'ody-root-'));
    try {
      await execFileNoThrow('git', ['init'], { cwd: fresh });
      await execFileNoThrow('git', ['config', 'user.email', 't@t.t'], { cwd: fresh });
      await execFileNoThrow('git', ['config', 'user.name', 'T'], { cwd: fresh });
      // Allow-empty root commit (no files staged).
      await execFileNoThrow('git', ['commit', '--allow-empty', '-m', 'root'], { cwd: fresh });
      const rootSha = await shaOf(fresh);
      expect(await isCommitEmpty(fresh, rootSha)).toBe(true);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});

describe('commit-audit — detectEmptyWaypointCommits', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ody-detect-'));
    await initRepo(cwd);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('returns only empty waypoint/...-ok commits', async () => {
    // Three commits:
    //   1. empty waypoint/...-ok   (should be flagged)
    //   2. real waypoint/...-ok    (should NOT be flagged — has diff)
    //   3. empty checkpoint/...    (should NOT be flagged — checkpoint)
    await makeCommit(cwd, 'checkpoint/wp_aaa-start', { empty: true });
    await makeCommit(cwd, 'waypoint/wp_aaa-ok', {
      files: { 'src/real.ts': 'export const real = true;\n' },
    });
    await makeCommit(cwd, 'checkpoint/wp_bbb-start', { empty: true });
    await makeCommit(cwd, 'waypoint/wp_bbb-ok', { empty: true });

    const empty = await detectEmptyWaypointCommits(cwd);
    expect(empty).toHaveLength(1);
    expect(empty[0]!.subject).toBe('waypoint/wp_bbb-ok');
  });

  test('detects multiple empty waypoint commits in chronological order', async () => {
    await makeCommit(cwd, 'waypoint/wp_aaa001-ok', { empty: true });
    await makeCommit(cwd, 'waypoint/wp_bbb002-ok', { empty: true });
    await makeCommit(cwd, 'waypoint/wp_ccc003-ok', {
      files: { 'src/x.ts': 'x\n' },
    });
    await makeCommit(cwd, 'waypoint/wp_ddd004-ok', { empty: true });

    const empty = await detectEmptyWaypointCommits(cwd);
    // Reverse-chronological: newest first.
    expect(empty.map((e) => e.subject)).toEqual([
      'waypoint/wp_ddd004-ok',
      'waypoint/wp_bbb002-ok',
      'waypoint/wp_aaa001-ok',
    ]);
  });

  test('excludes commits without the waypoint/...-ok pattern', async () => {
    // Human-authored commits and other commit types must not be flagged
    // even if they happen to be empty.
    await makeCommit(cwd, 'feat: empty human commit', { empty: true });
    await makeCommit(cwd, 'waypoint/wp_only-ok', { empty: true });

    const empty = await detectEmptyWaypointCommits(cwd);
    expect(empty).toHaveLength(1);
    expect(empty[0]!.subject).toBe('waypoint/wp_only-ok');
  });

  test('respects the since option to bound the scan', async () => {
    // Make a "boundary" commit; we'll scan since this point.
    await makeCommit(cwd, 'waypoint/wp_before-ok', { empty: true });
    const boundary = await shaOf(cwd, 'HEAD');

    // These should be detected.
    await makeCommit(cwd, 'waypoint/wp_after1-ok', { empty: true });
    await makeCommit(cwd, 'waypoint/wp_after2-ok', { empty: true });

    const empty = await detectEmptyWaypointCommits(cwd, { since: boundary });
    expect(empty.map((e) => e.subject)).toEqual([
      'waypoint/wp_after2-ok',
      'waypoint/wp_after1-ok',
    ]);
  });

  test('returns empty array when git log fails (invalid range)', async () => {
    const empty = await detectEmptyWaypointCommits(cwd, {
      since: 'not-a-real-ref',
    });
    expect(empty).toEqual([]);
  });

  test('returns full 40-char SHA, subject, and ISO date', async () => {
    await makeCommit(cwd, 'waypoint/wp_fields-ok', { empty: true });
    const empty = await detectEmptyWaypointCommits(cwd);
    expect(empty).toHaveLength(1);
    const entry = empty[0]!;
    expect(entry.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(entry.subject).toBe('waypoint/wp_fields-ok');
    // ISO 8601 — `%aI` format. At minimum the date should parse.
    const parsed = Date.parse(entry.date);
    expect(Number.isNaN(parsed)).toBe(false);
  });
});

describe('commit-audit — countEmptyWaypointCommits', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ody-count-'));
    await initRepo(cwd);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('returns zero when all waypoint commits have real diffs', async () => {
    await makeCommit(cwd, 'waypoint/wp_a-ok', {
      files: { 'src/a.ts': 'a\n' },
    });
    await makeCommit(cwd, 'waypoint/wp_b-ok', {
      files: { 'src/b.ts': 'b\n' },
    });
    expect(await countEmptyWaypointCommits(cwd)).toBe(0);
  });

  test('counts only empty waypoint commits', async () => {
    await makeCommit(cwd, 'waypoint/wp_a-ok', { empty: true });
    await makeCommit(cwd, 'waypoint/wp_b-ok', {
      files: { 'src/b.ts': 'b\n' },
    });
    await makeCommit(cwd, 'waypoint/wp_c-ok', { empty: true });
    await makeCommit(cwd, 'checkpoint/wp_d-start', { empty: true });
    expect(await countEmptyWaypointCommits(cwd)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Real-world regression: the original false-success commit (43b6a7c).
// We can't reproduce that exact commit, but we verify the same pattern
// (empty diff + waypoint/...-ok subject) is caught.
// ---------------------------------------------------------------------------
describe('commit-audit — regression for real-world false-success pattern', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ody-regress-'));
    await initRepo(cwd);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('catches the "checkpoint-start then empty waypoint-ok" sequence', async () => {
    // This is exactly the pattern observed in commit 43b6a7c:
    //   checkpoint/wp_mrtpf2n5002-start (empty by design)
    //   waypoint/wp_mrtpf2n5002-ok     (empty — FALSE SUCCESS)
    await makeCommit(cwd, 'checkpoint/wp_mrtpf2n5002-start', { empty: true });
    await makeCommit(cwd, 'waypoint/wp_mrtpf2n5002-ok', { empty: true });

    const empty = await detectEmptyWaypointCommits(cwd);
    expect(empty).toHaveLength(1);
    expect(empty[0]!.subject).toBe('waypoint/wp_mrtpf2n5002-ok');

    // isCommitEmpty also catches it on direct inspection.
    expect(await isCommitEmpty(cwd, empty[0]!.sha)).toBe(true);
  });
});
