import { describe, test, expect, beforeEach } from 'vitest';
import {
  MAX_RETRY_ATTEMPTS,
  hashGoalDescription,
  getRetryCount,
  incrementRetryCounter,
  isRetryExhausted,
  clearRetryCounters,
} from '../../src/cerebellum/retry-counter.js';
import {
  MAX_SEED_ATTEMPTS,
  hashGoal as hashSeedGoal,
  getSeedAttemptCount,
  incrementSeedAttempt,
  isSeedExhausted,
  clearSeedAttempts,
} from '../../src/cerebellum/seedAttempts.js';

/**
 * retry-counter.ts — in-memory registry tracking how many times each
 * goal has been ENQUEUED. After MAX_RETRY_ATTEMPTS enqueues, the
 * enqueueBacklog gate blocks further re-enqueues.
 *
 * Iteration 57 — the module had no dedicated test file. Mirror of
 * seedAttempts.test.ts (Iteration 25) shape, because the two modules
 * are intentionally symmetric: retry-counter is the enqueue-side
 * counterpart to the dequeue-side seedAttempts. Both use the same
 * hashGoal normalization (pinned by the cross-module parity test
 * below) and both gate on MAX_*_ATTEMPTS=3, but with a DIFFERENT
 * comparison operator (retry-counter uses `>`, seedAttempts uses `>=`).
 *
 * That difference is load-bearing: it is the only place the two
 * registries diverge semantically. If a future refactor "harmonizes"
 * the two operators, agent behavior under repeated goal seeding
 * silently changes. The threshold tests below pin the divergence.
 */

describe('retry-counter — MAX_RETRY_ATTEMPTS constant', () => {
  test('exhaustion threshold is 3', () => {
    // Mirrors MAX_SEED_ATTEMPTS=3 by design — both registries gate
    // the same conceptual budget. Changing one without the other
    // would create asymmetry in the enqueue/dequeue pressure balance.
    expect(MAX_RETRY_ATTEMPTS).toBe(3);
  });
});

describe('retry-counter — hashGoalDescription normalization', () => {
  test('lowercases the input', () => {
    expect(hashGoalDescription('AddRetry')).toBe(
      hashGoalDescription('addretry'),
    );
  });

  test('strips non-alphanumeric characters', () => {
    expect(hashGoalDescription('add retry!')).toBe(
      hashGoalDescription('addretry'),
    );
    expect(hashGoalDescription('add-retry_v2.0')).toBe(
      hashGoalDescription('addretryv20'),
    );
    expect(hashGoalDescription('  add retry  ')).toBe(
      hashGoalDescription('addretry'),
    );
  });

  test('normalizes unicode-adjacent input only by lowercase + strip', () => {
    // Non-ASCII letters are stripped (not folded). Same limitation as
    // seedAttempts.ts:hashGoal — pinned here so unicode-aware hashing
    // would be a conscious change in both modules.
    expect(hashGoalDescription('Add 你好 retry')).toBe(
      hashGoalDescription('addretry'),
    );
  });

  test('empty string hashes to empty string', () => {
    expect(hashGoalDescription('')).toBe('');
    expect(hashGoalDescription('   ')).toBe('');
    expect(hashGoalDescription('!@#$')).toBe('');
  });
});

describe('retry-counter — parity with seedAttempts:hashGoal', () => {
  // Iteration 45 docstring: "The hash is identical to
  // seedAttempts.ts:hashGoal by design — both registries see the same
  // goal space." If the two hash functions ever drift, a goal that
  // was enqueued 3 times may not be recognized as the same goal by
  // the dequeue-side counter, breaking the bounded-retry contract.
  test('produces identical keys to seedAttempts:hashGoal', () => {
    const samples = [
      'add retry to llm provider',
      'Add Retry',
      'fix-typo-v2',
      'unicode 你好 test',
      '',
      '   ',
      '!!!',
      'mixed CASE 123',
    ];
    for (const s of samples) {
      expect(hashGoalDescription(s)).toBe(hashSeedGoal(s));
    }
  });
});

describe('retry-counter — counter read/increment', () => {
  beforeEach(() => {
    clearRetryCounters();
  });

  test('getRetryCount returns 0 for unseen goals', () => {
    expect(getRetryCount('never seen')).toBe(0);
  });

  test('incrementRetryCounter returns the new count', () => {
    expect(incrementRetryCounter('goal a')).toBe(1);
    expect(incrementRetryCounter('goal a')).toBe(2);
    expect(incrementRetryCounter('goal a')).toBe(3);
  });

  test('counters are independent per normalized goal', () => {
    incrementRetryCounter('Add Retry');
    incrementRetryCounter('Add Retry');
    incrementRetryCounter('different goal');

    expect(getRetryCount('add retry')).toBe(2);
    expect(getRetryCount('different goal')).toBe(1);
  });
});

describe('retry-counter — isRetryExhausted threshold (uses `>`, not `>=`)', () => {
  // CRITICAL: retry-counter uses `count > MAX` (strict greater-than),
  // while seedAttempts uses `count >= MAX`. The off-by-one is
  // intentional and load-bearing:
  //   - seedAttempts: 3 dequeues = exhausted (block the 3rd dequeue)
  //   - retry-counter: 3 enqueues still allowed, 4th is blocked
  //
  // This asymmetry exists because enqueue happens BEFORE execution.
  // Allowing 3 enqueues gives the agent up to 3 attempts at the same
  // goal. Changing `>` to `>=` would block the 3rd enqueue, reducing
  // the agent to 2 attempts and silently changing voyage behavior.
  beforeEach(() => {
    clearRetryCounters();
  });

  test('returns false AT MAX_RETRY_ATTEMPTS (count == 3 still allowed)', () => {
    // This is the divergence from seedAttempts — same count (3),
    // opposite result. seedAttempts would return true here.
    incrementRetryCounter('g');
    incrementRetryCounter('g');
    incrementRetryCounter('g');
    expect(isRetryExhausted('g')).toBe(false);
  });

  test('returns true ABOVE MAX_RETRY_ATTEMPTS (count == 4 blocked)', () => {
    for (let i = 0; i < MAX_RETRY_ATTEMPTS + 1; i++) {
      incrementRetryCounter('g');
    }
    expect(isRetryExhausted('g')).toBe(true);
  });

  test('returns true for count well above MAX', () => {
    for (let i = 0; i < MAX_RETRY_ATTEMPTS + 5; i++) {
      incrementRetryCounter('g');
    }
    expect(isRetryExhausted('g')).toBe(true);
  });

  test('returns false for never-incremented goal', () => {
    expect(isRetryExhausted('untouched')).toBe(false);
  });
});

describe('retry-counter — clearRetryCounters (test helper)', () => {
  test('clears all counters', () => {
    incrementRetryCounter('a');
    incrementRetryCounter('b');
    expect(getRetryCount('a')).toBe(1);

    clearRetryCounters();

    expect(getRetryCount('a')).toBe(0);
    expect(getRetryCount('b')).toBe(0);
  });
});

describe('retry-counter — isolation from seedAttempts state', () => {
  // The two registries use SEPARATE in-memory Maps. Clearing one must
  // not affect the other. If a future refactor "harmonizes" them into
  // a shared map (tempting since they have identical keys), the
  // enqueue and dequeue counts would collide and the bounded-retry
  // contract breaks.
  test('clearRetryCounters does not affect seedAttempts state', () => {
    clearRetryCounters();
    clearSeedAttempts();

    incrementRetryCounter('shared-key');
    expect(getRetryCount('shared-key')).toBe(1);

    // seedAttempts has its own counter for the same key.
    expect(getSeedAttemptCount('shared-key')).toBe(0);

    // Clearing retry-counter leaves seedAttempts untouched.
    clearRetryCounters();
    expect(getSeedAttemptCount('shared-key')).toBe(0);
  });
});

describe('retry-counter — seedAttempts diverges on the threshold comparison', () => {
  // Cross-module invariant: at count == MAX (3), the two registries
  // must answer differently. retry-counter says "still allowed",
  // seedAttempts says "exhausted". This is the ONE behavioral
  // divergence and it's load-bearing — see the threshold test above.
  test('at count == 3: retry-counter allows, seedAttempts blocks', () => {
    clearRetryCounters();
    clearSeedAttempts();

    // Drive both registries to count == 3.
    for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
      incrementRetryCounter('shared-key');
    }
    for (let i = 0; i < MAX_SEED_ATTEMPTS; i++) {
      incrementSeedAttempt('shared-key');
    }

    expect(getRetryCount('shared-key')).toBe(MAX_RETRY_ATTEMPTS);
    expect(getSeedAttemptCount('shared-key')).toBe(MAX_SEED_ATTEMPTS);

    // Same count (3), opposite verdicts — this is the divergence.
    expect(isRetryExhausted('shared-key')).toBe(false);
    expect(isSeedExhausted('shared-key')).toBe(true);
  });
});
