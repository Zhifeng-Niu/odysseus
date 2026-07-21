import { describe, test, expect, beforeEach } from 'vitest';
import {
  MAX_RETRY_ATTEMPTS,
  hashGoalDescription,
  getRetryCount,
  incrementRetryCounter,
  isRetryExhausted,
  clearRetryCounters,
} from '../../src/cerebellum/retry-counter.js';

/**
 * retry-counter — structural and state invariants.
 *
 * retry-counter.test.ts covers behavior — hash normalization, counter
 read/increment, threshold comparison, cross-module parity with
 * seedAttempts (33 tests). But the structural contracts a refactor
 * could silently break are NOT pinned:
 *
 *   - hashGoalDescription OUTPUT TYPE. Always a string (possibly
 *     empty). Never undefined, never null, never a non-string.
 *
 *   - hashGoalDescription IDEMPOTENCY. Hashing the hash produces
 *     the same hash. This proves the hash is already in normal form.
 *
 *   - hashGoalDescription DEAD .trim() AT END. The algorithm is
 *     lowercase → strip-non-alphanumeric → trim. After the strip,
 *     there is NO whitespace left (whitespace is non-alphanumeric).
 *     So the trailing .trim() is a no-op. Pinning this so a refactor
 *     that reorders (e.g. trim → strip → lowercase) is caught.
 *
 *   - EMPTY BUCKET COLLAPSE. Empty string, whitespace-only, and
 *     punctuation-only inputs ALL hash to ''. They share the same
 *     counter bucket. A goal of '' and a goal of '   ' are the
 *     same key.
 *
 *   - HASH PRESERVES DIGITS. Alphanumerics includes [a-z0-9]. The
 *     '0-9' range is preserved. 'v2.0' → 'v20'.
 *
 *   - HASH STRIPS UNICODE LETTERS. '你好' is stripped entirely
 *     (not transliterated to ASCII). This is a known limitation
 *     shared with seedAttempts.
 *
 *   - COUNTER MONOTONICITY. incrementRetryCounter always returns
 *     the previous count + 1. Never decreases within a session.
 *
 *   - COUNTER UNBOUNDED. There is no wraparound or saturation.
 *     The counter grows indefinitely.
 *
 *   - HASH-ALIASING ON COUNTER. Two goals with the same hash share
 *     the same counter. 'Add Retry' and 'add-retry' increment the
 *     same bucket.
 *
 *   - isRetryExhausted COMPARISON OPERATOR. Uses strict greater-than
 *     (>), not >=. At count == MAX_RETRY_ATTEMPTS (3), returns
 *     false. Only count > 3 returns true.
 *
 * Each test below pins one slice of these contracts.
 */

beforeEach(() => {
  clearRetryCounters();
});

describe('hashGoalDescription — output type and basic shape', () => {
  test('always returns a string for string inputs', () => {
    const inputs = [
      '',
      '   ',
      'hello',
      'Add Retry',
      '123',
      '!@#$%',
      '你好',
    ];
    for (const input of inputs) {
      const result = hashGoalDescription(input);
      expect(typeof result).toBe('string');
    }
  });

  test('throws on null/undefined (no type check in source)', () => {
    // The source does `goal.toLowerCase()` immediately. Non-strings
    // throw TypeError. Pinning that the function is NOT total — it
    // requires a string input. A refactor that adds a type check
    // (e.g. `goal == null ? '' : goal.toLowerCase()`) would silently
    // change behavior.
    expect(() => hashGoalDescription(null as unknown as string)).toThrow(TypeError);
    expect(() => hashGoalDescription(undefined as unknown as string)).toThrow(TypeError);
  });

  test('output contains ONLY lowercase ascii letters and digits', () => {
    // After hash, the result matches /^[a-z0-9]*$/.
    const inputs = [
      'hello',
      'Add Retry v2.0!',
      'fix-typo_v3',
      'CAMELCASEString',
      'mixed 123 with spaces',
      '你好 chinese',
      'emoji 🎉 test',
    ];
    for (const input of inputs) {
      const result = hashGoalDescription(input);
      expect(result).toMatch(/^[a-z0-9]*$/);
    }
  });

  test('output is never undefined or null', () => {
    expect(hashGoalDescription('')).not.toBeUndefined();
    expect(hashGoalDescription('')).not.toBeNull();
    expect(hashGoalDescription('valid')).not.toBeUndefined();
  });
});

describe('hashGoalDescription — purity and idempotency', () => {
  test('pure: same input produces identical output across calls', () => {
    const inputs = ['hello', 'Add Retry', '', '   ', '!@#', '你好'];
    for (const input of inputs) {
      const a = hashGoalDescription(input);
      const b = hashGoalDescription(input);
      expect(a).toBe(b);
    }
  });

  test('idempotent: hash(hash(x)) === hash(x)', () => {
    // The hash is in normal form — hashing again produces the same
    // output. This proves the algorithm converges.
    const inputs = [
      'hello',
      'Add Retry v2.0!',
      'fix-typo_v3',
      '',
      '   ',
      '!@#$',
      '你好 test',
    ];
    for (const input of inputs) {
      const once = hashGoalDescription(input);
      const twice = hashGoalDescription(once);
      expect(twice).toBe(once);
    }
  });

  test('hash does NOT mutate its input (strings are immutable anyway)', () => {
    // JS strings are immutable, but pinning that the function does
    // not attempt mutation or rely on shared state.
    const input = 'Add Retry';
    const original = input;
    hashGoalDescription(input);
    expect(input).toBe(original);
  });

  test('hash has no side effects on the retry counter Map', () => {
    // hashGoalDescription is read-only — it does not increment any
    // counter.
    const before = getRetryCount('Add Retry');
    hashGoalDescription('Add Retry');
    hashGoalDescription('Add Retry');
    hashGoalDescription('Add Retry');
    const after = getRetryCount('Add Retry');
    expect(after).toBe(before);
  });
});

describe('hashGoalDescription — normalization pipeline', () => {
  // Source: lowercase → replace(/[^a-z0-9]/g, '') → trim()
  // The trailing trim() is dead code: after stripping non-alphanumerics,
  // no whitespace remains.

  test('lowercase happens FIRST (before strip)', () => {
    // 'ABC' → lowercase → 'abc' → strip → 'abc' → trim → 'abc'.
    // If strip ran first (with case-sensitive [a-z0-9]), 'ABC' would
    // become '' (uppercase letters stripped). Pinning the actual order.
    expect(hashGoalDescription('ABC')).toBe('abc');
    expect(hashGoalDescription('HELLO')).toBe('hello');
  });

  test('strip removes whitespace (dead .trim() at the end)', () => {
    // The .trim() at the end is dead code — whitespace is already
    // removed by the /[^a-z0-9]/g replace. Pinning that the trailing
    // trim has no effect.
    expect(hashGoalDescription('  hello  ')).toBe('hello');
    expect(hashGoalDescription('a b c')).toBe('abc');
    expect(hashGoalDescription('\thello\n')).toBe('hello');
  });

  test('strip removes punctuation', () => {
    expect(hashGoalDescription('hello!')).toBe('hello');
    expect(hashGoalDescription('add-retry')).toBe('addretry');
    expect(hashGoalDescription('add.retry')).toBe('addretry');
    expect(hashGoalDescription('add_retry')).toBe('addretry');
    expect(hashGoalDescription('add@retry')).toBe('addretry');
    expect(hashGoalDescription('add+retry=more')).toBe('addretrymore');
  });

  test('strip removes unicode characters', () => {
    expect(hashGoalDescription('hello 你好 world')).toBe('helloworld');
    expect(hashGoalDescription('🎉party')).toBe('party');
    expect(hashGoalDescription('café')).toBe('caf'); // é is stripped
    expect(hashGoalDescription('naïve')).toBe('nave'); // ï is stripped
  });

  test('digits are preserved', () => {
    expect(hashGoalDescription('v2.0')).toBe('v20');
    expect(hashGoalDescription('version 123')).toBe('version123');
    expect(hashGoalDescription('0123456789')).toBe('0123456789');
  });

  test('mixed case + digits + punctuation', () => {
    expect(hashGoalDescription('Fix Bug #42!')).toBe('fixbug42');
    expect(hashGoalDescription('API/v3.14_final')).toBe('apiv314final');
  });
});

describe('hashGoalDescription — empty bucket collapse', () => {
  // Multiple surface forms hash to the same empty-string key.
  // They all share the same counter bucket.

  test('empty string → empty hash', () => {
    expect(hashGoalDescription('')).toBe('');
  });

  test('whitespace-only inputs → empty hash', () => {
    expect(hashGoalDescription(' ')).toBe('');
    expect(hashGoalDescription('  ')).toBe('');
    expect(hashGoalDescription('\t')).toBe('');
    expect(hashGoalDescription('\n')).toBe('');
    expect(hashGoalDescription(' \t\n ')).toBe('');
  });

  test('punctuation-only inputs → empty hash', () => {
    expect(hashGoalDescription('!')).toBe('');
    expect(hashGoalDescription('!@#$')).toBe('');
    expect(hashGoalDescription('.-_=+')).toBe('');
    expect(hashGoalDescription('...!!!')).toBe('');
  });

  test('unicode-only inputs → empty hash', () => {
    expect(hashGoalDescription('你好')).toBe('');
    expect(hashGoalDescription('🎉🎊')).toBe('');
    expect(hashGoalDescription('ΔΘΛ')).toBe(''); // Greek letters are stripped
  });

  test('empty / whitespace / punctuation share the SAME counter bucket', () => {
    // All three hash to ''. incrementing one increments all.
    incrementRetryCounter('');
    incrementRetryCounter('   ');
    expect(getRetryCount('!@#$')).toBe(2);
    expect(getRetryCount('')).toBe(2);
    expect(getRetryCount('   ')).toBe(2);
  });
});

describe('getRetryCount — read semantics', () => {
  test('returns 0 for unseen goals', () => {
    expect(getRetryCount('never seen')).toBe(0);
  });

  test('returns 0 for empty/whitespace/punctuation goals when nothing was incremented', () => {
    expect(getRetryCount('')).toBe(0);
    expect(getRetryCount('   ')).toBe(0);
    expect(getRetryCount('!@#$')).toBe(0);
  });

  test('read does NOT mutate the counter', () => {
    incrementRetryCounter('goal');
    const before = getRetryCount('goal');
    getRetryCount('goal');
    getRetryCount('goal');
    const after = getRetryCount('goal');
    expect(after).toBe(before);
  });

  test('hash-aliased goals share the counter', () => {
    incrementRetryCounter('Add Retry');
    incrementRetryCounter('add-retry');
    incrementRetryCounter('ADD RETRY!');
    // All three hash to 'addretry'. Counter should be 3.
    expect(getRetryCount('add retry')).toBe(3);
    expect(getRetryCount('Add-Retry')).toBe(3);
  });

  test('returns the correct count for multiple distinct goals', () => {
    incrementRetryCounter('goal A');
    incrementRetryCounter('goal A');
    incrementRetryCounter('goal A');
    incrementRetryCounter('goal B');
    incrementRetryCounter('goal C');
    incrementRetryCounter('goal C');

    expect(getRetryCount('goal A')).toBe(3);
    expect(getRetryCount('goal B')).toBe(1);
    expect(getRetryCount('goal C')).toBe(2);
    expect(getRetryCount('goal D')).toBe(0);
  });

  test('always returns a non-negative integer', () => {
    const goals = ['', 'abc', 'Add Retry', '!@#', '你好'];
    for (const g of goals) {
      const result = getRetryCount(g);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('incrementRetryCounter — increment semantics', () => {
  test('returns the NEW count (post-increment)', () => {
    expect(incrementRetryCounter('goal')).toBe(1); // was 0, now 1
    expect(incrementRetryCounter('goal')).toBe(2); // was 1, now 2
    expect(incrementRetryCounter('goal')).toBe(3);
  });

  test('increment is always +1 (never jumps)', () => {
    let prev = getRetryCount('goal');
    for (let i = 0; i < 10; i++) {
      const next = incrementRetryCounter('goal');
      expect(next).toBe(prev + 1);
      prev = next;
    }
  });

  test('counter is MONOTONICALLY NON-DECREASING within a session', () => {
    const counts: number[] = [];
    for (let i = 0; i < 5; i++) {
      counts.push(incrementRetryCounter('goal'));
    }
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]!).toBeGreaterThan(counts[i - 1]!);
    }
  });

  test('counter is UNBOUNDED (no wraparound or saturation)', () => {
    // Push past MAX_RETRY_ATTEMPTS * 10 to verify no wraparound.
    let last = 0;
    for (let i = 0; i < 50; i++) {
      last = incrementRetryCounter('stress test');
    }
    expect(last).toBe(50);
  });

  test('incrementing one goal does NOT affect another', () => {
    incrementRetryCounter('goal A');
    incrementRetryCounter('goal A');
    incrementRetryCounter('goal B');

    expect(getRetryCount('goal A')).toBe(2);
    expect(getRetryCount('goal B')).toBe(1);
    expect(getRetryCount('goal C')).toBe(0);
  });

  test('incrementing hash-aliased goals stacks on the same bucket', () => {
    incrementRetryCounter('Add Retry');
    incrementRetryCounter('add retry');
    incrementRetryCounter('ADD RETRY');
    incrementRetryCounter('add-retry!');
    // All four hash to 'addretry'.
    expect(getRetryCount('addretry')).toBe(4);
  });

  test('increment accepts empty/whitespace/unicode goals', () => {
    expect(() => incrementRetryCounter('')).not.toThrow();
    expect(() => incrementRetryCounter('   ')).not.toThrow();
    expect(() => incrementRetryCounter('你好')).not.toThrow();
  });

  test('increment always returns a positive integer', () => {
    const goals = ['', 'abc', '!@#', '你好'];
    for (const g of goals) {
      const result = incrementRetryCounter(g);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThan(0);
    }
  });
});

describe('isRetryExhausted — strict greater-than comparison', () => {
  // CRITICAL: uses `>` not `>=`. At count == MAX, returns false.

  test('comparison operator is strict > (not >=)', () => {
    // Drive to exactly MAX_RETRY_ATTEMPTS.
    for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
      incrementRetryCounter('goal');
    }
    // count == MAX. With `>`, this is false. With `>=`, this would be true.
    expect(isRetryExhausted('goal')).toBe(false);
  });

  test('returns true only when count > MAX_RETRY_ATTEMPTS', () => {
    for (let i = 0; i < MAX_RETRY_ATTEMPTS + 1; i++) {
      incrementRetryCounter('goal');
    }
    expect(isRetryExhausted('goal')).toBe(true);
  });

  test('boundary: count == 3 → false; count == 4 → true', () => {
    incrementRetryCounter('g');
    incrementRetryCounter('g');
    incrementRetryCounter('g');
    expect(getRetryCount('g')).toBe(3);
    expect(isRetryExhausted('g')).toBe(false);

    incrementRetryCounter('g');
    expect(getRetryCount('g')).toBe(4);
    expect(isRetryExhausted('g')).toBe(true);
  });

  test('returns false for never-incremented goal', () => {
    expect(isRetryExhausted('untouched')).toBe(false);
  });

  test('returns true for very high counts', () => {
    for (let i = 0; i < 100; i++) {
      incrementRetryCounter('g');
    }
    expect(isRetryExhausted('g')).toBe(true);
  });

  test('works with hash-aliased goals', () => {
    // Incrementing under different surface forms still exhausts.
    incrementRetryCounter('Add Retry');
    incrementRetryCounter('add retry');
    incrementRetryCounter('ADD RETRY');
    expect(isRetryExhausted('add-retry')).toBe(false); // count == 3

    incrementRetryCounter('addretry!');
    expect(isRetryExhausted('Add Retry')).toBe(true); // count == 4
  });

  test('always returns a boolean', () => {
    const goals = ['', 'abc', '你好', '!@#'];
    for (const g of goals) {
      const result = isRetryExhausted(g);
      expect(typeof result).toBe('boolean');
    }
  });
});

describe('MAX_RETRY_ATTEMPTS — constant value', () => {
  test('is exactly 3', () => {
    expect(MAX_RETRY_ATTEMPTS).toBe(3);
  });

  test('is a positive integer', () => {
    expect(Number.isInteger(MAX_RETRY_ATTEMPTS)).toBe(true);
    expect(MAX_RETRY_ATTEMPTS).toBeGreaterThan(0);
  });

  test('changing this constant would shift the boundary', () => {
    // Documenting the contract: the boundary tests in this file
    // assume MAX == 3. If MAX changes, those tests must update too.
    // This test exists to flag the dependency.
    expect(MAX_RETRY_ATTEMPTS).toBe(3);
  });
});

describe('clearRetryCounters — state reset', () => {
  test('empties all counters', () => {
    incrementRetryCounter('a');
    incrementRetryCounter('b');
    incrementRetryCounter('c');
    expect(getRetryCount('a')).toBe(1);

    clearRetryCounters();

    expect(getRetryCount('a')).toBe(0);
    expect(getRetryCount('b')).toBe(0);
    expect(getRetryCount('c')).toBe(0);
  });

  test('idempotent on empty Map', () => {
    clearRetryCounters();
    clearRetryCounters();
    expect(getRetryCount('any')).toBe(0);
  });

  test('after clear, isRetryExhausted returns false', () => {
    for (let i = 0; i < 10; i++) {
      incrementRetryCounter('g');
    }
    expect(isRetryExhausted('g')).toBe(true);
    clearRetryCounters();
    expect(isRetryExhausted('g')).toBe(false);
  });

  test('return value is undefined (void function)', () => {
    expect(clearRetryCounters()).toBeUndefined();
  });

  test('after clear, incrementRetryCounter starts fresh from 1', () => {
    incrementRetryCounter('g');
    incrementRetryCounter('g');
    clearRetryCounters();
    expect(incrementRetryCounter('g')).toBe(1);
  });
});

describe('module-level state — sharing and isolation', () => {
  // The Map is module-level. State persists across calls in the same
  // module instance. beforeEach(clearRetryCounters) is mandatory.

  test('state persists across calls within the same test', () => {
    incrementRetryCounter('persistent');
    expect(getRetryCount('persistent')).toBe(1);
    incrementRetryCounter('persistent');
    expect(getRetryCount('persistent')).toBe(2);
  });

  test('beforeEach isolation: previous test state is cleared', () => {
    // This test runs in isolation. Pinning that beforeEach cleared state.
    expect(getRetryCount('any')).toBe(0);
  });
});
