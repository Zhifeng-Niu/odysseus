/**
 * Invariants for src/tools/git.ts.
 *
 * GitTool is the structured git wrapper — five operations (commit, log,
 * status, rev-parse, diff) exposed as a single tool. Behavior tests
 * (tools-git.test.ts, 4 tests) cover the happy paths. This file pins
 * the structural contracts that the behavior tests imply but don't
 * make explicit:
 *
 *   1. GIT RESET IS INTENTIONALLY NOT EXPOSED. The description pins
 *      the rationale: "git reset is intentionally NOT exposed — the
 *      Cerebellum orchestrator owns rollback via the session-scoped
 *      rollbackTo primitive (design spec Section 6.1, zeroth law)."
 *      Exposing reset would let the agent bypass the orchestrator's
 *      safety perimeter.
 *
 *   2. OPERATIONS ARE A FIXED UNION: 'commit' | 'log' | 'status' |
 *      'rev-parse' | 'diff'. Adding or removing an operation is a
 *      breaking change that the enum in parameters must reflect.
 *
 *   3. ONLY 'commit' MUTATES. mutates(args) returns true iff operation
 *      === 'commit'. The orchestrator uses this to skip checkpoints
 *      for read-only ops (saves git tax on conversational turns).
 *
 *   4. ERROR ISOLATION: execute() never throws — the try/catch wraps
 *      every op. Errors surface as { ok: false, error }.
 *
 *   5. STRUCTURED ARG DEFAULTS:
 *      - log: limit default = 10
 *      - rev-parse: rev default = 'HEAD'
 *      - diff: target default = 'HEAD'
 *      - commit: message required, addAll optional
 *
 * Also pins:
 *   - Source uses execFileNoThrow (never child_process directly).
 *   - GitOperation enum matches parameters.operation.enum exactly.
 *   - "Nothing staged" detection via `git diff --cached --quiet` exit 0.
 *   - "Working tree clean" detection via status --porcelain output empty.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFileNoThrow } from '../../src/util/exec.js';
import { GitTool } from '../../src/tools/git.js';
import type { Tool, ToolResult } from '../../src/tools/types.js';

// ---------------------------------------------------------------------------
// Test helpers — temp git repo per test
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ody-git-inv-'));
  await execFileNoThrow('git', ['init'], { cwd: tempDir });
  await execFileNoThrow('git', ['config', 'user.email', 't@t.t'], { cwd: tempDir });
  await execFileNoThrow('git', ['config', 'user.name', 'T'], { cwd: tempDir });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function makeCommit(message: string): Promise<void> {
  await writeFile(join(tempDir, `f-${Date.now()}.txt`), 'content');
  await execFileNoThrow('git', ['add', '-A'], { cwd: tempDir });
  await execFileNoThrow('git', ['commit', '-m', message], { cwd: tempDir });
}

// ---------------------------------------------------------------------------
// Constants and operation union
// ---------------------------------------------------------------------------

describe('GitTool — operation union', () => {
  test('source defines GitOperation type with exactly 5 members', async () => {
    const src = await readFile('src/tools/git.ts', 'utf8');
    // The union members are load-bearing — adding/removing one must
    // be a deliberate decision.
    expect(src).toMatch(/type\s+GitOperation\s*=\s*['"]commit['"]\s*\|\s*['"]log['"]\s*\|\s*['"]status['"]\s*\|\s*['"]rev-parse['"]\s*\|\s*['"]diff['"]/);
  });

  test('parameters.operation.enum matches GitOperation union exactly', () => {
    const tool = new GitTool();
    const props = tool.parameters.properties as Record<string, { enum?: string[] }>;
    expect(props.operation!.enum).toEqual(
      expect.arrayContaining(['commit', 'log', 'status', 'rev-parse', 'diff']),
    );
    expect(props.operation!.enum).toHaveLength(5);
  });

  test("parameters.operation.enum does NOT include 'reset'", () => {
    const tool = new GitTool();
    const props = tool.parameters.properties as Record<string, { enum?: string[] }>;
    expect(props.operation!.enum).not.toContain('reset');
  });

  test("parameters.operation.enum does NOT include 'push' or 'pull'", () => {
    const tool = new GitTool();
    const props = tool.parameters.properties as Record<string, { enum?: string[] }>;
    // Network ops are intentionally not exposed — Odysseus never
    // pushes upstream on its own.
    expect(props.operation!.enum).not.toContain('push');
    expect(props.operation!.enum).not.toContain('pull');
  });
});

// ---------------------------------------------------------------------------
// GIT RESET INTENTIONALLY NOT EXPOSED — zeroth law
// ---------------------------------------------------------------------------

describe('GitTool — reset intentionally not exposed (zeroth law)', () => {
  test('description mentions that reset is intentionally not exposed', () => {
    const tool = new GitTool();
    // The LLM sees this description — knowing reset is off-limits
    // prevents it from even trying `git reset`.
    expect(tool.description.toLowerCase()).toContain('reset');
    expect(tool.description.toLowerCase()).toMatch(/not exposed|not available|intentionally/);
  });

  test('description references the orchestrator rollback primitive', () => {
    const tool = new GitTool();
    // Pin the rationale: rollback is owned by the orchestrator, not
    // the tool layer.
    expect(tool.description).toMatch(/orchestrator|rollback/i);
  });

  test("execute('reset', ...) returns ok:false with 'Unknown git operation'", async () => {
    const tool = new GitTool();
    const result = await tool.execute({ operation: 'reset' }, { cwd: tempDir });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Unknown git operation/);
      expect(result.error).toContain('reset');
    }
  });

  test("execute('push', ...) returns ok:false (not exposed)", async () => {
    const tool = new GitTool();
    const result = await tool.execute({ operation: 'push' }, { cwd: tempDir });
    expect(result.ok).toBe(false);
  });

  test("execute('pull', ...) returns ok:false (not exposed)", async () => {
    const tool = new GitTool();
    const result = await tool.execute({ operation: 'pull' }, { cwd: tempDir });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tool interface implementation
// ---------------------------------------------------------------------------

describe('GitTool — Tool interface', () => {
  test('name is "git"', () => {
    const tool = new GitTool();
    expect(tool.name).toBe('git');
  });

  test('name is readonly', async () => {
    const src = await readFile('src/tools/git.ts', 'utf8');
    expect(src).toMatch(/readonly\s+name\s*=\s*['"]git['"]/);
  });

  test('description is non-empty', () => {
    const tool = new GitTool();
    expect(tool.description.length).toBeGreaterThan(50);
  });

  test('parameters.required is ["operation"]', () => {
    const tool = new GitTool();
    expect(tool.parameters.required).toEqual(['operation']);
  });

  test('GitTool satisfies Tool interface', () => {
    const tool: Tool = new GitTool();
    expect(tool.name).toBe('git');
  });
});

// ---------------------------------------------------------------------------
// mutates() — only commit mutates
// ---------------------------------------------------------------------------

describe('GitTool — mutates() contract', () => {
  test('returns true for operation=commit', () => {
    const tool = new GitTool();
    expect(tool.mutates({ operation: 'commit' })).toBe(true);
  });

  test('returns false for operation=log', () => {
    const tool = new GitTool();
    expect(tool.mutates({ operation: 'log' })).toBe(false);
  });

  test('returns false for operation=status', () => {
    const tool = new GitTool();
    expect(tool.mutates({ operation: 'status' })).toBe(false);
  });

  test('returns false for operation=rev-parse', () => {
    const tool = new GitTool();
    expect(tool.mutates({ operation: 'rev-parse' })).toBe(false);
  });

  test('returns false for operation=diff', () => {
    const tool = new GitTool();
    expect(tool.mutates({ operation: 'diff' })).toBe(false);
  });

  test('returns false for unknown operation', () => {
    const tool = new GitTool();
    expect(tool.mutates({ operation: 'reset' })).toBe(false);
    expect(tool.mutates({ operation: 'unknown-op' })).toBe(false);
  });

  test('returns false when operation is missing', () => {
    const tool = new GitTool();
    expect(tool.mutates({})).toBe(false);
  });

  test('mutates is conservative-safe (only commit is true)', () => {
    const tool = new GitTool();
    // Pin the load-bearing contract: commit is the ONLY op that
    // mutates. If a future op is added that mutates, this test
    // forces the author to update the mutates() implementation.
    for (const op of ['log', 'status', 'rev-parse', 'diff']) {
      expect(tool.mutates({ operation: op })).toBe(false);
    }
    expect(tool.mutates({ operation: 'commit' })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error isolation — execute() never throws
// ---------------------------------------------------------------------------

describe('GitTool — error isolation', () => {
  test('unknown operation returns ok:false (does not throw)', async () => {
    const tool = new GitTool();
    const result = await tool.execute({ operation: 'unknown-xyz' }, { cwd: tempDir });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Unknown git operation');
      expect(result.error).toContain('unknown-xyz');
    }
  });

  test('missing operation returns ok:false', async () => {
    const tool = new GitTool();
    const result = await tool.execute({}, { cwd: tempDir });
    expect(result.ok).toBe(false);
  });

  test('ToolResult runtime shape on failure', async () => {
    const tool = new GitTool();
    const result: ToolResult = await tool.execute({ operation: 'bogus' }, { cwd: tempDir });
    expect(Object.keys(result).sort()).toEqual(['error', 'ok']);
  });

  test('execute is wrapped in try/catch (source-level)', async () => {
    const src = await readFile('src/tools/git.ts', 'utf8');
    // The try/catch in execute is load-bearing — without it, an
    // unexpected throw would crash the agent turn.
    expect(src).toMatch(/try\s*\{[\s\S]*?\}\s*catch\s*\(\s*err\s*\)\s*\{/);
  });
});

// ---------------------------------------------------------------------------
// commit — argument handling
// ---------------------------------------------------------------------------

describe('GitTool — commit argument handling', () => {
  test('empty message returns ok:false "commit message required"', async () => {
    const tool = new GitTool();
    const result = await tool.execute({ operation: 'commit', message: '' }, { cwd: tempDir });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('commit message required');
    }
  });

  test('missing message returns ok:false', async () => {
    const tool = new GitTool();
    const result = await tool.execute({ operation: 'commit' }, { cwd: tempDir });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('commit message required');
    }
  });

  test('commit with nothing staged returns ok:false "nothing staged to commit"', async () => {
    const tool = new GitTool();
    // Repo is freshly init'd — nothing staged.
    const result = await tool.execute(
      { operation: 'commit', message: 'test' },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('nothing staged to commit');
    }
  });

  test('commit with addAll=true stages and commits', async () => {
    await writeFile(join(tempDir, 'new-file.txt'), 'content');
    const tool = new GitTool();
    const result = await tool.execute(
      { operation: 'commit', message: 'addAll-test', addAll: true },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Returns the SHA of the new commit.
      expect(result.value).toMatch(/^[0-9a-f]{7,40}$/);
    }
  });

  test('commit returns SHA when successful', async () => {
    await writeFile(join(tempDir, 'f.txt'), 'content');
    await execFileNoThrow('git', ['add', '-A'], { cwd: tempDir });
    const tool = new GitTool();
    const result = await tool.execute(
      { operation: 'commit', message: 'sha-test' },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatch(/^[0-9a-f]{7,40}$/);
    }
  });

  test('source uses git diff --cached --quiet to detect nothing-staged', async () => {
    const src = await readFile('src/tools/git.ts', 'utf8');
    // The exit-code-0-on-empty-staging detection is load-bearing —
    // it prevents empty commits (the Iteration 19 commit-audit
    // finding that ~40% of waypoint commits were empty).
    // Args are passed as an array: ['diff', '--cached', '--quiet'].
    expect(src).toMatch(/\[\s*['"]diff['"]\s*,\s*['"]--cached['"]\s*,\s*['"]--quiet['"]\s*\]/);
  });
});

// ---------------------------------------------------------------------------
// log — limit default and clamping
// ---------------------------------------------------------------------------

describe('GitTool — log defaults', () => {
  test('log default limit is 10 when omitted', async () => {
    // Make 3 commits — should all show up under default limit=10.
    await makeCommit('c1');
    await makeCommit('c2');
    await makeCommit('c3');
    const tool = new GitTool();
    const result = await tool.execute({ operation: 'log' }, { cwd: tempDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const lines = result.value.trim().split('\n');
      expect(lines.length).toBe(3);
    }
  });

  test('log respects explicit limit', async () => {
    await makeCommit('c1');
    await makeCommit('c2');
    await makeCommit('c3');
    const tool = new GitTool();
    const result = await tool.execute(
      { operation: 'log', limit: 2 },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const lines = result.value.trim().split('\n');
      expect(lines.length).toBe(2);
    }
  });

  test('log clamps limit to at least 1', async () => {
    await makeCommit('c1');
    const tool = new GitTool();
    // Math.max(1, Math.floor(0)) = 1
    const result = await tool.execute(
      { operation: 'log', limit: 0 },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // At least 1 line returned.
      const lines = result.value.trim().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('log uses --pretty=format:%h %s', async () => {
    await makeCommit('pretty-test-message');
    const tool = new GitTool();
    const result = await tool.execute({ operation: 'log' }, { cwd: tempDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The pretty format includes short SHA + subject.
      expect(result.value).toMatch(/^[0-9a-f]{7}\spretty-test-message/);
    }
  });
});

// ---------------------------------------------------------------------------
// status — clean vs dirty
// ---------------------------------------------------------------------------

describe('GitTool — status detection', () => {
  test('clean tree returns "nothing to commit, working tree clean"', async () => {
    await makeCommit('clean-state');
    const tool = new GitTool();
    const result = await tool.execute({ operation: 'status' }, { cwd: tempDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('nothing to commit, working tree clean');
    }
  });

  test('dirty tree returns porcelain output', async () => {
    await makeCommit('baseline');
    await writeFile(join(tempDir, 'dirty.txt'), 'changes');
    const tool = new GitTool();
    const result = await tool.execute({ operation: 'status' }, { cwd: tempDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('dirty.txt');
    }
  });

  test('status uses --porcelain flag', async () => {
    const src = await readFile('src/tools/git.ts', 'utf8');
    expect(src).toMatch(/git.*status.*--porcelain/);
  });
});

// ---------------------------------------------------------------------------
// rev-parse — default HEAD
// ---------------------------------------------------------------------------

describe('GitTool — rev-parse defaults', () => {
  test('rev-parse default rev is HEAD', async () => {
    await makeCommit('head-test');
    const tool = new GitTool();
    const result = await tool.execute({ operation: 'rev-parse' }, { cwd: tempDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatch(/^[0-9a-f]{7,40}$/);
    }
  });

  test('rev-parse accepts explicit rev', async () => {
    await makeCommit('explicit');
    // Get the SHA via rev-parse HEAD, then rev-parse it back.
    const tool = new GitTool();
    const head = await tool.execute({ operation: 'rev-parse' }, { cwd: tempDir });
    if (head.ok) {
      const result = await tool.execute(
        { operation: 'rev-parse', rev: head.value },
        { cwd: tempDir },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(head.value);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// diff — default HEAD
// ---------------------------------------------------------------------------

describe('GitTool — diff defaults', () => {
  test('diff default target is HEAD', async () => {
    await makeCommit('diff-base');
    const tool = new GitTool();
    // No changes since commit — diff is empty but still succeeds.
    const result = await tool.execute({ operation: 'diff' }, { cwd: tempDir });
    expect(result.ok).toBe(true);
  });

  test('diff uses --stat flag', async () => {
    const src = await readFile('src/tools/git.ts', 'utf8');
    expect(src).toMatch(/git.*diff.*--stat/);
  });
});

// ---------------------------------------------------------------------------
// execFileNoThrow usage
// ---------------------------------------------------------------------------

describe('GitTool — uses execFileNoThrow', () => {
  test('source imports execFileNoThrow', async () => {
    const src = await readFile('src/tools/git.ts', 'utf8');
    expect(src).toMatch(/import\s*\{\s*execFileNoThrow\s*\}\s*from\s*['"]\.\.\/util\/exec\.js['"]/);
  });

  test('source does NOT import child_process directly', async () => {
    const src = await readFile('src/tools/git.ts', 'utf8');
    expect(src).not.toMatch(/from\s*['"]node:child_process['"]/);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('GitTool — determinism', () => {
  test('status called twice produces same output', async () => {
    await makeCommit('det');
    const tool = new GitTool();
    const a = await tool.execute({ operation: 'status' }, { cwd: tempDir });
    const b = await tool.execute({ operation: 'status' }, { cwd: tempDir });
    expect(a).toEqual(b);
  });

  test('rev-parse called twice produces same SHA', async () => {
    await makeCommit('det-rp');
    const tool = new GitTool();
    const a = await tool.execute({ operation: 'rev-parse' }, { cwd: tempDir });
    const b = await tool.execute({ operation: 'rev-parse' }, { cwd: tempDir });
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

describe('GitTool — module exports', () => {
  test('GitTool class is exported', async () => {
    const src = await readFile('src/tools/git.ts', 'utf8');
    expect(src).toMatch(/export\s+class\s+GitTool/);
  });

  test('source exports exactly GitTool (one class)', async () => {
    const src = await readFile('src/tools/git.ts', 'utf8');
    const classExports = src.match(/^export\s+class\s+(\w+)/gm) ?? [];
    expect(classExports.length).toBe(1);
  });
});
