import { describe, test, expect } from 'vitest';
import { extractJsonObject } from '../../src/cerebellum/extract-json.js';

/**
 * extract-json.ts — Iteration 38 extraction. Shared JSON-from-LLM-response
 * parser used by dreamer.ts and curiosity.ts.
 *
 * The fence-stripping test cases pin the bug fix: the previous copies
 * used `fenceMatch?.groups?.[0]`, but the regex had no named groups, so
 * `.groups` was always undefined. Fenced responses silently fell through
 * to raw-text parsing and failed.
 */
interface TestShape {
  readonly backlogItems: readonly unknown[];
  readonly memoryEntries?: readonly unknown[];
}

describe('extractJsonObject', () => {
  test('parses raw JSON', () => {
    const input = '{"backlogItems": []}';
    const result = extractJsonObject<TestShape>(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.backlogItems).toEqual([]);
    }
  });

  test('parses JSON with leading/trailing whitespace', () => {
    const input = '  \n  {"backlogItems": [{"goal":"x"}]}  \n  ';
    const result = extractJsonObject<TestShape>(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.backlogItems.length).toBe(1);
    }
  });

  test('parses markdown-fenced JSON (```json)', () => {
    const input = '```json\n{"backlogItems": []}\n```';
    const result = extractJsonObject<TestShape>(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.backlogItems).toEqual([]);
  });

  test('parses markdown-fenced JSON without language hint (```)', () => {
    const input = '```\n{"backlogItems": []}\n```';
    const result = extractJsonObject<TestShape>(input);
    expect(result.ok).toBe(true);
  });

  test('parses JSON embedded in prose', () => {
    const input = `Here's my plan:\n\n{"backlogItems": []}\n\nHope it helps.`;
    const result = extractJsonObject<TestShape>(input);
    expect(result.ok).toBe(true);
  });

  test('parses fenced JSON embedded in prose', () => {
    const input = `Sure, here you go:\n\n\`\`\`json\n{"backlogItems": []}\n\`\`\`\n\nLet me know!`;
    const result = extractJsonObject<TestShape>(input);
    expect(result.ok).toBe(true);
  });

  test('returns error when no JSON object present', () => {
    const result = extractJsonObject<TestShape>('just prose, no JSON');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('no JSON object');
    }
  });

  test('returns error for malformed JSON', () => {
    const result = extractJsonObject<TestShape>('{"unterminated":');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  test('handles JSON with nested braces', () => {
    const input = '{"backlogItems": [{"goal": "a"}, {"goal": "b"}]}';
    const result = extractJsonObject<TestShape>(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.backlogItems.length).toBe(2);
    }
  });

  test('rejects empty string', () => {
    const result = extractJsonObject<TestShape>('');
    expect(result.ok).toBe(false);
  });

  test('rejects string with only opening brace', () => {
    const result = extractJsonObject<TestShape>('just { no close');
    expect(result.ok).toBe(false);
  });

  test('typed via generic — preserves type information', () => {
    interface Strict {
      readonly count: number;
    }
    const result = extractJsonObject<Strict>('{"count": 5}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // TypeScript check happens at compile time; runtime check here.
      expect((result.value as { count: number }).count).toBe(5);
    }
  });
});
