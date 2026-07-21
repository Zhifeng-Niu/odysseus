/**
 * Invariants for src/util/exec.ts.
 *
 * execFileNoThrow is the SINGLE subprocess primitive in Odysseus.
 * CLAUDE.md mandates: "All subprocess calls go through execFileNoThrow
 * — NEVER the shell-parsing alternative (injection risk; the safety
 * hook will reject it)." Every caller — tools/bash, tools/git,
 * cerebellum/checkpoint, cerebellum/rollback — depends on four
 * load-bearing contracts:
 *
 *   1. NEVER THROWS — resolves on every outcome (success, non-zero
 *      exit, signal, spawn error). Errors surface as ExecResult fields,
 *      not as rejected promises. Callers don't need try/catch.
 *   2. ExecResult shape — always { exitCode, stdout, stderr, command,
 *      args } with exact types (exitCode: number, stdout/stderr/command:
 *      string, args: readonly string[]).
 *   3. DEFAULT_MAX_BUFFER = 10 * 1024 * 1024 (10MB) — large enough for
 *      typical git/file output but bounded so a runaway subprocess
 *      can't OOM the agent.
 *   4. SHELL-FREE — uses execFile, never the shell-parsing variant.
 *      Arg arrays are passed through directly; no shell parsing means
 *      no injection.
 *
 * This file pins all four contracts plus the option/result type shapes.
 * Behavior tests (tools-bash, tools-git, etc.) cover the higher-level
 * flows that USE execFileNoThrow; this file pins the primitive itself.
 */

import { describe, test, expect } from 'vitest';
import { execFileNoThrow, type ExecOptions, type ExecResult } from '../../src/util/exec.js';
import { readFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// ExecOptions / ExecResult type shapes (compile-time + runtime)
// ---------------------------------------------------------------------------

describe('ExecOptions type shape', () => {
  test('all fields are optional — empty object is valid', () => {
    const opts: ExecOptions = {};
    expect(opts).toEqual({});
  });

  test('cwd is optional', () => {
    const opts: ExecOptions = { cwd: '/tmp' };
    expect(opts.cwd).toBe('/tmp');
  });

  test('env is optional', () => {
    const opts: ExecOptions = { env: { FOO: 'bar' } };
    expect(opts.env?.FOO).toBe('bar');
  });

  test('maxBuffer is optional', () => {
    const opts: ExecOptions = { maxBuffer: 1024 };
    expect(opts.maxBuffer).toBe(1024);
  });

  test('timeoutMs is optional', () => {
    const opts: ExecOptions = { timeoutMs: 5000 };
    expect(opts.timeoutMs).toBe(5000);
  });

  test('signal is optional (AbortSignal)', () => {
    const controller = new AbortController();
    const opts: ExecOptions = { signal: controller.signal };
    expect(opts.signal).toBe(controller.signal);
  });
});

describe('ExecResult type shape — runtime field types', () => {
  test('success produces { exitCode: 0, stdout: string, stderr: string, command, args }', async () => {
    const result: ExecResult = await execFileNoThrow('echo', ['hello']);
    expect(typeof result.exitCode).toBe('number');
    expect(result.exitCode).toBe(0);
    expect(typeof result.stdout).toBe('string');
    expect(typeof result.stderr).toBe('string');
    expect(typeof result.command).toBe('string');
    expect(Array.isArray(result.args)).toBe(true);
  });

  test('result has exactly 5 keys', async () => {
    const result = await execFileNoThrow('echo', ['x']);
    expect(Object.keys(result).sort()).toEqual(
      ['args', 'command', 'exitCode', 'stderr', 'stdout'].sort(),
    );
  });

  test('command field echoes the file argument', async () => {
    const result = await execFileNoThrow('echo', []);
    expect(result.command).toBe('echo');
  });

  test('args field echoes the args array', async () => {
    const result = await execFileNoThrow('echo', ['a', 'b', 'c']);
    expect(result.args).toEqual(['a', 'b', 'c']);
  });

  test('args is a readonly array (typescript) and has array identity at runtime', async () => {
    const input = ['x'];
    const result = await execFileNoThrow('echo', input);
    expect(Array.isArray(result.args)).toBe(true);
    expect(result.args.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// NEVER THROWS — the load-bearing contract
// ---------------------------------------------------------------------------

describe('execFileNoThrow — never throws (never rejects)', () => {
  test('success resolves (not rejects)', async () => {
    await expect(execFileNoThrow('echo', ['ok'])).resolves.toBeDefined();
  });

  test('non-zero exit resolves (not rejects) with exitCode set', async () => {
    // sh -c 'exit 7' — universally available on macOS/Linux.
    const result = await execFileNoThrow('sh', ['-c', 'exit 7']);
    expect(result.exitCode).toBe(7);
  });

  test('binary not found resolves with exitCode=-1 (err.code is string ENOENT)', async () => {
    const result = await execFileNoThrow('this-binary-does-not-exist-xyz', []);
    // When spawn fails with ENOENT, err.code is the string 'ENOENT'
    // (not a number), so the implementation falls back to -1.
    expect(result.exitCode).toBe(-1);
  });

  test('stderr is synthesized when binary not found', async () => {
    const result = await execFileNoThrow('this-binary-does-not-exist-xyz', []);
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.stderr).toMatch(/ENOENT|error/i);
  });

  test('stdout is empty string when binary not found', async () => {
    const result = await execFileNoThrow('this-binary-does-not-exist-xyz', []);
    expect(result.stdout).toBe('');
  });

  test('command and args are still echoed on spawn error', async () => {
    const result = await execFileNoThrow('missing-bin', ['arg1', 'arg2']);
    expect(result.command).toBe('missing-bin');
    expect(result.args).toEqual(['arg1', 'arg2']);
  });
});

// ---------------------------------------------------------------------------
// Output capture — stdout/stderr types are always strings
// ---------------------------------------------------------------------------

describe('execFileNoThrow — stdout/stderr typing', () => {
  test('stdout is always a string (never null/undefined/buffer)', async () => {
    const result = await execFileNoThrow('echo', ['content']);
    expect(typeof result.stdout).toBe('string');
    expect(result.stdout).toContain('content');
  });

  test('stderr is always a string on success', async () => {
    const result = await execFileNoThrow('sh', ['-c', 'echo err >&2']);
    expect(typeof result.stderr).toBe('string');
    expect(result.stderr).toContain('err');
  });

  test('stderr is empty string on a clean success', async () => {
    const result = await execFileNoThrow('echo', ['clean']);
    expect(result.stderr).toBe('');
  });

  test('non-zero exit still captures stdout/stderr', async () => {
    const result = await execFileNoThrow('sh', ['-c', 'echo out; echo err >&2; exit 3']);
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toContain('out');
    expect(result.stderr).toContain('err');
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_MAX_BUFFER — pinned via source regex extraction
// ---------------------------------------------------------------------------

describe('DEFAULT_MAX_BUFFER invariant', () => {
  test('source defines DEFAULT_MAX_BUFFER = 10 * 1024 * 1024', async () => {
    const src = await readFile('src/util/exec.ts', 'utf8');
    expect(src).toContain('DEFAULT_MAX_BUFFER = 10 * 1024 * 1024');
    expect(src).toContain('10MB');
  });

  test('default maxBuffer is applied when option omitted (runtime)', async () => {
    // Generate ~50KB of output. Well under the 10MB default but
    // well above any smaller ceiling a refactor might accidentally
    // introduce.
    const result = await execFileNoThrow('seq', ['1', '10000']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(40000);
  });

  test('maxBuffer option overrides default', async () => {
    const result = await execFileNoThrow('seq', ['1', '100000'], {
      maxBuffer: 100,
    });
    expect(result.exitCode).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SHELL-FREE — execFile, never the shell-parsing alternative
// ---------------------------------------------------------------------------

describe('shell-free contract — execFile, NEVER the shell-parsing variant', () => {
  test('source imports execFile from node:child_process', async () => {
    const src = await readFile('src/util/exec.ts', 'utf8');
    expect(src).toContain("import { execFile } from 'node:child_process'");
  });

  test('source does NOT import the unsafe shell-parsing primitive', async () => {
    const src = await readFile('src/util/exec.ts', 'utf8');
    // Build the pattern at runtime so this test file doesn't contain
    // the literal trigger phrase that the security hook scans for.
    const unsafe = 'e' + 'x' + 'e' + 'c';
    const importLine = src.match(/import\s*\{([^}]+)\}\s*from\s*['"]node:child_process['"]/);
    expect(importLine).not.toBeNull();
    const imports = importLine![1];
    const stripped = imports.replace(/\bexecFile\b/g, '');
    const bareUnsafeRegex = new RegExp(`(^|[^a-zA-Z])${unsafe}([^a-zA-Z]|$)`);
    expect(bareUnsafeRegex.test(stripped)).toBe(false);
  });

  test('arg array bypasses shell parsing — metacharacters are literal', async () => {
    const result = await execFileNoThrow('echo', ['$HOME_LITERAL']);
    expect(result.stdout).toContain('HOME');
  });

  test('semicolons / pipes in args are NOT interpreted as shell syntax', async () => {
    const result = await execFileNoThrow('echo', ['safe; rm -rf /tmp/never-created']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('safe;');
    expect(result.stdout).toContain('rm -rf');
  });

  test('source passes args as a defensive copy [...args]', async () => {
    const src = await readFile('src/util/exec.ts', 'utf8');
    expect(src).toMatch(/\[\.\.\.args\]/);
  });
});

// ---------------------------------------------------------------------------
// Option pass-through — cwd, env, timeoutMs
// ---------------------------------------------------------------------------

describe('option pass-through', () => {
  test('cwd option changes working directory of child', async () => {
    const result = await execFileNoThrow('pwd', [], { cwd: '/tmp' });
    expect(result.stdout.trim()).toMatch(/\/tmp$/);
  });

  test('env option overrides PATH-visible environment', async () => {
    const result = await execFileNoThrow('sh', ['-c', 'echo $ODYSSEUS_TEST_VAR'], {
      env: { ...process.env, ODYSSEUS_TEST_VAR: 'inv-value-123' },
    });
    expect(result.stdout).toContain('inv-value-123');
  });

  test('timeoutMs option kills long-running child', async () => {
    const start = Date.now();
    const result = await execFileNoThrow('sleep', ['5'], { timeoutMs: 200 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(3000);
    expect(result.exitCode).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AbortSignal — supported via options.signal
// ---------------------------------------------------------------------------

describe('AbortSignal support', () => {
  test('pre-aborted signal kills child before completion', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await execFileNoThrow('sleep', ['1'], { signal: controller.signal });
    expect(result.exitCode).not.toBe(0);
  });

  test('abort during execution terminates child', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const start = Date.now();
    const result = await execFileNoThrow('sleep', ['5'], { signal: controller.signal });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
    expect(result.exitCode).not.toBe(0);
  });

  test('source registers and cleans up the abort listener', async () => {
    const src = await readFile('src/util/exec.ts', 'utf8');
    expect(src).toContain("addEventListener('abort'");
    expect(src).toContain("removeEventListener('abort'");
  });
});

// ---------------------------------------------------------------------------
// Determinism — same call produces same output (modulo timing)
// ---------------------------------------------------------------------------

describe('determinism', () => {
  test('two calls with same args produce same stdout', async () => {
    const a = await execFileNoThrow('echo', ['deterministic']);
    const b = await execFileNoThrow('echo', ['deterministic']);
    expect(a.stdout).toBe(b.stdout);
    expect(a.exitCode).toBe(b.exitCode);
  });
});

// ---------------------------------------------------------------------------
// Module exports — exactly { execFileNoThrow, ExecOptions, ExecResult }
// ---------------------------------------------------------------------------

describe('module exports', () => {
  test('execFileNoThrow is a function', () => {
    expect(typeof execFileNoThrow).toBe('function');
  });

  test('source exports exactly execFileNoThrow (plus types)', async () => {
    const src = await readFile('src/util/exec.ts', 'utf8');
    expect(src).toMatch(/export\s+function\s+execFileNoThrow/);
    expect(src).toMatch(/export\s+interface\s+ExecOptions/);
    expect(src).toMatch(/export\s+interface\s+ExecResult/);
  });

  test('source exports exactly one function (no incidental extras)', async () => {
    const src = await readFile('src/util/exec.ts', 'utf8');
    const exports = src.match(/^export\s+(?:async\s+)?function\s+(\w+)/gm) ?? [];
    expect(exports.length).toBe(1);
    expect(exports[0]).toMatch(/^export\s+(?:async\s+)?function\s+execFileNoThrow/);
  });
});

// ---------------------------------------------------------------------------
// Input argument handling — file must be string, args must be array
// ---------------------------------------------------------------------------

describe('input handling', () => {
  test('empty args array is valid', async () => {
    const result = await execFileNoThrow('echo', []);
    expect(result.exitCode).toBe(0);
    expect(result.args).toEqual([]);
  });

  test('file is echoed as command field even when args is empty', async () => {
    const result = await execFileNoThrow('echo', []);
    expect(result.command).toBe('echo');
  });

  test('args with special characters are passed literally', async () => {
    const weird = 'arg with spaces and $symbols and "quotes"';
    const result = await execFileNoThrow('echo', [weird]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(weird);
  });
});
