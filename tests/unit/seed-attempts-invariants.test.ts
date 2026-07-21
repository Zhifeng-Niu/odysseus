import { describe, test, expect, beforeEach } from 'vitest';
import {
  MAX_SEED_ATTEMPTS,
  hashGoal,
  getSeedAttemptCount,
  incrementSeedAttempt,
  isSeedExhausted,
  clearSeedAttempts,
} from '../../src/cerebellum/seedAttempts.js';
import {
  hashGoalDescription,
  getRetryCount,
  incrementRetryCounter,
  isRetryExhausted,
  clearRetryCounters,
  MAX_RETRY_ATTEMPTS,
} from '../../src/cerebellum/retry-counter.js';

/**
 * seedAttempts — structural invariants and cross-module parity.
 *
 * seedAttempts.test.ts covers behavior — normalization, threshold,
 * counter read/increment/reset (24 tests). This file pins the
 * structural contracts a refactor could silently break, with
 * particular focus on the ONE behavioral divergence from its
 * sister module retry-counter:
 *
 *   - HASH PARITY WITH retry-counter. The two modules MUST use the
 *     same hash function. If hashGoal and hashGoalDescription drift,
 *     the enqueue-side and dequeue-side counters see different goal
 *     spaces, and the bounded-retry contract silently breaks: a
 *     goal enqueued 3 times might not be recognized as exhausted
 *     by the seed-side counter.
 *
 *   - >= COMPARISON OPERATOR (NOT >). seedAnswers isSeedExhausted
 *     returns true AT count == MAX_SEED_ATTEMPTS (3). This is the
 *     opposite of retry-counter's isRetryExhausted which returns
 *     false at count == MAX_RETRY_ATTEMPTS. The divergence is
 *     load-bearing and documented. Changing >= to > here would
 *     silently allow an extra dequeue attempt.
 *
 *   - CONSTANT PARITY. MAX_SEED_ATTEMPTS === MAX_RETRY_ATTEMPTS === 3.
 *     Both thresholds move together. A refactor that changes one
 *     must change the other.
 *
 *   - STATE ISOLATION. seedAttempts and retry-counter use SEPARATE
 *     in-memory Maps. Clearing one must not affect the other.
 *
 *   - HASH PIPELINE. hashGoal is identical to hashGoalDescription:
 *     lowercase → strip /[^a-z0-9]/ → trim (dead). All pipeline
 *     contracts from retry-counter-invariants apply equally here.
 *
 *   - COUNTER MONOTONICITY. incrementSeedAttempt always returns
 *     prev + 1. Unbounded growth.
 *
 *   - EMPTY BUCKET COLLAPSE. Empty/whitespace/punctuation inputs
 *     all hash to '' and share a counter bucket.
 *
 * Each test below pins one slice of these contracts.
 */

beforeEach(() => {
  clearSeedAttempts();
  clearRetryCounters();
});

// ---------------------------------------------------------------------------
// CROSS-MODULE PARITY: hashGoal MUST equal hashGoalDescription
// ---------------------------------------------------------------------------

describe('hashGoal — parity with retry-counter:hashGoalDescription', () => {
  // The two hash functions MUST produce identical output. They're
  // documented as "intentionally identical" in both source files.
  // Drift would break the bounded-retry contract.

  test('produces identical output across a wide input corpus', () => {
    const samples = [
      'add retry to llm provider',
      'Add Retry',
      'fix-typo-v2',
      'unicode 你好 test',
      '',
      '   ',
      '!!!',
      'mixed CASE 123',
      'very-long-goal-description-with-lots-of-context-and-punctuation!',
      '🎉 emoji test',
      'café',
      'naïve',
      '你好',
      '12345',
      'snake_case',
      'kebab-case',
      'PascalCase',
      'SCREAMING_CASE',
    ];
    for (const s of samples) {
      expect(hashGoal(s)).toBe(hashGoalDescription(s));
    }
  });

  test('both functions return empty string for the same inputs', () => {
    const empties = ['', '   ', '!@#$', '你好', '🎉', '\t\n'];
    for (const e of empties) {
      expect(hashGoal(e)).toBe('');
      expect(hashGoalDescription(e)).toBe('');
      expect(hashGoal(e)).toBe(hashGoalDescription(e));
    }
  });
});

describe('MAX_SEED_ATTEMPTS — constant parity with MAX_RETRY_ATTEMPTS', () => {
  // Both thresholds are documented as 3. They MUST stay in sync.

  test('MAX_SEED_ATTEMPTS === MAX_RETRY_ATTEMPTS', () => {
    expect(MAX_SEED_ATTEMPTS).toBe(MAX_RETRY_ATTEMPTS);
  });

  test('both are exactly 3', () => {
    expect(MAX_SEED_ATTEMPTS).toBe(3);
    expect(MAX_RETRY_ATTEMPTS).toBe(3);
  });

  test('both are positive integers', () => {
    expect(Number.isInteger(MAX_SEED_ATTEMPTS)).toBe(true);
    expect(MAX_SEED_ATTEMPTS).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_RETRY_ATTEMPTS)).toBe(true);
    expect(MAX_RETRY_ATTEMPTS).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// THE ONE DIVERGENCE: >= here vs > in retry-counter
// ---------------------------------------------------------------------------

describe('isSeedExhausted — uses >= (NOT >), diverges from retry-counter', () => {
  // This is THE behavioral divergence between the two modules.
  // At count == MAX (3):
  //   - seedAttempts: returns true  (>= comparison)
  //   - retry-counter: returns false (> comparison)
  //
  // The asymmetry is load-bearing — see source docstrings. Both
  // registries gate the same MAX value but answer differently at
  // the threshold. Pinning both sides of the divergence.

  test('at count == 3: seedExhausted=true, retryExhausted=false', () => {
    // Drive both registries to count == 3.
    for (let i = 0; i < MAX_SEED_ATTEMPTS; i++) {
      incrementSeedAttempt('shared-key');
    }
    for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
      incrementRetryCounter('shared-key');
    }

    expect(getSeedAttemptCount('shared-key')).toBe(3);
    expect(getRetryCount('shared-key')).toBe(3);

    // Same count (3), opposite verdicts.
    expect(isSeedExhausted('shared-key')).toBe(true); // >=
    expect(isRetryExhausted('shared-key')).toBe(false); // >
  });

  test('at count == 2: both registries return false', () => {
    incrementSeedAttempt('g');
    incrementSeedAttempt('g');
    incrementRetryCounter('g');
    incrementRetryCounter('g');

    expect(isSeedExhausted('g')).toBe(false);
    expect(isRetryExhausted('g')).toBe(false);
  });

  test('at count == 4: both registries return true', () => {
    for (let i = 0; i < 4; i++) {
      incrementSeedAttempt('g');
      incrementRetryCounter('g');
    }
    expect(isSeedExhausted('g')).toBe(true);
    expect(isRetryExhausted('g')).toBe(true);
  });

  test('boundary: seedExhausted flips at exactly MAX_SEED_ATTEMPTS', () => {
    incrementSeedAttempt('g');
    incrementSeedAttempt('g');
    expect(isSeedExhausted('g')).toBe(false); // count == 2

    incrementSeedAttempt('g');
    expect(isSeedExhausted('g')).toBe(true); // count == 3 — flipped
  });

  test('returns true for very high counts', () => {
    for (let i = 0; i < 100; i++) {
      incrementSeedAttempt('g');
    }
    expect(isSeedExhausted('g')).toBe(true);
  });

  test('returns false for never-incremented goal', () => {
    expect(isSeedExhausted('untouched')).toBe(false);
  });

  test('always returns a boolean', () => {
    const goals = ['', 'abc', '你好', '!@#'];
    for (const g of goals) {
      const result = isSeedExhausted(g);
      expect(typeof result).toBe('boolean');
    }
  });
});

// ---------------------------------------------------------------------------
// STATE ISOLATION between seedAttempts and retry-counter
// ---------------------------------------------------------------------------

describe('state isolation — separate Maps from retry-counter', () => {
  // The two registries use SEPARATE in-memory Maps. If a refactor
  // "harmonizes" them into a shared Map (tempting since they have
  // identical keys), the enqueue and dequeue counts would collide.

  test('incrementing seedAttempts does NOT affect retry-counter', () => {
    incrementSeedAttempt('shared-key');
    incrementSeedAttempt('shared-key');
    expect(getSeedAttemptCount('shared-key')).toBe(2);
    expect(getRetryCount('shared-key')).toBe(0);
  });

  test('incrementing retry-counter does NOT affect seedAttempts', () => {
    incrementRetryCounter('shared-key');
    incrementRetryCounter('shared-key');
    expect(getRetryCount('shared-key')).toBe(2);
    expect(getSeedAttemptCount('shared-key')).toBe(0);
  });

  test('clearSeedAttempts does NOT affect retry-counter state', () => {
    incrementSeedAttempt('shared-key');
    incrementRetryCounter('shared-key');

    clearSeedAttempts();

    expect(getSeedAttemptCount('shared-key')).toBe(0);
    expect(getRetryCount('shared-key')).toBe(1);
  });

  test('clearRetryCounters does NOT affect seedAttempts state', () => {
    incrementSeedAttempt('shared-key');
    incrementRetryCounter('shared-key');

    clearRetryCounters();

    expect(getSeedAttemptCount('shared-key')).toBe(1);
    expect(getRetryCount('shared-key')).toBe(0);
  });

  test('divergent counts: seed=3 (exhausted), retry=2 (allowed)', () => {
    // Realistic scenario: a goal dequeued 3 times but only
    // enqueued twice (e.g. one enqueue spawned multiple dequeues
    // via some past mechanism, or seedAttempt was bumped manually).
    for (let i = 0; i < 3; i++) incrementSeedAttempt('g');
    for (let i = 0; i < 2; i++) incrementRetryCounter('g');

    expect(isSeedExhausted('g')).toBe(true);
    expect(isRetryExhausted('g')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hashGoal pipeline contracts (mirrors retry-counter invariants)
// ---------------------------------------------------------------------------

describe('hashGoal — output type and basic shape', () => {
  test('always returns a string for string inputs', () => {
    const inputs = ['', '   ', 'hello', 'Add Retry', '123', '!@#$%', '你好'];
    for (const input of inputs) {
      const result = hashGoal(input);
      expect(typeof result).toBe('string');
    }
  });

  test('throws on null/undefined (no type guard in source)', () => {
    expect(() => hashGoal(null as unknown as string)).toThrow(TypeError);
    expect(() => hashGoal(undefined as unknown as string)).toThrow(TypeError);
  });

  test('output contains ONLY lowercase ascii letters and digits', () => {
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
      expect(hashGoal(input)).toMatch(/^[a-z0-9]*$/);
    }
  });
});

describe('hashGoal — purity and idempotency', () => {
  test('pure: same input produces identical output across calls', () => {
    const inputs = ['hello', 'Add Retry', '', '   ', '!@#', '你好'];
    for (const input of inputs) {
      const a = hashGoal(input);
      const b = hashGoal(input);
      expect(a).toBe(b);
    }
  });

  test('idempotent: hash(hash(x)) === hash(x)', () => {
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
      const once = hashGoal(input);
      const twice = hashGoal(once);
      expect(twice).toBe(once);
    }
  });

  test('hash does NOT mutate state (no counter side-effect)', () => {
    const before = getSeedAttemptCount('Add Retry');
    hashGoal('Add Retry');
    hashGoal('Add Retry');
    const after = getSeedAttemptCount('Add Retry');
    expect(after).toBe(before);
  });
});

describe('hashGoal — normalization pipeline order', () => {
  // Pipeline: lowercase → strip /[^a-z0-9]/ → trim (dead).

  test('lowercase happens FIRST (before strip)', () => {
    // If strip ran first with case-sensitive [a-z0-9], 'ABC' would
    // become ''. Pinning lowercase-first.
    expect(hashGoal('ABC')).toBe('abc');
    expect(hashGoal('HELLO')).toBe('hello');
  });

  test('strip removes whitespace (trailing .trim() is dead code)', () => {
    expect(hashGoal('  hello  ')).toBe('hello');
    expect(hashGoal('a b c')).toBe('abc');
    expect(hashGoal('\thello\n')).toBe('hello');
  });

  test('strip removes punctuation', () => {
    expect(hashGoal('hello!')).toBe('hello');
    expect(hashGoal('add-retry')).toBe('addretry');
    expect(hashGoal('add.retry')).toBe('addretry');
    expect(hashGoal('add_retry')).toBe('addretry');
  });

  test('strip removes unicode characters (not transliterated)', () => {
    expect(hashGoal('hello 你好 world')).toBe('helloworld');
    expect(hashGoal('🎉party')).toBe('party');
    expect(hashGoal('café')).toBe('caf'); // é stripped
    expect(hashGoal('naïve')).toBe('nave'); // ï stripped
  });

  test('digits are preserved', () => {
    expect(hashGoal('v2.0')).toBe('v20');
    expect(hashGoal('version 123')).toBe('version123');
    expect(hashGoal('0123456789')).toBe('0123456789');
  });
});

describe('hashGoal — empty bucket collapse', () => {
  // Empty/whitespace/punctuation/unicode-only inputs all hash to ''.

  test('empty string → empty hash', () => {
    expect(hashGoal('')).toBe('');
  });

  test('whitespace-only inputs → empty hash', () => {
    expect(hashGoal(' ')).toBe('');
    expect(hashGoal('  ')).toBe('');
    expect(hashGoal('\t')).toBe('');
    expect(hashGoal('\n')).toBe('');
    expect(hashGoal(' \t\n ')).toBe('');
  });

  test('punctuation-only inputs → empty hash', () => {
    expect(hashGoal('!')).toBe('');
    expect(hashGoal('!@#$')).toBe('');
    expect(hashGoal('.-_=+')).toBe('');
  });

  test('unicode-only inputs → empty hash', () => {
    expect(hashGoal('你好')).toBe('');
    expect(hashGoal('🎉🎊')).toBe('');
    expect(hashGoal('ΔΘΛ')).toBe(''); // Greek letters stripped
  });

  test('empty / whitespace / punctuation / unicode share counter bucket', () => {
    incrementSeedAttempt('');
    incrementSeedAttempt('   ');
    incrementSeedAttempt('!@#$');
    expect(getSeedAttemptCount('你好')).toBe(3); // all four hash to ''
  });
});

// ---------------------------------------------------------------------------
// Counter semantics
// ---------------------------------------------------------------------------

describe('getSeedAttemptCount — read semantics', () => {
  test('returns 0 for unseen goals', () => {
    expect(getSeedAttemptCount('never seen')).toBe(0);
  });

  test('returns 0 for empty/whitespace goals when nothing incremented', () => {
    expect(getSeedAttemptCount('')).toBe(0);
    expect(getSeedAttemptCount('   ')).toBe(0);
    expect(getSeedAttemptCount('!@#$')).toBe(0);
  });

  test('read does NOT mutate the counter', () => {
    incrementSeedAttempt('goal');
    const before = getSeedAttemptCount('goal');
    getSeedAttemptCount('goal');
    getSeedAttemptCount('goal');
    const after = getSeedAttemptCount('goal');
    expect(after).toBe(before);
  });

  test('hash-aliased goals share the counter', () => {
    incrementSeedAttempt('Add Retry');
    incrementSeedAttempt('add-retry');
    incrementSeedAttempt('ADD RETRY!');
    expect(getSeedAttemptCount('add retry')).toBe(3);
  });

  test('always returns a non-negative integer', () => {
    const goals = ['', 'abc', 'Add Retry', '!@#', '你好'];
    for (const g of goals) {
      const result = getSeedAttemptCount(g);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('incrementSeedAttempt — increment semantics', () => {
  test('returns the NEW count (post-increment)', () => {
    expect(incrementSeedAttempt('goal')).toBe(1);
    expect(incrementSeedAttempt('goal')).toBe(2);
    expect(incrementSeedAttempt('goal')).toBe(3);
  });

  test('increment is always +1', () => {
    let prev = getSeedAttemptCount('goal');
    for (let i = 0; i < 10; i++) {
      const next = incrementSeedAttempt('goal');
      expect(next).toBe(prev + 1);
      prev = next;
    }
  });

  test('counter is MONOTONICALLY NON-DECREASING', () => {
    const counts: number[] = [];
    for (let i = 0; i < 5; i++) {
      counts.push(incrementSeedAttempt('goal'));
    }
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]!).toBeGreaterThan(counts[i - 1]!);
    }
  });

  test('counter is UNBOUNDED (no wraparound)', () => {
    let last = 0;
    for (let i = 0; i < 50; i++) {
      last = incrementSeedAttempt('stress test');
    }
    expect(last).toBe(50);
  });

  test('incrementing one goal does NOT affect another', () => {
    incrementSeedAttempt('goal A');
    incrementSeedAttempt('goal A');
    incrementSeedAttempt('goal B');

    expect(getSeedAttemptCount('goal A')).toBe(2);
    expect(getSeedAttemptCount('goal B')).toBe(1);
    expect(getSeedAttemptCount('goal C')).toBe(0);
  });

  test('hash-aliased goals stack on the same bucket', () => {
    incrementSeedAttempt('Add Retry');
    incrementSeedAttempt('add retry');
    incrementSeedAttempt('ADD RETRY');
    incrementSeedAttempt('add-retry!');
    expect(getSeedAttemptCount('addretry')).toBe(4);
  });

  test('accepts empty/whitespace/unicode goals without throwing', () => {
    expect(() => incrementSeedAttempt('')).not.toThrow();
    expect(() => incrementSeedAttempt('   ')).not.toThrow();
    expect(() => incrementSeedAttempt('你好')).not.toThrow();
  });

  test('always returns a positive integer', () => {
    const goals = ['', 'abc', '!@#', '你好'];
    for (const g of goals) {
      const result = incrementSeedAttempt(g);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// clearSeedAttempts — state reset
// ---------------------------------------------------------------------------

describe('clearSeedAttempts — state reset', () => {
  test('empties all counters', () => {
    incrementSeedAttempt('a');
    incrementSeedAttempt('b');
    incrementSeedAttempt('c');
    expect(getSeedAttemptCount('a')).toBe(1);

    clearSeedAttempts();

    expect(getSeedAttemptCount('a')).toBe(0);
    expect(getSeedAttemptCount('b')).toBe(0);
    expect(getSeedAttemptCount('c')).toBe(0);
  });

  test('idempotent on empty Map', () => {
    clearSeedAttempts();
    clearSeedAttempts();
    expect(getSeedAttemptCount('any')).toBe(0);
  });

  test('after clear, isSeedExhausted returns false', () => {
    for (let i = 0; i < 10; i++) {
      incrementSeedAttempt('g');
    }
    expect(isSeedExhausted('g')).toBe(true);
    clearSeedAttempts();
    expect(isSeedExhausted('g')).toBe(false);
  });

  test('return value is undefined (void function)', () => {
    expect(clearSeedAttempts()).toBeUndefined();
  });

  test('after clear, incrementSeedAttempt starts fresh from 1', () => {
    incrementSeedAttempt('g');
    incrementSeedAttempt('g');
    clearSeedAttempts();
    expect(incrementSeedAttempt('g')).toBe(1);
  });
});

describe('module-level state — sharing and isolation', () => {
  test('state persists across calls within a single test', () => {
    incrementSeedAttempt('persistent');
    expect(getSeedAttemptCount('persistent')).toBe(1);
    incrementSeedAttempt('persistent');
    expect(getSeedAttemptCount('persistent')).toBe(2);
  });

  test('beforeEach isolation: previous test state is cleared', () => {
    expect(getSeedAttemptCount('any')).toBe(0);
  });
});
