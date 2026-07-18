import { describe, test, expect } from 'vitest';
import { getEventListeners } from 'node:events';
import { execFileNoThrow } from '../../src/util/exec.js';

describe('execFileNoThrow', () => {
  test('returns stdout on success', async () => {
    const result = await execFileNoThrow('node', ['-e', 'process.stdout.write("hi")']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hi');
    expect(result.stderr).toBe('');
  });

  test('captures stderr and exit code on non-zero exit', async () => {
    const result = await execFileNoThrow('node', [
      '-e',
      'process.stderr.write("oops"); process.exit(2)',
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('oops');
  });

  test('does not throw — errors become structured results', async () => {
    const result = await execFileNoThrow('this-binary-does-not-exist', []);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/this-binary-does-not-exist|ENOENT/i);
  });

  test('passes cwd and env through to child process', async () => {
    const result = await execFileNoThrow(
      'node',
      ['-e', 'process.stdout.write(process.env.TEST_VAR ?? "")'],
      { env: { ...process.env, TEST_VAR: 'injected' } }
    );
    expect(result.stdout).toBe('injected');
  });

  test('respects timeoutMs option', async () => {
    const start = Date.now();
    const result = await execFileNoThrow('node', ['-e', 'setTimeout(()=>{}, 5000)'], {
      timeoutMs: 100,
    });
    const elapsed = Date.now() - start;
    expect(result.exitCode).not.toBe(0);
    expect(elapsed).toBeLessThan(2000);
  });

  test('removes abort listener after child completes normally', async () => {
    const controller = new AbortController();
    const before = getEventListeners(controller.signal, 'abort').length;

    await execFileNoThrow('node', ['-e', 'process.stdout.write("ok")'], {
      signal: controller.signal,
    });

    const after = getEventListeners(controller.signal, 'abort').length;
    expect(after).toBe(before);
  });
});
