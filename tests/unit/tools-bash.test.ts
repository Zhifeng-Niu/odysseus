import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { BashTool } from '../../src/tools/bash.js';

describe('BashTool', () => {
  let workdir: string;
  let tool: BashTool;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-bash-'));
    tool = new BashTool();
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('returns stdout on success', async () => {
    const result = await tool.execute({ command: 'echo hello' }, { cwd: workdir });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.trim()).toBe('hello');
  });

  test('captures non-zero exit codes as failure with stderr', async () => {
    const result = await tool.execute(
      { command: 'echo oops >&2 && exit 7' },
      { cwd: workdir }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/exit 7/);
    if (!result.ok) expect(result.error).toMatch(/oops/);
  });

  test('rejects empty command', async () => {
    const result = await tool.execute({ command: '   ' }, { cwd: workdir });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/command required/i);
  });

  test('respects cwd', async () => {
    const result = await tool.execute({ command: 'pwd' }, { cwd: workdir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // macOS symlinks /var to /private/var — resolve before comparing.
      expect(result.value.trim()).toBe(realpathSync(workdir));
    }
  });

  test('honors custom timeoutMs', async () => {
    const start = Date.now();
    const result = await tool.execute(
      { command: 'sleep 5', timeoutMs: 200 },
      { cwd: workdir }
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
    expect(result.ok).toBe(false);
  }, 5000);
});
