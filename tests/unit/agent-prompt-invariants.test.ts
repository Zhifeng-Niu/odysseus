import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';

import { buildSystemPrompt, type PromptInput } from '../../src/agent/prompt.js';

// ---------------------------------------------------------------------------
// Source contract — agent/prompt.ts
//
// buildSystemPrompt is a PURE FUNCTION that renders a mission + tool list
// into a fixed-format system prompt for the agent.
//
// Invariants pinned here:
//   - Pure: no side effects, no I/O, no globals
//   - Output always contains the mission string verbatim
//   - Output always lists tools in input order, comma-separated
//   - Empty tool list produces "Available tools: " (with empty join)
//   - Identity words: "Odysseus", "Cerebellum", "DONE" — these are part of
//     the agent's self-model and MUST NOT drift without an explicit review
//   - Template literals used (no string concatenation churn)
// ---------------------------------------------------------------------------

describe('agent/prompt — module exports', () => {
  test('exports PromptInput interface and buildSystemPrompt function', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    expect(src).toMatch(/^export\s+interface\s+PromptInput/m);
    expect(src).toMatch(/^export\s+function\s+buildSystemPrompt/m);
  });

  test('no other exports', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    const exports = src.match(/^export\s+(class|interface|type|function|const|enum)\s+\w+/gm) ?? [];
    expect(exports.length).toBe(2);
  });

  test('no imports at all (fully self-contained)', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    expect(src).not.toMatch(/^import\s/m);
  });
});

// ---------------------------------------------------------------------------
// PromptInput — shape
// ---------------------------------------------------------------------------

describe('PromptInput — shape', () => {
  test('mission: string (required)', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    expect(src).toMatch(/mission:\s*string/);
  });

  test('availableTools: readonly string[] (required, readonly)', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    expect(src).toMatch(/availableTools:\s*readonly\s+string\[\]/);
  });

  test('has exactly 2 fields, both required', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    const match = src.match(/interface\s+PromptInput\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    // Both required: no `?` after field name
    const required = match![1].match(/^\s+\w+:\s+/gm) ?? [];
    const optional = match![1].match(/^\s+\w+\?\s*:/gm) ?? [];
    expect(required.length).toBe(2);
    expect(optional.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt — basic behavior
// ---------------------------------------------------------------------------

describe('buildSystemPrompt — output structure', () => {
  test('mentions the mission verbatim', () => {
    const prompt = buildSystemPrompt({ mission: 'fix-bug-123', availableTools: [] });
    expect(prompt).toContain('fix-bug-123');
  });

  test('mentions "Your mission:" label', () => {
    const prompt = buildSystemPrompt({ mission: 'x', availableTools: [] });
    expect(prompt).toContain('Your mission:');
  });

  test('includes identity line "You are Odysseus"', () => {
    const prompt = buildSystemPrompt({ mission: 'x', availableTools: [] });
    expect(prompt).toContain('You are Odysseus');
  });

  test('mentions Cerebellum loop', () => {
    const prompt = buildSystemPrompt({ mission: 'x', availableTools: [] });
    expect(prompt).toMatch(/Cerebellum\s+loop/);
  });

  test('includes "DONE" as the success signal', () => {
    const prompt = buildSystemPrompt({ mission: 'x', availableTools: [] });
    expect(prompt).toMatch(/\bDONE\b/);
  });

  test('includes "Available tools:" label', () => {
    const prompt = buildSystemPrompt({ mission: 'x', availableTools: ['read_file'] });
    expect(prompt).toContain('Available tools:');
  });

  test('return type is string', () => {
    const result = buildSystemPrompt({ mission: 'x', availableTools: [] });
    expect(typeof result).toBe('string');
  });

  test('output is multi-line (at least 5 lines)', () => {
    const prompt = buildSystemPrompt({ mission: 'x', availableTools: [] });
    expect(prompt.split('\n').length).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Tool list rendering
// ---------------------------------------------------------------------------

describe('buildSystemPrompt — tool list rendering', () => {
  test('single tool is rendered', () => {
    const prompt = buildSystemPrompt({ mission: 'm', availableTools: ['read_file'] });
    expect(prompt).toContain('read_file');
  });

  test('multiple tools are comma-separated', () => {
    const prompt = buildSystemPrompt({
      mission: 'm',
      availableTools: ['read_file', 'write_file', 'bash'],
    });
    expect(prompt).toContain('read_file, write_file, bash');
  });

  test('tool order is preserved', () => {
    const prompt = buildSystemPrompt({
      mission: 'm',
      availableTools: ['zebra', 'alpha', 'mid'],
    });
    const idxZ = prompt.indexOf('zebra');
    const idxA = prompt.indexOf('alpha');
    const idxM = prompt.indexOf('mid');
    expect(idxZ).toBeLessThan(idxA);
    expect(idxA).toBeLessThan(idxM);
  });

  test('empty tool list produces "Available tools: " followed by nothing', () => {
    const prompt = buildSystemPrompt({ mission: 'm', availableTools: [] });
    expect(prompt).toMatch(/Available tools:\s*\n/);
  });

  test('readonly array is accepted (not just mutable)', () => {
    const tools: readonly string[] = Object.freeze(['a', 'b']);
    const prompt = buildSystemPrompt({ mission: 'm', availableTools: tools });
    expect(prompt).toContain('a, b');
  });

  test('duplicate tools are NOT deduplicated (rendered as-is)', () => {
    const prompt = buildSystemPrompt({
      mission: 'm',
      availableTools: ['read_file', 'read_file'],
    });
    expect(prompt).toContain('read_file, read_file');
  });

  test('tools with special characters are rendered verbatim', () => {
    const prompt = buildSystemPrompt({
      mission: 'm',
      availableTools: ['tool-with-dashes', 'tool_with_underscores'],
    });
    expect(prompt).toContain('tool-with-dashes, tool_with_underscores');
  });

  test('source uses Array.prototype.join with ", "', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    expect(src).toMatch(/\.join\(',\s*'\)/);
  });
});

// ---------------------------------------------------------------------------
// Purity — same inputs always produce same output
// ---------------------------------------------------------------------------

describe('buildSystemPrompt — purity and determinism', () => {
  test('same inputs produce identical outputs (referential transparency)', () => {
    const input: PromptInput = { mission: 'm', availableTools: ['a', 'b'] };
    const a = buildSystemPrompt(input);
    const b = buildSystemPrompt(input);
    expect(a).toBe(b);
  });

  test('different missions produce different prompts', () => {
    const a = buildSystemPrompt({ mission: 'one', availableTools: [] });
    const b = buildSystemPrompt({ mission: 'two', availableTools: [] });
    expect(a).not.toBe(b);
  });

  test('different tool lists produce different prompts', () => {
    const a = buildSystemPrompt({ mission: 'm', availableTools: ['a'] });
    const b = buildSystemPrompt({ mission: 'm', availableTools: ['b'] });
    expect(a).not.toBe(b);
  });

  test('does not mutate input array', () => {
    const tools = ['a', 'b', 'c'];
    const toolsSnapshot = [...tools];
    buildSystemPrompt({ mission: 'm', availableTools: tools });
    expect(tools).toEqual(toolsSnapshot);
  });

  test('function has no closure state (returns same output for same input)', () => {
    const r1 = buildSystemPrompt({ mission: 'm', availableTools: ['x'] });
    const r2 = buildSystemPrompt({ mission: 'other', availableTools: ['y'] });
    const r3 = buildSystemPrompt({ mission: 'm', availableTools: ['x'] });
    expect(r1).toBe(r3);
    expect(r1).not.toBe(r2);
  });
});

// ---------------------------------------------------------------------------
// Mission embedding — edge cases
// ---------------------------------------------------------------------------

describe('buildSystemPrompt — mission embedding', () => {
  test('empty mission is rendered (no crash)', () => {
    const prompt = buildSystemPrompt({ mission: '', availableTools: [] });
    expect(prompt).toMatch(/Your mission:\s*\n/);
  });

  test('mission with newlines is embedded verbatim', () => {
    const prompt = buildSystemPrompt({ mission: 'line1\nline2', availableTools: [] });
    expect(prompt).toContain('line1\nline2');
  });

  test('mission with special regex characters does not break', () => {
    const prompt = buildSystemPrompt({
      mission: 'task [v1.0] (urgent)',
      availableTools: [],
    });
    expect(prompt).toContain('task [v1.0] (urgent)');
  });

  test('unicode mission is preserved', () => {
    const prompt = buildSystemPrompt({ mission: '探索深空', availableTools: [] });
    expect(prompt).toContain('探索深空');
  });
});

// ---------------------------------------------------------------------------
// Source-level safety — no side effects
// ---------------------------------------------------------------------------

describe('agent/prompt — source-level safety', () => {
  test('no console, no process, no I/O', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    expect(src).not.toMatch(/console\./);
    expect(src).not.toMatch(/process\./);
    expect(src).not.toMatch(/fetch\(/);
    expect(src).not.toMatch(/require\(/);
  });

  test('no dynamic behavior — Date.now, Math.random, etc.', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    expect(src).not.toMatch(/Date\./);
    expect(src).not.toMatch(/Math\.random/);
    expect(src).not.toMatch(/setTimeout/);
  });

  test('no default export', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    expect(src).not.toMatch(/^export\s+default\s/m);
  });

  test('no static or class members (pure function module)', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    expect(src).not.toMatch(/\bstatic\s+\w+/);
    expect(src).not.toMatch(/\bclass\s+\w+/);
  });

  test('template literal interpolation uses only input.mission and input.availableTools', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    // Count ${...} interpolations in the template literal
    const interpolations = src.match(/\$\{[^}]+\}/g) ?? [];
    expect(interpolations.length).toBe(2);
    expect(interpolations.some((i) => i.includes('input.mission'))).toBe(true);
    expect(interpolations.some((i) => i.includes('input.availableTools'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Structural fingerprint
// ---------------------------------------------------------------------------

describe('agent/prompt — structural fingerprint', () => {
  test('file has exactly 1 function declaration', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    const fns = src.match(/^export\s+function\s+\w+/gm) ?? [];
    expect(fns.length).toBe(1);
  });

  test('file has exactly 1 interface declaration', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    const ifaces = src.match(/^export\s+interface\s+\w+/gm) ?? [];
    expect(ifaces.length).toBe(1);
  });

  test('function body uses template literal (backticks)', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    expect(src).toMatch(/return\s*`/);
  });

  test('function is the only statement at module top-level (besides interface)', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    const topLevel = src.match(/^(export\s+(function|interface|class|const|type|enum)\s+\w+)/gm) ?? [];
    expect(topLevel.length).toBe(2);
  });

  test('file is under 25 lines (compact prompt template)', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    const lines = src.split('\n');
    expect(lines.length).toBeLessThanOrEqual(25);
  });
});
