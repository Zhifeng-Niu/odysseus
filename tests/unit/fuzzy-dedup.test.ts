import { describe, test, expect } from 'vitest';
import {
  levenshteinDistance,
  levenshteinRatio,
  normalizeForFuzzy,
  findFuzzyDuplicate,
  isFuzzyDuplicate,
  FUZZY_DEDUP_THRESHOLD,
} from '../../src/cerebellum/fuzzy-dedup.js';

describe('levenshteinDistance', () => {
  test('identical strings → distance 0', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  test('empty vs non-empty → length of non-empty', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  test('both empty → 0', () => {
    expect(levenshteinDistance('', '')).toBe(0);
  });

  test('single substitution', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1);
  });

  test('single insertion', () => {
    expect(levenshteinDistance('cat', 'cats')).toBe(1);
  });

  test('single deletion', () => {
    expect(levenshteinDistance('cats', 'cat')).toBe(1);
  });

  test('classic example: kitten → sitting = 3', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });

  test('completely different strings → max length', () => {
    expect(levenshteinDistance('abc', 'xyz')).toBe(3);
  });

  test('is symmetric', () => {
    expect(levenshteinDistance('abcdef', 'azced')).toBe(
      levenshteinDistance('azced', 'abcdef'),
    );
  });

  test('handles long strings', () => {
    const a = 'a'.repeat(200);
    const b = 'b'.repeat(200);
    expect(levenshteinDistance(a, b)).toBe(200);
  });
});

describe('normalizeForFuzzy', () => {
  test('lowercases', () => {
    expect(normalizeForFuzzy('Add RETRY')).toBe('add retry');
  });

  test('strips punctuation', () => {
    expect(normalizeForFuzzy('fix bug: parser!')).toBe('fix bug parser');
  });

  test('collapses whitespace', () => {
    expect(normalizeForFuzzy('fix   bug\t\nparser')).toBe('fix bug parser');
  });

  test('trims leading/trailing whitespace', () => {
    expect(normalizeForFuzzy('  hello  ')).toBe('hello');
  });

  test('empty string stays empty', () => {
    expect(normalizeForFuzzy('')).toBe('');
  });

  test('preserves digits', () => {
    expect(normalizeForFuzzy('fix bug 123')).toBe('fix bug 123');
  });
});

describe('levenshteinRatio', () => {
  test('identical → 1.0', () => {
    expect(levenshteinRatio('hello', 'hello')).toBe(1.0);
  });

  test('completely different → 0.0', () => {
    expect(levenshteinRatio('abc', 'xyz')).toBe(0.0);
  });

  test('both empty → 1.0', () => {
    expect(levenshteinRatio('', '')).toBe(1.0);
  });

  test('one empty → 0.0', () => {
    expect(levenshteinRatio('abc', '')).toBe(0.0);
  });

  test('single char edit on short string → high ratio', () => {
    // 'cat' vs 'bat': distance 1, maxLen 3 → ratio = 1 - 1/3 ≈ 0.667
    expect(levenshteinRatio('cat', 'bat')).toBeCloseTo(1 - 1 / 3, 5);
  });

  test('single char edit on long string → very high ratio', () => {
    // 'fix bug in parser' vs 'fix bugs in parser': distance 1, maxLen 17
    const ratio = levenshteinRatio('fix bug in parser', 'fix bugs in parser');
    expect(ratio).toBeGreaterThan(0.9);
  });

  test('normalizes before comparing (case/punct/whitespace)', () => {
    expect(levenshteinRatio('Add RETRY!', 'add retry')).toBe(1.0);
  });
});

describe('findFuzzyDuplicate', () => {
  test('returns null for empty existing set', () => {
    expect(findFuzzyDuplicate('any goal', new Set())).toBeNull();
  });

  test('returns null when no match', () => {
    const existing = new Set(['completely different task']);
    expect(findFuzzyDuplicate('add retry logic', existing)).toBeNull();
  });

  test('returns null for empty new goal', () => {
    const existing = new Set(['add retry']);
    expect(findFuzzyDuplicate('', existing)).toBeNull();
  });

  test('returns null for whitespace-only new goal', () => {
    const existing = new Set(['add retry']);
    expect(findFuzzyDuplicate('   ', existing)).toBeNull();
  });

  test('exact match after normalization → returns the existing goal', () => {
    const existing = new Set(['Add Retry Logic!']);
    expect(findFuzzyDuplicate('add retry logic', existing)).toBe('Add Retry Logic!');
  });

  test('near-duplicate with typo → returns match', () => {
    const existing = new Set(['add retry to glm']);
    // 'add retry to gl' — missing one char
    expect(findFuzzyDuplicate('add retry to gl', existing)).toBe('add retry to glm');
  });

  test('near-duplicate with plural → returns match', () => {
    const existing = new Set(['fix bug in parser']);
    expect(findFuzzyDuplicate('fix bugs in parser', existing)).toBe('fix bug in parser');
  });

  test('near-duplicate with minor rewording → returns match at looser threshold', () => {
    const existing = new Set(['add retry logic to glm provider']);
    // 'add retry to glm provider' — dropped 'logic', ratio ~0.79.
    // Below default 0.85 but above 0.7.
    expect(findFuzzyDuplicate('add retry to glm provider', existing, 0.7)).toBe(
      'add retry logic to glm provider',
    );
    // At default threshold it does NOT match — too many edits.
    expect(findFuzzyDuplicate('add retry to glm provider', existing)).toBeNull();
  });

  test('returns the FIRST match when multiple exist', () => {
    const existing = new Set(['add retry to glm', 'add retry logic to glm']);
    const match = findFuzzyDuplicate('add retry to glm', existing);
    expect(match).toBe('add retry to glm');
  });

  test('respects custom threshold — stricter threshold rejects near-dup', () => {
    const existing = new Set(['fix bug in parser']);
    // 'fix bugs in parser' has ratio ~0.94 — passes 0.85 but fails 0.99
    expect(findFuzzyDuplicate('fix bugs in parser', existing, 0.85)).not.toBeNull();
    expect(findFuzzyDuplicate('fix bugs in parser', existing, 0.99)).toBeNull();
  });

  test('respects custom threshold — looser threshold catches more', () => {
    const existing = new Set(['add retry to glm']);
    // 'add timeout to glm' — shares many chars but different word
    // ratio is lower; with 0.5 threshold it might match
    const loose = findFuzzyDuplicate('add timeout to glm', existing, 0.5);
    const strict = findFuzzyDuplicate('add timeout to glm', existing, 0.95);
    expect(loose).not.toBeNull();
    expect(strict).toBeNull();
  });

  test('FUZZY_DEDUP_THRESHOLD is 0.85', () => {
    expect(FUZZY_DEDUP_THRESHOLD).toBe(0.85);
  });
});

describe('isFuzzyDuplicate', () => {
  test('returns true when findFuzzyDuplicate returns a match', () => {
    const existing = new Set(['add retry to glm']);
    expect(isFuzzyDuplicate('add retry to gl', existing)).toBe(true);
  });

  test('returns false when findFuzzyDuplicate returns null', () => {
    const existing = new Set(['completely different']);
    expect(isFuzzyDuplicate('add retry logic', existing)).toBe(false);
  });

  test('returns false for empty set', () => {
    expect(isFuzzyDuplicate('any goal', new Set())).toBe(false);
  });

  test('returns false for empty new goal', () => {
    const existing = new Set(['add retry']);
    expect(isFuzzyDuplicate('', existing)).toBe(false);
  });
});
