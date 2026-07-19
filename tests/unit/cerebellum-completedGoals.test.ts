import { describe, test, expect, beforeEach } from 'vitest';
import {
  isCompleted,
  markCompleted,
  clearCompletedGoals,
  getCompletedGoals,
} from '../../src/cerebellum/completedGoals.js';

beforeEach(() => {
  clearCompletedGoals();
});

// ---------------------------------------------------------------------------
// isCompleted — substring matching
// ---------------------------------------------------------------------------

describe('isCompleted', () => {
  test('returns false when no goals have been recorded', () => {
    expect(isCompleted('fix the login bug')).toBe(false);
  });

  test('returns false for empty string', () => {
    markCompleted('something', 'done');
    expect(isCompleted('')).toBe(false);
  });

  test('returns false for empty string when the map is empty', () => {
    expect(isCompleted('')).toBe(false);
  });

  test('returns false for whitespace-only string', () => {
    markCompleted('something', 'done');
    expect(isCompleted('   ')).toBe(false);
  });

  test('returns true for an exact match', () => {
    markCompleted('fix the login bug', 'patched auth flow');
    expect(isCompleted('fix the login bug')).toBe(true);
  });

  test('returns true when the stored goal is a substring of the query', () => {
    markCompleted('login bug', 'patched');
    // query contains the stored key as a substring
    expect(isCompleted('fix the login bug')).toBe(true);
  });

  test('returns true when the query is a substring of a stored goal', () => {
    markCompleted('fix the login bug on the homepage', 'patched');
    // query is a substring of the stored key
    expect(isCompleted('login bug')).toBe(true);
  });

  test('returns false when there is no substring relationship', () => {
    markCompleted('fix the login bug', 'patched');
    expect(isCompleted('update the readme')).toBe(false);
  });

  test('is case-sensitive — different casing does not match', () => {
    markCompleted('Fix Login Bug', 'patched');
    expect(isCompleted('fix login bug')).toBe(false);
    expect(isCompleted('FIX LOGIN BUG')).toBe(false);
    expect(isCompleted('Fix The Login Bug')).toBe(false);
  });

  test('is case-sensitive — case-exact substring matches', () => {
    markCompleted('Fix Login Bug', 'patched');
    expect(isCompleted('Login')).toBe(true);
    expect(isCompleted('Fix')).toBe(true);
  });

  test('is case-sensitive — case-different substring does not match', () => {
    markCompleted('Fix Login Bug', 'patched');
    expect(isCompleted('login')).toBe(false);
    expect(isCompleted('LOGIN')).toBe(false);
  });

  test('matches against multiple stored goals', () => {
    markCompleted('add feature X', 'done');
    markCompleted('add feature Y', 'done');
    expect(isCompleted('feature X')).toBe(true);
    expect(isCompleted('feature Y')).toBe(true);
  });

  test('returns true when query equals a single-character stored goal', () => {
    markCompleted('a', 'done');
    expect(isCompleted('a')).toBe(true);
    expect(isCompleted('ab')).toBe(true); // "a" is substring of "ab"
  });

  test('returns true when stored goal is single character and substring of query', () => {
    markCompleted('x', 'done');
    expect(isCompleted('the x factor')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// markCompleted
// ---------------------------------------------------------------------------

describe('markCompleted', () => {
  test('stores a goal so that isCompleted returns true', () => {
    markCompleted('task A', 'result A');
    expect(isCompleted('task A')).toBe(true);
  });

  test('overwrites a previous entry with the same description', () => {
    markCompleted('task A', 'first outcome');
    markCompleted('task A', 'second outcome');

    const goals = getCompletedGoals();
    // Should only have one entry (overwritten, not duplicated)
    expect(goals).toHaveLength(1);
    expect(goals[0].outcome).toBe('second outcome');
  });

  test('records the description and outcome in getCompletedGoals', () => {
    markCompleted('task B', 'result B');
    const goals = getCompletedGoals();
    expect(goals).toHaveLength(1);
    expect(goals[0].description).toBe('task B');
    expect(goals[0].outcome).toBe('result B');
  });

  test('records a valid completedAt timestamp', () => {
    const before = Date.now();
    markCompleted('task C', 'result C');
    const after = Date.now();
    const goals = getCompletedGoals();
    expect(goals[0].completedAt).toBeGreaterThanOrEqual(before);
    expect(goals[0].completedAt).toBeLessThanOrEqual(after);
  });

  test('preserves insertion order across multiple calls', () => {
    markCompleted('first', 'a');
    markCompleted('second', 'b');
    markCompleted('third', 'c');

    const goals = getCompletedGoals();
    expect(goals.map((g) => g.description)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });
});
