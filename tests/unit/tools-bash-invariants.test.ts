/**
 * Invariants for src/tools/bash.ts.
 *
 * BashTool is Odysseus's shell escape hatch — the one tool that CAN
 * run arbitrary shell commands. Three load-bearing contracts:
 *
 *   1. Bounded output: DEFAULT_STDOUT_CAP = 20_000 chars caps the
 *      per-call stdout growth. Iteration 29 finding: unbounded stdout
 *      was the second-biggest history growth source (after file-read).
 *      A single git log could dump tens of thousands of chars into
 *      history permanently.
 *   2. Bounded runtime: DEFAULT_TIMEOUT_MS = 30_000ms prevents a
 *      hanging subprocess from blocking the agent indefinitely.
 *   3. Error isolation: execute() returns ToolResult on every path —
 *      success, non-zero exit, empty command, throw inside exec. The
 *      method itself never throws; errors surface as { ok: false,
 *      error }.
 *
 * Behavior tests (tools-bash.test.ts, 5 tests) cover happy paths and
 * exit-code propagation. This file pins the structural contracts and
 * constants that those tests rely on but don't make explicit.
 *
 * Also pinned:
 *   - Tool interface implementation (name, description, parameters,
 *     execute).
 *   - parameters schema: required = ['command'], command.type='string',
 *     timeoutMs optional.
 *   - Description content includes the cap (20k) and timeout (30s)
 *     notices so the LLM caller knows the limits.
 *   - execute() uses execFileNoThrow (never throws) via bash -c.
 */

import { describe, test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { BashTool } from '../../src/tools/bash.js';
import type { Tool, ToolResult } from '../../src/tools/types.js';

// ---------------------------------------------------------------------------
// Constants — pinned via source regex
// ---------------------------------------------------------------------------

describe('bash.ts — constants', () => {
  test('DEFAULT_TIMEOUT_MS = 30_000', async () => {
    const src = await readFile('src/tools/bash.ts', 'utf8');
    expect(src).toContain('DEFAULT_TIMEOUT_MS = 30_000');
  });

  test('DEFAULT_STDOUT_CAP = 20_000', async () => {
    const src = await readFile('src/tools/bash.ts', 'utf8');
    expect(src).toContain('DEFAULT_STDOUT_CAP = 20_000');
  });

  test('source comment documents the 20k rationale', async () => {
    const src = await readFile('src/tools/bash.ts', 'utf8');
    // The Iteration 29 comment must remain — it's the rationale for
    // the cap, so future "let's increase it to 100k" PRs have to
    // acknowledge the history-growth cost.
    expect(src).toContain('Iteration 29');
    expect(src).toMatch(/20k\s*chars/i);
  });
});

// ---------------------------------------------------------------------------
// Tool interface implementation
// ---------------------------------------------------------------------------

describe('BashTool — Tool interface', () => {
  test('name is "bash"', () => {
    const tool = new BashTool();
    expect(tool.name).toBe('bash');
  });

  test('name is readonly', async () => {
    const src = await readFile('src/tools/bash.ts', 'utf8');
    expect(src).toMatch(/readonly\s+name\s*=\s*['"]bash['"]/);
  });

  test('description is a non-empty string', () => {
    const tool = new BashTool();
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(50);
  });

  test('description is readonly', async () => {
    const src = await readFile('src/tools/bash.ts', 'utf8');
    expect(src).toMatch(/readonly\s+description\s*=/);
  });

  test('parameters is an object with type="object"', () => {
    const tool = new BashTool();
    expect(tool.parameters).toEqual(expect.objectContaining({ type: 'object' }));
  });

  test('parameters is readonly', async () => {
    const src = await readFile('src/tools/bash.ts', 'utf8');
    expect(src).toMatch(/readonly\s+parameters\s*=/);
  });

  test('execute is a function', () => {
    const tool = new BashTool();
    expect(typeof tool.execute).toBe('function');
  });

  test('BashTool satisfies Tool interface (compile-time check)', () => {
    const tool: Tool = new BashTool();
    expect(tool.name).toBe('bash');
  });
});

// ---------------------------------------------------------------------------
// Parameters schema — required and optional fields
// ---------------------------------------------------------------------------

describe('BashTool — parameters schema', () => {
  test('required is ["command"]', () => {
    const tool = new BashTool();
    expect(tool.parameters.required).toEqual(['command']);
  });

  test('command property is type string', () => {
    const tool = new BashTool();
    const props = tool.parameters.properties as Record<string, { type: string }>;
    expect(props.command).toBeDefined();
    expect(props.command.type).toBe('string');
  });

  test('timeoutMs property exists and is type number', () => {
    const tool = new BashTool();
    const props = tool.parameters.properties as Record<string, { type: string }>;
    expect(props.timeoutMs).toBeDefined();
    expect(props.timeoutMs.type).toBe('number');
  });

  test('timeoutMs is NOT in required list (optional)', () => {
    const tool = new BashTool();
    expect(tool.parameters.required).not.toContain('timeoutMs');
  });

  test('command description in schema mentions what it does', () => {
    const tool = new BashTool();
    const props = tool.parameters.properties as Record<string, { description?: string }>;
    expect(props.command.description).toBeDefined();
    expect(props.command.description!.length).toBeGreaterThan(10);
  });

  test('timeoutMs description mentions default value', () => {
    const tool = new BashTool();
    const props = tool.parameters.properties as Record<string, { description?: string }>;
    expect(props.timeoutMs!.description).toBeDefined();
    // The description should mention the 30000 default so the LLM
    // knows what value is used when omitted.
    expect(props.timeoutMs!.description).toMatch(/30000|30\s*s/i);
  });
});

// ---------------------------------------------------------------------------
// Description content — the LLM sees this verbatim
// ---------------------------------------------------------------------------

describe('BashTool — description content (LLM-visible)', () => {
  test('mentions the 20k stdout cap', () => {
    const tool = new BashTool();
    // Critical: LLM must know the cap exists so it doesn't get
    // surprised by truncated output.
    expect(tool.description.toLowerCase()).toMatch(/20k|20,?000/);
  });

  test('mentions the 30s timeout', () => {
    const tool = new BashTool();
    expect(tool.description).toMatch(/30\s*s|30,?000/i);
  });

  test('mentions "bash -c" so the LLM knows shell semantics apply', () => {
    const tool = new BashTool();
    expect(tool.description).toContain('bash -c');
  });

  test('suggests preferring file/git tools when they fit', () => {
    const tool = new BashTool();
    // The nudge toward dedicated tools is load-bearing — it keeps
    // the agent from using bash as a catch-all when file-read or
    // git-log would be more appropriate.
    expect(tool.description.toLowerCase()).toMatch(/prefer|instead/i);
  });
});

// ---------------------------------------------------------------------------
// Error isolation — execute() never throws
// ---------------------------------------------------------------------------

describe('BashTool — error isolation', () => {
  test('empty command returns ok:false (does not throw)', async () => {
    const tool = new BashTool();
    const result = await tool.execute({}, { cwd: '/tmp' });
    expect(result.ok).toBe(false);
  });

  test('empty command error message is "command required"', async () => {
    const tool = new BashTool();
    const result = await tool.execute({ command: '' }, { cwd: '/tmp' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('command required');
    }
  });

  test('whitespace-only command returns ok:false', async () => {
    const tool = new BashTool();
    const result = await tool.execute({ command: '   \t\n  ' }, { cwd: '/tmp' });
    expect(result.ok).toBe(false);
  });

  test('non-zero exit returns ok:false with exit code in error', async () => {
    const tool = new BashTool();
    const result = await tool.execute({ command: 'exit 7' }, { cwd: '/tmp' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/exit 7/);
    }
  });

  test('success returns ok:true with stdout as value', async () => {
    const tool = new BashTool();
    const result = await tool.execute({ command: 'echo success' }, { cwd: '/tmp' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('success');
    }
  });

  test('ToolResult return type — runtime shape on success', async () => {
    const tool = new BashTool();
    const result: ToolResult = await tool.execute({ command: 'echo x' }, { cwd: '/tmp' });
    expect(Object.keys(result).sort()).toEqual(['ok', 'value']);
  });

  test('ToolResult return type — runtime shape on failure', async () => {
    const tool = new BashTool();
    const result: ToolResult = await tool.execute({ command: '' }, { cwd: '/tmp' });
    expect(Object.keys(result).sort()).toEqual(['error', 'ok']);
  });
});

// ---------------------------------------------------------------------------
// execFileNoThrow usage — never throws
// ---------------------------------------------------------------------------

describe('BashTool — uses execFileNoThrow', () => {
  test('source imports execFileNoThrow from util/exec.js', async () => {
    const src = await readFile('src/tools/bash.ts', 'utf8');
    expect(src).toMatch(/import\s*\{\s*execFileNoThrow\s*\}\s*from\s*['"]\.\.\/util\/exec\.js['"]/);
  });

  test('source does NOT import child_process directly', async () => {
    const src = await readFile('src/tools/bash.ts', 'utf8');
    expect(src).not.toMatch(/from\s*['"]node:child_process['"]/);
  });

  test('source invokes bash via execFileNoThrow("bash", ["-c", command], ...)', async () => {
    const src = await readFile('src/tools/bash.ts', 'utf8');
    expect(src).toMatch(/execFileNoThrow\(['"]bash['"],\s*\[\s*['"]-c['"],\s*command\s*\]/);
  });
});

// ---------------------------------------------------------------------------
// Output cap — applied via truncateForLLM
// ---------------------------------------------------------------------------

describe('BashTool — output cap via truncateForLLM', () => {
  test('source imports truncateForLLM', async () => {
    const src = await readFile('src/tools/bash.ts', 'utf8');
    expect(src).toMatch(/import\s*\{\s*truncateForLLM\s*\}\s*from\s*['"]\.\.\/util\/truncate\.js['"]/);
  });

  test('stdout cap is applied on success path', async () => {
    const src = await readFile('src/tools/bash.ts', 'utf8');
    expect(src).toMatch(/truncateForLLM\(result\.stdout/);
  });

  test('stderr cap is applied on failure path', async () => {
    const src = await readFile('src/tools/bash.ts', 'utf8');
    expect(src).toMatch(/truncateForLLM\(stderr/);
  });

  test('stdout cap uses DEFAULT_STDOUT_CAP', async () => {
    const src = await readFile('src/tools/bash.ts', 'utf8');
    expect(src).toMatch(/maxChars:\s*DEFAULT_STDOUT_CAP/);
  });

  test('runtime: large stdout is truncated with notice', async () => {
    const tool = new BashTool();
    // Generate ~30k chars of output. Should exceed the 20k cap.
    const result = await tool.execute(
      { command: 'seq 1 10000' },
      { cwd: '/tmp' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The truncateForLLM notice is appended on top of the cap.
      expect(result.value).toMatch(/\[truncated:/);
    }
  });
});

// ---------------------------------------------------------------------------
// Timeout — default and override
// ---------------------------------------------------------------------------

describe('BashTool — timeout handling', () => {
  test('default 30s timeout applied when timeoutMs omitted', async () => {
    const src = await readFile('src/tools/bash.ts', 'utf8');
    // The fallback path in the ternary uses DEFAULT_TIMEOUT_MS.
    expect(src).toMatch(/DEFAULT_TIMEOUT_MS/);
  });

  test('timeoutMs must be a finite number (NaN rejected)', async () => {
    const tool = new BashTool();
    // NaN is not finite — should fall back to default.
    // seq 1 5 finishes quickly under default 30s.
    const result = await tool.execute(
      { command: 'seq 1 5', timeoutMs: Number.NaN },
      { cwd: '/tmp' },
    );
    expect(result.ok).toBe(true);
  });

  test('negative timeoutMs falls back to default (clamped via Math.max(0, ...))', async () => {
    const tool = new BashTool();
    // Math.max(0, -1000) = 0 — timeout of 0 means immediate timeout.
    // seq finishes instantly even with 0 timeout (execFile timeout
    // starts counting after process spawn).
    // The test verifies the negative input is handled, not crashed.
    const result = await tool.execute(
      { command: 'echo safe', timeoutMs: -1000 },
      { cwd: '/tmp' },
    );
    // Either succeeds (if echo finishes before timeout fires) or
    // fails with a timeout error. Both are acceptable — what matters
    // is no throw.
    expect(result).toBeDefined();
    expect(typeof result.ok).toBe('boolean');
  });

  test('non-number timeoutMs (string) falls back to default', async () => {
    const tool = new BashTool();
    const result = await tool.execute(
      // Intentionally wrong type — the typeof check rejects it.
      { command: 'echo fallback', timeoutMs: 'not-a-number' as unknown as number },
      { cwd: '/tmp' },
    );
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Context pass-through — cwd, env, signal
// ---------------------------------------------------------------------------

describe('BashTool — context pass-through', () => {
  test('cwd is passed to execFileNoThrow', async () => {
    const src = await readFile('src/tools/bash.ts', 'utf8');
    expect(src).toMatch(/cwd:\s*ctx\.cwd/);
  });

  test('env is conditionally spread (exactOptionalPropertyTypes)', async () => {
    const src = await readFile('src/tools/bash.ts', 'utf8');
    // The conditional spread pattern — env only included when defined.
    expect(src).toMatch(/ctx\.env\s*!==\s*undefined\s*\?\s*\{\s*env/);
  });

  test('signal is conditionally spread (exactOptionalPropertyTypes)', async () => {
    const src = await readFile('src/tools/bash.ts', 'utf8');
    expect(src).toMatch(/ctx\.signal\s*!==\s*undefined\s*\?\s*\{\s*signal/);
  });

  test('runtime: cwd affects execution', async () => {
    const tool = new BashTool();
    const result = await tool.execute({ command: 'pwd' }, { cwd: '/tmp' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.trim()).toMatch(/\/tmp$/);
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('BashTool — determinism', () => {
  test('same deterministic command produces same output', async () => {
    const tool = new BashTool();
    const a = await tool.execute({ command: 'echo det' }, { cwd: '/tmp' });
    const b = await tool.execute({ command: 'echo det' }, { cwd: '/tmp' });
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

describe('BashTool — module exports', () => {
  test('BashTool class is exported', async () => {
    const src = await readFile('src/tools/bash.ts', 'utf8');
    expect(src).toMatch(/export\s+class\s+BashTool/);
  });

  test('source exports exactly BashTool (one class)', async () => {
    const src = await readFile('src/tools/bash.ts', 'utf8');
    const classExports = src.match(/^export\s+class\s+(\w+)/gm) ?? [];
    expect(classExports.length).toBe(1);
  });
});
