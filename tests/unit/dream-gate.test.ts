import { describe, test, expect } from 'vitest';
import { shouldDream } from '../../src/cerebellum/dream-gate.js';

/**
 * dream-gate.ts — graduated dreamer rhythm gate (Aspiration 1).
 *
 * shouldDream returns true only when BOTH conditions hold:
 *   1. hasSideEffects is true (the waypoint did real work).
 *   2. workWaypointCounter >= threshold (enough work has accumulated
 *      since the last dream).
 *
 * Each condition is exercised independently so a future tuning attempt
 * that breaks one without the other is caught.
 */

describe('shouldDream', () => {
  test('returns true when side effects present and counter meets threshold', () => {
    expect(shouldDream(3, 3, true)).toBe(true);
    expect(shouldDream(5, 3, true)).toBe(true);
  });

  test('returns false when there are no side effects', () => {
    expect(shouldDream(3, 3, false)).toBe(false);
    expect(shouldDream(5, 3, false)).toBe(false);
  });

  test('returns false when counter is below threshold', () => {
    expect(shouldDream(0, 3, true)).toBe(false);
    expect(shouldDream(1, 3, true)).toBe(false);
    expect(shouldDream(2, 3, true)).toBe(false);
  });

  test('returns false when both conditions fail', () => {
    expect(shouldDream(0, 3, false)).toBe(false);
  });

  test('boundary: counter exactly at threshold with side effects dreams', () => {
    expect(shouldDream(3, 3, true)).toBe(true);
  });

  test('boundary: counter one below threshold with side effects does not dream', () => {
    expect(shouldDream(2, 3, true)).toBe(false);
  });

  test('threshold of 1 means every side-effecting waypoint can dream', () => {
    expect(shouldDream(1, 1, true)).toBe(true);
  });

  test('threshold of 0 means side effects alone gate dreaming', () => {
    expect(shouldDream(0, 0, true)).toBe(true);
    expect(shouldDream(0, 0, false)).toBe(false);
  });
});
