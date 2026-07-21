/**
 * Invariants for src/util/truncate.ts.
 *
 * truncateForLLM is the single chokepoint that bounds tool-result growth
 * before it enters LLM conversation history. Three callers depend on its
 * contract:
 *   - src/tools/bash.ts (DEFAULT_STDOUT_CAP = 20_000)
 *   - src/tools/file.ts (DEFAULT_CHAR_CAP = 20_000)
 *   - any future tool that returns variable-length output
 *
 * Iteration 29 rationale (pinned in the source comment): unbounded tool
 * output was the second-biggest history growth source. A single file-read
 * of a 1500-line file adds ~12k tokens PERMANENTLY to history. Capping
 * at the source bounds per-iteration growth.
 *
 * This file pins the structural contracts that callers rely on but
 * behavior tests (util-truncate.test.ts, 8 tests) don't make explicit:
 *
 *   1. PURE FUNCTION — same input produces same output, no side effects.
 *   2. NOTICE FORMAT — `\n\n[truncated: ${label} was ${originalChars}
 *      chars, showed ${from} ${maxChars} — use offset/limit or narrow
 *      the query to see more]`. Every caller emits the same shape.
 *   3. NOTICE IS NOT COUNTED AGAINST maxChars — it is appended on top.
 *      This keeps visible content size predictable.
 *   4. maxChars MUST BE POSITIVE FINITE — throws otherwise. Callers
 *      pass constants (20_000), so this is a fail-fast guard against
 *      refactoring mistakes.
 *   5. HEAD VS TAIL — from='head' keeps the prefix (file reads, where
 *      imports/exports matter); from='tail' keeps the suffix (log-like
 *      outputs, where recent entries matter).
 *   6. DEFAULTS — from defaults to 'head', label defaults to 'content'.
 *   7. NO TRUNCATION WHEN UNDER CAP — returns input verbatim, truncated
 *      flag false, when input.length <= maxChars.
 *
 * Also pins:
 *   - TruncateOptions type shape (1 required + 2 optional fields).
 *   - TruncateResult type shape (3 required fields).
 *   - readonly modifiers on all fields (immutability contract).
 *   - Source comment documents the Iteration 29 rationale.
 */

import { describe, test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { truncateForLLM, type TruncateOptions, type TruncateResult } from '../../src/util/truncate.js';

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

describe('truncate.ts — module exports', () => {
  test('truncateForLLM function is exported', async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    expect(src).toMatch(/export\s+function\s+truncateForLLM/);
  });

  test('TruncateOptions interface is exported', async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    expect(src).toMatch(/export\s+interface\s+TruncateOptions/);
  });

  test('TruncateResult interface is exported', async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    expect(src).toMatch(/export\s+interface\s+TruncateResult/);
  });

  test('source exports exactly one function', async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    const fnExports = src.match(/^export\s+function\s+(\w+)/gm) ?? [];
    expect(fnExports.length).toBe(1);
  });

  test('source exports exactly two interfaces', async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    const ifaceExports = src.match(/^export\s+interface\s+(\w+)/gm) ?? [];
    expect(ifaceExports.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// TruncateOptions type shape
// ---------------------------------------------------------------------------

describe('TruncateOptions type shape', () => {
  test('maxChars is required and typed number', async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    const match = src.match(/export\s+interface\s+TruncateOptions\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/readonly\s+maxChars:\s*number/);
  });

  test("from is optional with union 'head' | 'tail'", async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    const match = src.match(/export\s+interface\s+TruncateOptions\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/readonly\s+from\?\s*:\s*['"]head['"]\s*\|\s*['"]tail['"]/);
  });

  test('label is optional string', async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    const match = src.match(/export\s+interface\s+TruncateOptions\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/readonly\s+label\?\s*:\s*string/);
  });

  test('all fields are readonly (immutability)', async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    const match = src.match(/export\s+interface\s+TruncateOptions\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    // All three fields must be prefixed with `readonly`.
    const fields = match![1].match(/readonly\s+\w+/g) ?? [];
    expect(fields.length).toBe(3);
  });

  test('TruncateOptions accepts minimal { maxChars: 100 }', () => {
    // Compile-time check — this assignment must type-check.
    const opts: TruncateOptions = { maxChars: 100 };
    expect(opts.maxChars).toBe(100);
  });

  test('TruncateOptions accepts all three fields', () => {
    const opts: TruncateOptions = { maxChars: 100, from: 'tail', label: 'test' };
    expect(opts.from).toBe('tail');
    expect(opts.label).toBe('test');
  });
});

// ---------------------------------------------------------------------------
// TruncateResult type shape
// ---------------------------------------------------------------------------

describe('TruncateResult type shape', () => {
  test('content is string', async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    const match = src.match(/export\s+interface\s+TruncateResult\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/readonly\s+content:\s*string/);
  });

  test('truncated is boolean', async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    const match = src.match(/export\s+interface\s+TruncateResult\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/readonly\s+truncated:\s*boolean/);
  });

  test('originalChars is number', async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    const match = src.match(/export\s+interface\s+TruncateResult\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/readonly\s+originalChars:\s*number/);
  });

  test('all fields are readonly', async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    const match = src.match(/export\s+interface\s+TruncateResult\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    const fields = match![1].match(/readonly\s+\w+/g) ?? [];
    expect(fields.length).toBe(3);
  });

  test('TruncateResult has no optional fields', async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    const match = src.match(/export\s+interface\s+TruncateResult\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toMatch(/\?\s*:/);
  });
});

// ---------------------------------------------------------------------------
// Purity — same input → same output, no side effects
// ---------------------------------------------------------------------------

describe('truncateForLLM — purity', () => {
  test('same input produces identical output (referential transparency)', () => {
    const input = 'x'.repeat(500);
    const opts: TruncateOptions = { maxChars: 100 };
    const a = truncateForLLM(input, opts);
    const b = truncateForLLM(input, opts);
    expect(a).toEqual(b);
  });

  test('function does not mutate the input string (strings are immutable)', () => {
    const input = 'hello world';
    const opts: TruncateOptions = { maxChars: 5 };
    truncateForLLM(input, opts);
    expect(input).toBe('hello world');
  });

  test('function does not mutate the options object', () => {
    const opts: TruncateOptions = { maxChars: 100, from: 'head', label: 'test' };
    truncateForLLM('x'.repeat(500), opts);
    expect(opts).toEqual({ maxChars: 100, from: 'head', label: 'test' });
  });

  test('function returns a new object each call (not cached)', () => {
    const input = 'x'.repeat(500);
    const opts: TruncateOptions = { maxChars: 100 };
    const a = truncateForLLM(input, opts);
    const b = truncateForLLM(input, opts);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// No truncation when under cap
// ---------------------------------------------------------------------------

describe('truncateForLLM — under-cap path', () => {
  test('returns input verbatim when length equals maxChars', () => {
    const input = 'x'.repeat(100);
    const result = truncateForLLM(input, { maxChars: 100 });
    expect(result.content).toBe(input);
    expect(result.truncated).toBe(false);
    expect(result.originalChars).toBe(100);
  });

  test('returns input verbatim when length is less than maxChars', () => {
    const input = 'short';
    const result = truncateForLLM(input, { maxChars: 1000 });
    expect(result.content).toBe('short');
    expect(result.truncated).toBe(false);
    expect(result.originalChars).toBe(5);
  });

  test('empty input with positive maxChars returns empty content', () => {
    const result = truncateForLLM('', { maxChars: 100 });
    expect(result.content).toBe('');
    expect(result.truncated).toBe(false);
    expect(result.originalChars).toBe(0);
  });

  test('content equals input reference when not truncated', () => {
    // When no truncation happens, the function returns input as-is.
    const input = 'preserved';
    const result = truncateForLLM(input, { maxChars: 100 });
    expect(result.content).toBe(input);
  });

  test('no notice appended when under cap', () => {
    const result = truncateForLLM('short', { maxChars: 1000 });
    expect(result.content).not.toMatch(/\[truncated:/);
  });
});

// ---------------------------------------------------------------------------
// Truncation — head mode (default)
// ---------------------------------------------------------------------------

describe('truncateForLLM — head truncation', () => {
  test("from defaults to 'head' when omitted", () => {
    const input = 'abcdefghij'; // 10 chars
    const result = truncateForLLM(input, { maxChars: 4 });
    expect(result.content.startsWith('abcd')).toBe(true);
    expect(result.truncated).toBe(true);
  });

  test("from='head' keeps the prefix (first maxChars chars)", () => {
    const input = '0123456789ABCDEF'; // 16 chars
    const result = truncateForLLM(input, { maxChars: 8, from: 'head' });
    // The truncated content (before the notice) is the first 8 chars.
    expect(result.content.startsWith('01234567')).toBe(true);
    expect(result.content).not.toContain('ABCDEF');
  });

  test('head truncation with maxChars=1 keeps single char', () => {
    const result = truncateForLLM('long-string', { maxChars: 1, from: 'head' });
    expect(result.content.startsWith('l')).toBe(true);
  });

  test('head truncation originalChars reflects input length', () => {
    const input = 'x'.repeat(500);
    const result = truncateForLLM(input, { maxChars: 100, from: 'head' });
    expect(result.originalChars).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Truncation — tail mode
// ---------------------------------------------------------------------------

describe('truncateForLLM — tail truncation', () => {
  test("from='tail' keeps the suffix (last maxChars chars)", () => {
    const input = '0123456789ABCDEF'; // 16 chars
    const result = truncateForLLM(input, { maxChars: 8, from: 'tail' });
    // input.slice(-8) = '89ABCDEF' (last 8 chars).
    expect(result.content.startsWith('89ABCDEF')).toBe(true);
    // First 8 chars should NOT be in the kept content (before notice).
    expect(result.content).not.toContain('0123');
  });

  test('tail truncation with maxChars=1 keeps last char', () => {
    const result = truncateForLLM('long-string', { maxChars: 1, from: 'tail' });
    expect(result.content.startsWith('g')).toBe(true);
  });

  test('tail truncation of same length as head produces different content', () => {
    const input = 'HEAD-body-TAIL';
    const head = truncateForLLM(input, { maxChars: 4, from: 'head' });
    const tail = truncateForLLM(input, { maxChars: 4, from: 'tail' });
    // The kept content (before notice) differs.
    expect(head.content).not.toBe(tail.content);
  });
});

// ---------------------------------------------------------------------------
// Notice format — load-bearing contract
// ---------------------------------------------------------------------------

describe('truncateForLLM — notice format', () => {
  test("notice is prefixed with \\n\\n", () => {
    const result = truncateForLLM('x'.repeat(500), { maxChars: 100 });
    expect(result.content).toMatch(/\n\n\[truncated:/);
  });

  test('notice includes the label', () => {
    const result = truncateForLLM('x'.repeat(500), { maxChars: 100, label: 'stdout' });
    expect(result.content).toMatch(/\[truncated:\s*stdout/);
  });

  test("notice defaults label to 'content' when omitted", () => {
    const result = truncateForLLM('x'.repeat(500), { maxChars: 100 });
    expect(result.content).toMatch(/\[truncated:\s*content/);
  });

  test('notice includes originalChars value', () => {
    const input = 'y'.repeat(777);
    const result = truncateForLLM(input, { maxChars: 100 });
    expect(result.content).toMatch(/was\s+777\s+chars/);
  });

  test("notice includes the 'from' direction", () => {
    const result = truncateForLLM('x'.repeat(500), { maxChars: 100, from: 'tail' });
    expect(result.content).toMatch(/showed\s+tail\s+100/);
  });

  test("notice includes 'head' direction when from='head'", () => {
    const result = truncateForLLM('x'.repeat(500), { maxChars: 100, from: 'head' });
    expect(result.content).toMatch(/showed\s+head\s+100/);
  });

  test("notice includes 'head' direction when from omitted (default)", () => {
    const result = truncateForLLM('x'.repeat(500), { maxChars: 100 });
    expect(result.content).toMatch(/showed\s+head\s+100/);
  });

  test('notice includes actionable hint about offset/limit', () => {
    const result = truncateForLLM('x'.repeat(500), { maxChars: 100 });
    expect(result.content).toMatch(/offset|limit|narrow/);
  });

  test('notice is NOT counted against maxChars (appended on top)', () => {
    // The kept content portion (before the notice) is exactly maxChars chars.
    const result = truncateForLLM('x'.repeat(500), { maxChars: 100 });
    // Extract the portion before the notice.
    const noticeIdx = result.content.indexOf('\n\n[truncated:');
    expect(noticeIdx).toBe(100);
  });

  test('full notice format matches regex', () => {
    const result = truncateForLLM('data', { maxChars: 2, label: 'test-label' });
    // Full notice format:
    // [truncated: <label> was <originalChars> chars, showed <from> <maxChars> — use offset/limit or narrow the query to see more]
    expect(result.content).toMatch(
      /\[truncated:\s*test-label\s+was\s+\d+\s+chars,\s*showed\s+(?:head|tail)\s+\d+\s+—\s*use\s+offset\/limit\s+or\s+narrow\s+the\s+query\s+to\s+see\s+more\]/,
    );
  });
});

// ---------------------------------------------------------------------------
// maxChars validation — must be positive finite
// ---------------------------------------------------------------------------

describe('truncateForLLM — maxChars validation', () => {
  test('maxChars = 0 throws', () => {
    expect(() => truncateForLLM('x', { maxChars: 0 })).toThrow();
  });

  test('maxChars negative throws', () => {
    expect(() => truncateForLLM('x', { maxChars: -1 })).toThrow();
  });

  test('maxChars = NaN throws', () => {
    expect(() => truncateForLLM('x', { maxChars: Number.NaN })).toThrow();
  });

  test('maxChars = Infinity throws', () => {
    expect(() => truncateForLLM('x', { maxChars: Number.POSITIVE_INFINITY })).toThrow();
  });

  test('maxChars = -Infinity throws', () => {
    expect(() => truncateForLLM('x', { maxChars: Number.NEGATIVE_INFINITY })).toThrow();
  });

  test('error message mentions maxChars', () => {
    try {
      truncateForLLM('x', { maxChars: 0 });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).toMatch(/maxChars/);
    }
  });

  test('error message includes the invalid value', () => {
    try {
      truncateForLLM('x', { maxChars: -42 });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('-42');
    }
  });

  test("error message says 'must be a positive finite number'", () => {
    try {
      truncateForLLM('x', { maxChars: 0 });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).toMatch(/positive\s+finite/i);
    }
  });

  test('maxChars = 1 (minimum valid) does NOT throw', () => {
    expect(() => truncateForLLM('xx', { maxChars: 1 })).not.toThrow();
  });

  test('maxChars = 0.5 (fractional positive) does NOT throw', () => {
    // Positive and finite — the validation only rejects <= 0 or non-finite.
    // Fractional values are floor'd by slice() implicitly.
    expect(() => truncateForLLM('xxx', { maxChars: 0.5 })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// source-level — validation guard is present
// ---------------------------------------------------------------------------

describe('truncate.ts — source-level validation', () => {
  test('source uses Number.isFinite check', async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    expect(src).toMatch(/Number\.isFinite\(options\.maxChars\)/);
  });

  test('source checks maxChars <= 0', async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    expect(src).toMatch(/options\.maxChars\s*<=\s*0/);
  });

  test('source uses slice(0, maxChars) for head', async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    expect(src).toMatch(/slice\(0,\s*options\.maxChars\)/);
  });

  test('source uses slice(-maxChars) for tail', async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    expect(src).toMatch(/slice\(-options\.maxChars\)/);
  });

  test("source defaults from to 'head' via nullish coalescing", async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    expect(src).toMatch(/options\.from\s*\?\?\s*['"]head['"]/);
  });

  test("source defaults label to 'content' via nullish coalescing", async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    expect(src).toMatch(/options\.label\s*\?\?\s*['"]content['"]/);
  });

  test("source references the 'Iteration 29' rationale", async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    // The Iteration 29 rationale must remain — future PRs that change
    // the cap policy must acknowledge the history-growth cost.
    expect(src).toContain('Iteration 29');
  });

  test('source documents that notice is NOT counted against maxChars', async () => {
    const src = await readFile('src/util/truncate.ts', 'utf8');
    // The "on top" contract is load-bearing — callers rely on
    // predictable content size. Note: the comment has `*` prefixes
    // between words across newlines, so use [\s\S]*? to bridge them.
    expect(src).toMatch(/not\s+counted/i);
    expect(src).toMatch(/appended[\s\S]*?on[\s\S]*?top/i);
  });
});

// ---------------------------------------------------------------------------
// Default values — observable through behavior
// ---------------------------------------------------------------------------

describe('truncateForLLM — default values', () => {
  test("from defaults to 'head'", () => {
    const input = 'HEAD-TAIL';
    const explicit = truncateForLLM(input, { maxChars: 4, from: 'head' });
    const implicit = truncateForLLM(input, { maxChars: 4 });
    expect(implicit).toEqual(explicit);
  });

  test("label defaults to 'content'", () => {
    const explicit = truncateForLLM('x'.repeat(500), { maxChars: 100, label: 'content' });
    const implicit = truncateForLLM('x'.repeat(500), { maxChars: 100 });
    expect(implicit).toEqual(explicit);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('truncateForLLM — determinism', () => {
  test('two calls with identical input+opts produce identical result', () => {
    const input = 'x'.repeat(500);
    const opts: TruncateOptions = { maxChars: 100 };
    const a = truncateForLLM(input, opts);
    const b = truncateForLLM(input, opts);
    expect(a.content).toBe(b.content);
    expect(a.truncated).toBe(b.truncated);
    expect(a.originalChars).toBe(b.originalChars);
  });

  test('head and tail of symmetric input produce symmetric content', () => {
    // Input where the first N and last N chars are different.
    const input = 'AAAA-middle-BBBB';
    const head = truncateForLLM(input, { maxChars: 4, from: 'head' });
    const tail = truncateForLLM(input, { maxChars: 4, from: 'tail' });
    expect(head.content.startsWith('AAAA')).toBe(true);
    expect(tail.content.startsWith('BBBB')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Return type — TruncateResult shape at runtime
// ---------------------------------------------------------------------------

describe('truncateForLLM — TruncateResult runtime shape', () => {
  test('returns object with exactly 3 keys when truncated', () => {
    const result = truncateForLLM('x'.repeat(500), { maxChars: 100 });
    expect(Object.keys(result).sort()).toEqual(['content', 'originalChars', 'truncated']);
  });

  test('returns object with exactly 3 keys when not truncated', () => {
    const result = truncateForLLM('short', { maxChars: 100 });
    expect(Object.keys(result).sort()).toEqual(['content', 'originalChars', 'truncated']);
  });

  test('result satisfies TruncateResult type (compile-time)', () => {
    const result: TruncateResult = truncateForLLM('x', { maxChars: 100 });
    expect(typeof result.content).toBe('string');
    expect(typeof result.truncated).toBe('boolean');
    expect(typeof result.originalChars).toBe('number');
  });

  test('content is always a string', () => {
    const underCap = truncateForLLM('x', { maxChars: 100 });
    const overCap = truncateForLLM('x'.repeat(500), { maxChars: 100 });
    expect(typeof underCap.content).toBe('string');
    expect(typeof overCap.content).toBe('string');
  });

  test('truncated is always a boolean', () => {
    const underCap = truncateForLLM('x', { maxChars: 100 });
    const overCap = truncateForLLM('x'.repeat(500), { maxChars: 100 });
    expect(typeof underCap.truncated).toBe('boolean');
    expect(typeof overCap.truncated).toBe('boolean');
  });

  test('originalChars equals input.length', () => {
    const inputs = ['', 'a', 'ab', 'x'.repeat(1000)];
    for (const input of inputs) {
      const result = truncateForLLM(input, { maxChars: 100 });
      expect(result.originalChars).toBe(input.length);
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('truncateForLLM — edge cases', () => {
  test('input exactly at cap (boundary) does not truncate', () => {
    const input = 'x'.repeat(100);
    const result = truncateForLLM(input, { maxChars: 100 });
    expect(result.truncated).toBe(false);
    expect(result.content).toBe(input);
  });

  test('input one char over cap truncates', () => {
    const input = 'x'.repeat(101);
    const result = truncateForLLM(input, { maxChars: 100 });
    expect(result.truncated).toBe(true);
  });

  test('unicode chars count as single UTF-16 code units (string.length semantics)', () => {
    // string.length counts UTF-16 code units, not code points.
    // Emoji like 😀 is 2 code units (surrogate pair).
    const input = '😀'.repeat(10); // 20 code units
    const result = truncateForLLM(input, { maxChars: 5 });
    expect(result.originalChars).toBe(20);
    expect(result.truncated).toBe(true);
  });

  test('newline in input is preserved through truncation', () => {
    const input = 'line1\nline2\nline3\nline4';
    const result = truncateForLLM(input, { maxChars: 100 });
    expect(result.content).toBe(input);
    expect(result.truncated).toBe(false);
  });

  test('notice placement after newlines in content', () => {
    const input = 'line1\nline2\nline3\nline4\nline5';
    const result = truncateForLLM(input, { maxChars: 10 });
    // The notice is appended after the truncated content.
    expect(result.content).toMatch(/\n\n\[truncated:/);
  });

  test('very large maxChars works (no overflow)', () => {
    const result = truncateForLLM('short', { maxChars: Number.MAX_SAFE_INTEGER });
    expect(result.truncated).toBe(false);
    expect(result.content).toBe('short');
  });
});

// ---------------------------------------------------------------------------
// Integration — callers (bash.ts, file.ts) use the same contract
// ---------------------------------------------------------------------------

describe('truncateForLLM — caller integration', () => {
  test('notice format matches what tools-bash-invariants test expects', () => {
    // tools-bash-invariants.test.ts asserts that bash output includes
    // "[truncated:" — verify truncateForLLM produces that exact format.
    const result = truncateForLLM('x'.repeat(500), { maxChars: 100, label: 'stdout' });
    expect(result.content).toMatch(/\[truncated:/);
  });

  test('notice format matches what tools-file-invariants test expects', () => {
    // tools-file-invariants.test.ts asserts that file-read output of
    // a large file includes a truncation notice.
    const result = truncateForLLM('x'.repeat(500), { maxChars: 100, label: 'file' });
    expect(result.content).toMatch(/\[truncated:/);
  });

  test('20_000 char cap (DEFAULT_STDOUT_CAP / DEFAULT_CHAR_CAP) is callable', () => {
    // Both bash.ts and file.ts use 20_000 as their default cap.
    // Verify truncateForLLM accepts it without issue.
    const result = truncateForLLM('x'.repeat(25_000), { maxChars: 20_000 });
    expect(result.truncated).toBe(true);
    expect(result.originalChars).toBe(25_000);
  });
});
