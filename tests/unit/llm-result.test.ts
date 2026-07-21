import { describe, test, expect } from 'vitest';
import {
  isObject,
  parsePriority,
  isMemoryCategory,
  coerceBacklogItem,
  coerceMemoryEntry,
} from '../../src/cerebellum/llm-result.js';

/**
 * Direct unit tests for the shared LLM-result coercion module.
 *
 * These functions are the boundary between untrusted LLM JSON output
 * and the cerebellum's internal backlog/memory types. A bug here means
 * either (a) the agent silently drops a valid proposal or (b) the
 * agent accepts malformed input and crashes downstream. Both have
 * bitten the codebase in earlier iterations.
 *
 * Coverage focuses on edge cases: null, undefined, arrays, primitives,
 * NaN, Infinity, out-of-range priorities, empty strings, whitespace-
 * only strings, extra fields, long titles (200-char truncation).
 */

describe('isObject', () => {
  test('returns true for plain objects', () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
  });

  test('returns false for null and undefined', () => {
    expect(isObject(null)).toBe(false);
    expect(isObject(undefined)).toBe(false);
  });

  test('returns false for arrays (even though typeof array is "object")', () => {
    expect(isObject([])).toBe(false);
    expect(isObject([1, 2, 3])).toBe(false);
  });

  test('returns false for primitives', () => {
    expect(isObject(42)).toBe(false);
    expect(isObject('string')).toBe(false);
    expect(isObject(true)).toBe(false);
    expect(isObject(Symbol('s'))).toBe(false);
  });
});

describe('parsePriority', () => {
  test('returns clamped integer for valid finite numbers', () => {
    expect(parsePriority(50)).toBe(50);
    expect(parsePriority(0)).toBe(0);
    expect(parsePriority(100)).toBe(100);
  });

  test('rounds to nearest integer', () => {
    expect(parsePriority(50.4)).toBe(50);
    expect(parsePriority(50.5)).toBe(51);
    expect(parsePriority(49.5)).toBe(50);
  });

  test('clamps to [0, 100] range', () => {
    expect(parsePriority(-10)).toBe(0);
    expect(parsePriority(-0.1)).toBe(0);
    expect(parsePriority(101)).toBe(100);
    expect(parsePriority(9999)).toBe(100);
  });

  test('returns undefined for non-numbers', () => {
    expect(parsePriority(undefined)).toBeUndefined();
    expect(parsePriority(null)).toBeUndefined();
    expect(parsePriority('50')).toBeUndefined();
    expect(parsePriority(true)).toBeUndefined();
    expect(parsePriority({})).toBeUndefined();
  });

  test('returns undefined for NaN and Infinity', () => {
    expect(parsePriority(NaN)).toBeUndefined();
    expect(parsePriority(Infinity)).toBeUndefined();
    expect(parsePriority(-Infinity)).toBeUndefined();
  });
});

describe('isMemoryCategory', () => {
  test('returns true for the four valid categories', () => {
    expect(isMemoryCategory('patterns')).toBe(true);
    expect(isMemoryCategory('lessons')).toBe(true);
    expect(isMemoryCategory('preferences')).toBe(true);
    expect(isMemoryCategory('dreams')).toBe(true);
  });

  test('returns false for unknown strings', () => {
    expect(isMemoryCategory('.Patterns')).toBe(false);
    expect(isMemoryCategory('pattern')).toBe(false); // singular
    expect(isMemoryCategory('PATTERNS')).toBe(false); // case-sensitive
    expect(isMemoryCategory('memory')).toBe(false);
    expect(isMemoryCategory('')).toBe(false);
  });

  test('returns false for non-strings', () => {
    expect(isMemoryCategory(null)).toBe(false);
    expect(isMemoryCategory(undefined)).toBe(false);
    expect(isMemoryCategory(42)).toBe(false);
    expect(isMemoryCategory({})).toBe(false);
    expect(isMemoryCategory(['patterns'])).toBe(false);
  });
});

describe('coerceBacklogItem', () => {
  test('returns null for non-objects', () => {
    expect(coerceBacklogItem(null)).toBeNull();
    expect(coerceBacklogItem(undefined)).toBeNull();
    expect(coerceBacklogItem('string')).toBeNull();
    expect(coerceBacklogItem([])).toBeNull();
    expect(coerceBacklogItem(42)).toBeNull();
  });

  test('returns null when goal is missing or empty', () => {
    expect(coerceBacklogItem({})).toBeNull();
    expect(coerceBacklogItem({ goal: '' })).toBeNull();
    expect(coerceBacklogItem({ goal: '   ' })).toBeNull();
    expect(coerceBacklogItem({ goal: null })).toBeNull();
    expect(coerceBacklogItem({ goal: 42 })).toBeNull();
  });

  test('trims goal whitespace', () => {
    const result = coerceBacklogItem({ goal: '  fix the bug  ' });
    expect(result?.goal).toBe('fix the bug');
  });

  test('accepts a goal-only item', () => {
    const result = coerceBacklogItem({ goal: 'add retry to provider' });
    expect(result).toEqual({ goal: 'add retry to provider' });
    expect(result?.priority).toBeUndefined();
    expect(result?.rationale).toBeUndefined();
  });

  test('includes priority when present and valid', () => {
    const result = coerceBacklogItem({
      goal: 'x',
      priority: 42,
    });
    expect(result?.priority).toBe(42);
  });

  test('omits priority when absent (not 0, not NaN — truly absent)', () => {
    const result = coerceBacklogItem({ goal: 'x' });
    expect(result?.priority).toBeUndefined();
    expect(result).not.toHaveProperty('priority');
  });

  test('omits priority when invalid (NaN, Infinity, out-of-range strings)', () => {
    expect(
      coerceBacklogItem({ goal: 'x', priority: 'high' })?.priority,
    ).toBeUndefined();
    expect(
      coerceBacklogItem({ goal: 'x', priority: NaN })?.priority,
    ).toBeUndefined();
    expect(
      coerceBacklogItem({ goal: 'x', priority: Infinity })?.priority,
    ).toBeUndefined();
  });

  test('clamps priority to [0, 100]', () => {
    expect(coerceBacklogItem({ goal: 'x', priority: -5 })?.priority).toBe(0);
    expect(coerceBacklogItem({ goal: 'x', priority: 200 })?.priority).toBe(100);
  });

  test('includes rationale when non-empty string', () => {
    const result = coerceBacklogItem({
      goal: 'x',
      rationale: 'why this matters',
    });
    expect(result?.rationale).toBe('why this matters');
  });

  test('omits rationale when empty or whitespace-only', () => {
    expect(
      coerceBacklogItem({ goal: 'x', rationale: '' })?.rationale,
    ).toBeUndefined();
    expect(
      coerceBacklogItem({ goal: 'x', rationale: '   ' })?.rationale,
    ).toBeUndefined();
  });

  test('ignores extra fields on the raw object', () => {
    const result = coerceBacklogItem({
      goal: 'x',
      extra: 'ignored',
      malicious: true,
    });
    expect(result).not.toHaveProperty('extra');
    expect(result).not.toHaveProperty('malicious');
  });
});

describe('coerceMemoryEntry', () => {
  test('returns null for non-objects', () => {
    expect(coerceMemoryEntry(null)).toBeNull();
    expect(coerceMemoryEntry(undefined)).toBeNull();
    expect(coerceMemoryEntry('string')).toBeNull();
    expect(coerceMemoryEntry([])).toBeNull();
  });

  test('returns null when category is missing or invalid', () => {
    expect(coerceMemoryEntry({ title: 't', body: 'b' })).toBeNull();
    expect(
      coerceMemoryEntry({ category: 'unknown', title: 't', body: 'b' }),
    ).toBeNull();
    expect(
      coerceMemoryEntry({ category: null, title: 't', body: 'b' }),
    ).toBeNull();
    expect(
      coerceMemoryEntry({ category: 42, title: 't', body: 'b' }),
    ).toBeNull();
  });

  test('returns null when title or body is empty', () => {
    expect(
      coerceMemoryEntry({ category: 'patterns', title: '', body: 'b' }),
    ).toBeNull();
    expect(
      coerceMemoryEntry({ category: 'patterns', title: 't', body: '' }),
    ).toBeNull();
    expect(
      coerceMemoryEntry({ category: 'patterns', title: '  ', body: 'b' }),
    ).toBeNull();
  });

  test('trims title and body whitespace', () => {
    const result = coerceMemoryEntry({
      category: 'patterns',
      title: '  Some title  ',
      body: '  Some body  ',
    });
    expect(result?.title).toBe('Some title');
    expect(result?.body).toBe('Some body');
  });

  test('truncates title to 200 chars (body is not truncated)', () => {
    const longTitle = 'a'.repeat(300);
    const longBody = 'b'.repeat(500);
    const result = coerceMemoryEntry({
      category: 'patterns',
      title: longTitle,
      body: longBody,
    });
    expect(result?.title.length).toBe(200);
    expect(result?.body.length).toBe(500);
  });

  test('preserves the exact category string when valid', () => {
    for (const cat of ['patterns', 'lessons', 'preferences', 'dreams'] as const) {
      const result = coerceMemoryEntry({
        category: cat,
        title: 't',
        body: 'b',
      });
      expect(result?.category).toBe(cat);
    }
  });

  test('ignores extra fields on the raw object', () => {
    const result = coerceMemoryEntry({
      category: 'patterns',
      title: 't',
      body: 'b',
      id: 'should-be-ignored',
      ts: 'also-ignored',
    });
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('ts');
  });
});

describe('coerce round-trip with dreamer/curiosity output shape', () => {
  // Integration-flavored test: verify that coerce handles a realistic
  // LLM response payload the way dreamer.ts and curiosity.ts consume it.
  test('typical dreamer response — mixed valid and invalid items', () => {
    const raw = {
      backlogItems: [
        { goal: 'add retry to llm provider', priority: 60, rationale: 'flaky API' },
        { goal: '', priority: 50 }, // empty goal — drop
        { goal: 'fix typo', priority: 'high' }, // bad priority — keep without priority
        null, // non-object — drop
        { goal: '   ', rationale: 'whitespace goal' }, // whitespace goal — drop
      ],
      memoryEntries: [
        { category: 'patterns', title: 'Bias to action', body: 'Act, do not narrate.' },
        { category: 'unknown', title: 'bad category', body: 'drop me' }, // invalid cat — drop
        { category: 'lessons', title: '', body: 'empty title — drop' },
      ],
    };

    const backlog = (raw.backlogItems as unknown[])
      .map(coerceBacklogItem)
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const memory = (raw.memoryEntries as unknown[])
      .map(coerceMemoryEntry)
      .filter((x): x is NonNullable<typeof x> => x !== null);

    expect(backlog).toHaveLength(2);
    expect(backlog[0]!.goal).toBe('add retry to llm provider');
    expect(backlog[0]!.priority).toBe(60);
    expect(backlog[1]!.goal).toBe('fix typo');
    expect(backlog[1]!.priority).toBeUndefined();

    expect(memory).toHaveLength(1);
    expect(memory[0]!.category).toBe('patterns');
    expect(memory[0]!.title).toBe('Bias to action');
  });
});
