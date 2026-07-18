import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileNoThrow } from '../../src/util/exec.js';
import { createCheckpoint } from '../../src/cerebellum/checkpoint.js';

async function initRepo(dir: string): Promise<void> {
  await execFileNoThrow('git', ['init'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.email', 'test@test.test'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

describe('createCheckpoint', () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-cp-'));
    await initRepo(workdir);
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('commits current state and returns SHA', async () => {
    await writeFile(join(workdir, 'a.txt'), 'initial');
    const result = await createCheckpoint({ cwd: workdir, label: 'wp-001-start' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sha).toMatch(/^[0-9a-f]{7,40}$/);
  });

  test('creates empty commit when tree is clean', async () => {
    const first = await createCheckpoint({ cwd: workdir, label: 'first' });
    expect(first.ok).toBe(true);
    const second = await createCheckpoint({ cwd: workdir, label: 'second' });
    expect(second.ok).toBe(true);
  });

  test('returns error if git is not initialized', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'ody-nogit-'));
    try {
      const result = await createCheckpoint({ cwd: empty, label: 'x' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/git|repository/i);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
