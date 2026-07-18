import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileNoThrow } from '../../src/util/exec.js';
import { createCheckpoint } from '../../src/cerebellum/checkpoint.js';
import { rollbackTo } from '../../src/cerebellum/rollback.js';

async function initRepo(dir: string): Promise<void> {
  await execFileNoThrow('git', ['init'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.email', 'test@test.test'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

describe('rollbackTo', () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-rb-'));
    await initRepo(workdir);
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('resets working tree to a previous checkpoint SHA', async () => {
    await writeFile(join(workdir, 'file.txt'), 'v1');
    const cp = await createCheckpoint({ cwd: workdir, label: 'base' });
    if (!cp.ok) throw new Error('checkpoint failed');
    const baseSha = cp.sha;

    await writeFile(join(workdir, 'file.txt'), 'v2-bad');
    await createCheckpoint({ cwd: workdir, label: 'bad' });

    const result = await rollbackTo({ cwd: workdir, sha: baseSha });
    expect(result.ok).toBe(true);

    const after = await readFile(join(workdir, 'file.txt'), 'utf8');
    expect(after).toBe('v1');
  });

  test('refuses to roll back to a SHA not in allowedShas list', async () => {
    await writeFile(join(workdir, 'x.txt'), 'x');
    const result = await rollbackTo({
      cwd: workdir,
      sha: 'abc123',
      allowedShas: ['def456'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/safety|not in|forbidden/i);
  });

  test('non-existent SHA returns git error', async () => {
    await writeFile(join(workdir, 'x.txt'), 'x');
    const result = await rollbackTo({ cwd: workdir, sha: 'deadbeef' });
    expect(result.ok).toBe(false);
  });
});
