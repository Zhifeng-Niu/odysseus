import { describe, test, expect, beforeEach } from 'vitest';
import {
  MAX_SEED_ATTEMPTS,
  hashGoal,
  getSeedAttemptCount,
  incrementSeedAttempt,
  isSeedExhausted,
  clearSeedAttempts,
} from '../../src/cerebellum/seedAttempts.js';

/**
 * seedAttempts.ts — in-memory registry tracking how many times each
 * goal has been dequeued for waypoint execution. After MAX_SEED_ATTEMPTS
 * the goal is permanently blocked from re-seeding (the dedup gate in
 * enqueueBacklog returns a phantom).
 *
 * Iteration 25 — the module had no dedicated test file. Contract
 * exercised only indirectly via backlog.test.ts. These tests pin the
 * normalization rules (which determine what counts as "the same goal"),
 * the exhaustion threshold semantics, and the read/increment/reset
 * surface that backlog.ts depends on.
 */

describe('seedAttempts — MAX_SEED_ATTEMPTS constant', () => {
  test('exhaustion threshold is 3', () => {
    // This number is load-bearing: it's the threshold after which
    // enqueueBacklog starts returning phantom items for autonomous
    // origins. Changing it without updating backlog.ts dedup semantics
    // would change agent behavior under repeated goal seeding.
    expect(MAX_SEED_ATTEMPTS).toBe(3);
  });
});

describe('seedAttempts — hashGoal normalization', () => {
  test('lowercases the input', () => {
    expect(hashGoal('AddRetry')).toBe(hashGoal('addretry'));
  });

  test('strips non-alphanumeric characters', () => {
    // Punctuation, whitespace, symbols — all stripped. This is what
    // lets "add retry" and "add-retry!" collide on the same counter.
    expect(hashGoal('add retry!')).toBe(hashGoal('addretry'));
    expect(hashGoal('add-retry_v2.0')).toBe(hashGoal('addretryv20'));
    expect(hashGoal('  add retry  ')).toBe(hashGoal('addretry'));
  });

  test('normalizes unicode-adjacent input only by lowercase + strip', () => {
    // The hash is intentionally aggressive about ASCII alphanumerics.
    // Non-ASCII letters are stripped (not folded), which is a known
    // limitation — pinning here so a future change to unicode-aware
    // hashing is a conscious decision.
    expect(hashGoal('Add 你好 retry')).toBe(hashGoal('addretry'));
  });

  test('empty string hashes to empty string', () => {
    // Edge case: the dedup gate should still produce *some* key for
    // empty input. The Map treats '' as a valid key, so an empty-goal
    // enqueue would share state with every other empty-goal enqueue —
    // but enqueueBacklog rejects empty goals upstream, so this is a
    // theoretical concern, not a live one.
    expect(hashGoal('')).toBe('');
    expect(hashGoal('   ')).toBe('');
    expect(hashGoal('!@#$')).toBe('');
  });
});

describe('seedAttempts — counter read/increment', () => {
  beforeEach(() => {
    clearSeedAttempts();
  });

  test('getSeedAttemptCount returns 0 for unseen goals', () => {
    expect(getSeedAttemptCount('never seen')).toBe(0);
  });

  test('incrementSeedAttempt returns the new count', () => {
    // The return value is part of the contract — backlog.ts doesn't
    // currently use it, but callers may rely on it for atomic "is
    // this the first attempt?" checks.
    expect(incrementSeedAttempt('goal a')).toBe(1);
    expect(incrementSeedAttempt('goal a')).toBe(2);
    expect(incrementSeedAttempt('goal a')).toBe(3);
  });

  test('counters are independent per normalized goal', () => {
    incrementSeedAttempt('Add Retry');
    incrementSeedAttempt('Add Retry');
    incrementSeedAttempt('different goal');

    // "Add Retry" and "add retry" share a counter via hashGoal.
    expect(getSeedAttemptCount('add retry')).toBe(2);
    expect(getSeedAttemptCount('different goal')).toBe(1);
  });
});

describe('seedAttempts — isSeedExhausted threshold', () => {
  beforeEach(() => {
    clearSeedAttempts();
  });

  test('returns false below MAX_SEED_ATTEMPTS', () => {
    incrementSeedAttempt('g');
    expect(isSeedExhausted('g')).toBe(false);
    incrementSeedAttempt('g');
    expect(isSeedExhausted('g')).toBe(false);
  });

  test('returns true AT MAX_SEED_ATTEMPTS (>=, not >)', () => {
    // This is the off-by-one that matters: count == MAX returns true.
    // If anyone changes the comparison to >, the third enqueue would
    // silently succeed when it should have been blocked.
    incrementSeedAttempt('g');
    incrementSeedAttempt('g');
    incrementSeedAttempt('g');
    expect(isSeedExhausted('g')).toBe(true);
  });

  test('returns true above MAX_SEED_ATTEMPTS', () => {
    // Counter drift safety — once blocked, stays blocked.
    for (let i = 0; i < MAX_SEED_ATTEMPTS + 2; i++) {
      incrementSeedAttempt('g');
    }
    expect(isSeedExhausted('g')).toBe(true);
  });

  test('returns false for never-incremented goal', () => {
    expect(isSeedExhausted('untouched')).toBe(false);
  });
});

describe('seedAttempts — clearSeedAttempts (test helper)', () => {
  test('clears all counters', () => {
    incrementSeedAttempt('a');
    incrementSeedAttempt('b');
    expect(getSeedAttemptCount('a')).toBe(1);

    clearSeedAttempts();

    expect(getSeedAttemptCount('a')).toBe(0);
    expect(getSeedAttemptCount('b')).toBe(0);
  });
});
