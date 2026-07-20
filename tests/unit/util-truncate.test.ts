import { describe, test, expect } from 'vitest';
import { truncateForLLM } from '../../src/util/truncate.js';

/**
 * truncate.ts — the cap that bounds tool-result growth in conversation
 * history. Without this, file-read of a 1500-line file adds ~12k tokens
 * to every subsequent iteration in a waypoint (Iteration 29 finding:
 * 40M input tokens across 70 waypoints, avg 571k/waypoint).
 *
 * These tests pin the contract every tool relies on: bounded output,
 * head-or-tail selection, notice format, and edge cases (exact-fit,
 * over-cap, empty input, invalid args).
 */

describe('truncateForLLM — within cap', () => {
  test('returns content unchanged when at or below maxChars', () => {
    expect(truncateForLLM('hello', { maxChars: 5 }).content).toBe('hello');
    expect(truncateForLLM('hello', { maxChars: 100 }).content).toBe('hello');
  });

  test('marks truncated as false when no truncation happened', () => {
    const r = truncateForLLM('short', { maxChars: 100 });
    expect(r.truncated).toBe(false);
    expect(r.originalChars).toBe(5);
  });

  test('exact-fit (length === maxChars) is NOT truncated', () => {
    // Off-by-one pin: equal length is within cap, not over.
    const r = truncateForLLM('abcde', { maxChars: 5 });
    expect(r.truncated).toBe(false);
    expect(r.content).toBe('abcde');
  });
});

describe('truncateForLLM — over cap', () => {
  test('truncates from head by default and appends a notice', () => {
    const input = 'abcdefghij'; // 10 chars
    const r = truncateForLLM(input, { maxChars: 4, label: 'file' });
    expect(r.truncated).toBe(true);
    expect(r.originalChars).toBe(10);
    // First 4 chars preserved, then the notice.
    expect(r.content.startsWith('abcd')).toBe(true);
    expect(r.content).toContain('[truncated: file was 10 chars, showed head 4');
    expect(r.content).toContain('use offset/limit or narrow the query');
  });

  test('truncates from tail when from: tail', () => {
    // Useful for log-like output where the most recent entries matter.
    const input = 'abcdefghij'; // 10 chars
    const r = truncateForLLM(input, { maxChars: 4, from: 'tail', label: 'stdout' });
    expect(r.truncated).toBe(true);
    expect(r.content.startsWith('ghij')).toBe(true);
    expect(r.content).toContain('showed tail 4');
  });

  test('notice is appended on TOP of maxChars, not subtracted from it', () => {
    // This is the documented contract: the cap bounds the visible
    // content, and the notice is added on top. Callers pick a maxChars
    // that leaves room in their downstream budget for the notice.
    const input = 'x'.repeat(1000);
    const r = truncateForLLM(input, { maxChars: 100 });
    expect(r.content.length).toBeGreaterThan(100); // 100 + notice
    // The visible "x" run is exactly 100, not 100 - notice_len.
    expect(r.content.slice(0, 100)).toBe('x'.repeat(100));
  });

  test('default label is "content" when none provided', () => {
    const r = truncateForLLM('abcdefghij', { maxChars: 3 });
    expect(r.content).toContain('[truncated: content was 10 chars');
  });
});

describe('truncateForLLM — edge cases', () => {
  test('empty input is not truncated', () => {
    const r = truncateForLLM('', { maxChars: 10 });
    expect(r.content).toBe('');
    expect(r.truncated).toBe(false);
    expect(r.originalChars).toBe(0);
  });

  test('maxChars = 1 keeps a single character + notice', () => {
    const r = truncateForLLM('abcdef', { maxChars: 1 });
    expect(r.truncated).toBe(true);
    expect(r.content.startsWith('a')).toBe(true);
    expect(r.content).toContain('was 6 chars');
  });

  test('throws on maxChars = 0 (must be positive)', () => {
    expect(() => truncateForLLM('abc', { maxChars: 0 })).toThrow(/positive finite/);
  });

  test('throws on negative maxChars', () => {
    expect(() => truncateForLLM('abc', { maxChars: -10 })).toThrow(/positive finite/);
  });

  test('throws on NaN maxChars', () => {
    expect(() => truncateForLLM('abc', { maxChars: Number.NaN })).toThrow(/positive finite/);
  });

  test('throws on Infinity maxChars', () => {
    // Infinity would defeat the purpose — caller must pick a real bound.
    expect(() => truncateForLLM('abc', { maxChars: Number.POSITIVE_INFINITY })).toThrow(
      /positive finite/
    );
  });

  test('handles unicode safely (slice by UTF-16 code unit)', () => {
    // JavaScript strings are UTF-16; .slice() cuts by code unit. This
    // can split surrogate pairs (emoji) but won't crash. Pin the
    // actual behavior so a future switch to grapheme-aware slicing is
    // a conscious decision.
    const input = '🎉🎉🎉🎉🎉'; // 5 emoji, 10 UTF-16 code units
    const r = truncateForLLM(input, { maxChars: 3 });
    expect(r.originalChars).toBe(10);
    expect(r.truncated).toBe(true);
    // 3 code units = 1 full emoji + half of another (a surrogate).
    expect(r.content.startsWith('🎉')).toBe(true);
  });
});

describe('truncateForLLM — notice format invariants', () => {
  // The notice format is part of the contract — tools display it to
  // the LLM, which reads it to decide whether to paginate. Changes
  // to the wording must be conscious.

  test('notice includes original size, direction, and cap', () => {
    const r = truncateForLLM('x'.repeat(500), { maxChars: 100, label: 'file' });
    expect(r.content).toMatch(/\[truncated: file was 500 chars, showed head 100 — use offset\/limit or narrow the query to see more\]/);
  });

  test('notice starts with two newlines to separate it from content', () => {
    // maxChars=5 keeps only the first 5 chars of the visible content;
    // the notice is then appended after two newlines.
    const r = truncateForLLM('content here is long enough to truncate', { maxChars: 5 });
    expect(r.content).toContain('conte\n\n[truncated:');
  });

  test('notice is the same regardless of input content (only label + sizes vary)', () => {
    // Two different inputs with the same length + cap should produce
    // identical notices. Predictable format = LLM can parse reliably.
    const a = truncateForLLM('aaaa'.repeat(100), { maxChars: 50, label: 'X' });
    const b = truncateForLLM('bbbb'.repeat(100), { maxChars: 50, label: 'X' });
    const noticeA = a.content.slice(50);
    const noticeB = b.content.slice(50);
    expect(noticeA).toBe(noticeB);
  });
});
