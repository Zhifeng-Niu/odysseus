import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileNoThrow } from '../../src/util/exec.js';
import { GitTool } from '../../src/tools/git.js';

async function initRepo(dir: string): Promise<void> {
  await execFileNoThrow('git', ['init'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.email', 'test@test.test'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

describe('GitTool', () => {
  let workdir: string;
  let tool: GitTool;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-git-'));
    await initRepo(workdir);
    tool = new GitTool();
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('commit creates a commit and returns its SHA', async () => {
    await writeFile(join(workdir, 'a.txt'), 'a');
    const result = await tool.execute(
      { operation: 'commit', message: 'first', addAll: true },
      { cwd: workdir }
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatch(/^[0-9a-f]{7,40}$/);
  });

  test('log returns recent commit messages', async () => {
    await writeFile(join(workdir, 'b.txt'), 'b');
    await tool.execute({ operation: 'commit', message: 'commit one', addAll: true }, { cwd: workdir });
    await writeFile(join(workdir, 'b.txt'), 'bb');
    await tool.execute({ operation: 'commit', message: 'commit two', addAll: true }, { cwd: workdir });

    const result = await tool.execute({ operation: 'log', limit: 5 }, { cwd: workdir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('commit two');
      expect(result.value).toContain('commit one');
    }
  });

  test('reset operation is intentionally not exposed (zeroth law)', async () => {
    const result = await tool.execute(
      { operation: 'reset', target: 'HEAD', hard: true },
      { cwd: workdir }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unknown git operation/i);
  });

  test('status on dirty tree shows untracked files', async () => {
    await mkdir(join(workdir, 'sub'), { recursive: true });
    await writeFile(join(workdir, 'sub', 'new.txt'), 'new');
    const result = await tool.execute({ operation: 'status' }, { cwd: workdir });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatch(/sub|new\.txt/);
  });
});
