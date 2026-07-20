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

  // ---------------------------------------------------------------------
  // Iteration 29 — output cap. Without this, a single `git log` or
  // `find` could dump tens of thousands of chars into conversation
  // history permanently, multiplying token cost across every subsequent
  // iteration in the waypoint.
  // ---------------------------------------------------------------------

  describe('Iteration 29 — output cap', () => {
    test('caps stdout at 20k chars and appends a truncation notice', async () => {
      // Generate 50k chars of stdout — well over the 20k cap. Use printf
      // with repeated chars (no newlines) so the visible content is a
      // single solid run we can assert against.
      const result = await tool.execute(
        { command: 'printf %0.sx $(seq 1 50000)' },
        { cwd: workdir }
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Cap is 20k chars + notice length.
        expect(result.value.length).toBeGreaterThan(20_000);
        expect(result.value.length).toBeLessThan(22_500);
        // The visible content (before the notice) is exactly 20000 'x' chars.
        expect(result.value.startsWith('x'.repeat(20))).toBe(true);
        expect(result.value).toContain('[truncated:');
        expect(result.value).toContain('was 50000 chars');
        expect(result.value).toContain('use offset/limit or narrow the query');
      }
    });

    test('does not cap stdout below the threshold', async () => {
      // 100 chars is well within cap — should return verbatim with no notice.
      const result = await tool.execute(
        { command: 'printf %s "$(seq 1 20)"' },
        { cwd: workdir }
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toContain('[truncated:');
      }
    });

    test('caps stderr too when the command fails with verbose stderr', async () => {
      // A failing command that dumps 50k chars to stderr must not blow
      // up the orchestrator's error pipeline. The cap applies to stderr
      // in the failure-path error message. Use printf to produce exactly
      // 50000 'x' chars on stderr (yes | head counts differently — see
      // the stdout test above for the same lesson).
      const result = await tool.execute(
        { command: 'printf %0.sx $(seq 1 50000) >&2 && exit 7' },
        { cwd: workdir }
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('exit 7');
        expect(result.error).toContain('[truncated:');
        expect(result.error).toContain('was 50000 chars');
      }
    });
  });
});
