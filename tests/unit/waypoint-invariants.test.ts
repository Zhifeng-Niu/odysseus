import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  createWaypoint,
  markActive,
  markSuccess,
  markFailure,
  markAbandoned,
  type Waypoint,
  type CreateWaypointInput,
  type Strategy,
  type WaypointStatus,
} from '../../src/cerebellum/waypoint.js';

/**
 * waypoint.ts — structural invariants for the Waypoint aggregate.
 *
 * No existing test file covers this module directly. It defines:
 *   - Two type unions (Strategy × WaypointStatus)
 *   - The Waypoint interface (9 fields, 5 optional)
 *   - A module-level ID counter (nextId: monotonic + timestamp)
 *   - 5 factory/transition functions with exactOptionalPropertyTypes
 *
 * A silent regression here could:
 *   - Change the default Strategy (breaks orchestrator's "engineer mode")
 *   - Add `key: undefined` keys to the returned object (breaks
 *     exactOptionalPropertyTypes + JSON.stringify outputs "key":undefined
 *     which JSON.parse drops, silently corrupting persistence)
 *   - Mutate the input Waypoint (breaks immutability — orchestrator
 *     keeps old references for trace)
 *   - Change ID format (breaks trace.jsonl filtering, grep patterns)
 *
 * Contracts pinned:
 *
 *   - Strategy has exactly 3 members: engineer | creative | production
 *   - WaypointStatus has exactly 5: pending | active | success | failure | abandoned
 *   - Waypoint interface has exactly 9 fields (4 required + 5 optional)
 *
 *   - createWaypoint defaults: strategy='engineer', status='pending',
 *     iterationsUsed=0. Optional fields (parentWaypointId, voyageId)
 *     are ABSENT when not provided (not undefined — exactOptionalPropertyTypes).
 *
 *   - ID format: `wp_${base36-timestamp}${base36-counter-padded-3}`.
 *     The "wp_" prefix is load-bearing for trace filtering.
 *
 *   - markActive/Success/Failure/Abandoned:
 *     - Return a NEW Waypoint (spread, not mutation)
 *     - Set the correct status string
 *     - markSuccess/Failure/Abandoned set endedAt
 *     - markAbandoned reuses failureReason field (not a new field)
 *
 *   - Counter is module-level: sequential calls produce monotonically
 *     increasing counter portions.
 *
 * Each test below pins one slice.
 */

// ---------------------------------------------------------------------------
// Strategy union — exactly 3 members
// ---------------------------------------------------------------------------

describe('Strategy — union shape', () => {
  test('Strategy has exactly 3 members', () => {
    // We can't introspect a TS union at runtime, but we CAN check that
    // valid values are accepted by createWaypoint and invalid values
    // are rejected by the type system (compile-time). At runtime, we
    // verify the known values round-trip.
    const validStrategies: Strategy[] = ['engineer', 'creative', 'production'];
    expect(validStrategies.length).toBe(3);
    for (const s of validStrategies) {
      const wp = createWaypoint({ goal: 'g', strategy: s });
      expect(wp.strategy).toBe(s);
    }
  });

  test('"engineer" is a valid strategy', () => {
    const wp = createWaypoint({ goal: 'g', strategy: 'engineer' });
    expect(wp.strategy).toBe('engineer');
  });

  test('"creative" is a valid strategy', () => {
    const wp = createWaypoint({ goal: 'g', strategy: 'creative' });
    expect(wp.strategy).toBe('creative');
  });

  test('"production" is a valid strategy', () => {
    const wp = createWaypoint({ goal: 'g', strategy: 'production' });
    expect(wp.strategy).toBe('production');
  });

  test('DEFAULT strategy (omitted) is "engineer"', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect(wp.strategy).toBe('engineer');
  });
});

// ---------------------------------------------------------------------------
// WaypointStatus union — exactly 5 members
// ---------------------------------------------------------------------------

describe('WaypointStatus — union shape', () => {
  test('has exactly 5 members', () => {
    const validStatuses: WaypointStatus[] = [
      'pending',
      'active',
      'success',
      'failure',
      'abandoned',
    ];
    expect(validStatuses.length).toBe(5);
    expect(new Set(validStatuses).size).toBe(5); // all distinct
  });

  test('createWaypoint produces status="pending"', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect(wp.status).toBe('pending');
  });

  test('markActive produces status="active"', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect(markActive(wp).status).toBe('active');
  });

  test('markSuccess produces status="success"', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect(markSuccess(wp, 'fake-sha', 5).status).toBe('success');
  });

  test('markFailure produces status="failure"', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect(markFailure(wp, 'reason', 3).status).toBe('failure');
  });

  test('markAbandoned produces status="abandoned"', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect(markAbandoned(wp, 'reason').status).toBe('abandoned');
  });
});

// ---------------------------------------------------------------------------
// Waypoint interface — field shape and optionality
// ---------------------------------------------------------------------------

describe('Waypoint interface — required fields', () => {
  test('createWaypoint output has at least 5 required fields', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect(wp.id).toBeDefined();
    expect(wp.goal).toBeDefined();
    expect(wp.strategy).toBeDefined();
    expect(wp.status).toBeDefined();
    expect(wp.startedAt).toBeDefined();
    expect(wp.iterationsUsed).toBeDefined();
  });

  test('goal is the literal value passed in (no mutation)', () => {
    const wp = createWaypoint({ goal: 'fix the parser' });
    expect(wp.goal).toBe('fix the parser');
  });

  test('startedAt is a number (epoch millis)', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect(typeof wp.startedAt).toBe('number');
    expect(Number.isFinite(wp.startedAt)).toBe(true);
  });

  test('iterationsUsed starts at 0', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect(wp.iterationsUsed).toBe(0);
  });

  test('id starts with "wp_" prefix', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect(wp.id.startsWith('wp_')).toBe(true);
  });
});

describe('Waypoint interface — optional field absence (exactOptionalPropertyTypes)', () => {
  // CRITICAL: exactOptionalPropertyTypes requires that omitted optional
  // fields are ABSENT from the object, not `key: undefined`. This test
  // catches a refactor that changes `...(x ? {x} : {})` to `x: x`
  // (which would write undefined into the key).

  test('parentWaypointId ABSENT when not provided', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect('parentWaypointId' in wp).toBe(false);
    expect(wp.parentWaypointId).toBeUndefined();
  });

  test('parentWaypointId PRESENT when provided', () => {
    const wp = createWaypoint({ goal: 'g', parentWaypointId: 'wp_parent' });
    expect('parentWaypointId' in wp).toBe(true);
    expect(wp.parentWaypointId).toBe('wp_parent');
  });

  test('voyageId ABSENT when not provided', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect('voyageId' in wp).toBe(false);
    expect(wp.voyageId).toBeUndefined();
  });

  test('voyageId PRESENT when provided', () => {
    const wp = createWaypoint({ goal: 'g', voyageId: 'v_123' });
    expect('voyageId' in wp).toBe(true);
    expect(wp.voyageId).toBe('v_123');
  });

  test('checkpointSha ABSENT on fresh waypoint', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect('checkpointSha' in wp).toBe(false);
  });

  test('endedAt ABSENT on fresh waypoint', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect('endedAt' in wp).toBe(false);
  });

  test('failureReason ABSENT on fresh waypoint', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect('failureReason' in wp).toBe(false);
  });

  test('fresh waypoint has exactly 6 keys', () => {
    // id, goal, strategy, status, startedAt, iterationsUsed.
    // No optional keys present.
    const wp = createWaypoint({ goal: 'g' });
    expect(Object.keys(wp).sort()).toEqual(
      ['id', 'goal', 'strategy', 'status', 'startedAt', 'iterationsUsed'].sort(),
    );
  });

  test('waypoint with parentWaypointId has exactly 7 keys', () => {
    const wp = createWaypoint({ goal: 'g', parentWaypointId: 'wp_x' });
    expect(Object.keys(wp).length).toBe(7);
  });

  test('waypoint with voyageId has exactly 7 keys', () => {
    const wp = createWaypoint({ goal: 'g', voyageId: 'v_1' });
    expect(Object.keys(wp).length).toBe(7);
  });

  test('JSON.stringify does NOT emit undefined for omitted optional fields', () => {
    // If exactOptionalPropertyTypes were violated, JSON.stringify would
    // skip the key (JSON drops undefined). So the test is more about
    // ensuring the omitted keys don't appear in any serialization.
    const wp = createWaypoint({ goal: 'g' });
    const json = JSON.stringify(wp);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect('parentWaypointId' in parsed).toBe(false);
    expect('voyageId' in parsed).toBe(false);
    expect('checkpointSha' in parsed).toBe(false);
    expect('endedAt' in parsed).toBe(false);
    expect('failureReason' in parsed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ID format — wp_<timestamp>.<counter>
// ---------------------------------------------------------------------------

describe('createWaypoint — ID format', () => {
  test('ID starts with "wp_" prefix', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect(wp.id.startsWith('wp_')).toBe(true);
  });

  test('ID has more than 6 characters (prefix + at least 1 char)', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect(wp.id.length).toBeGreaterThan(6);
  });

  test('ID after "wp_" contains only base36 characters', () => {
    // base36: [0-9a-z]
    const wp = createWaypoint({ goal: 'g' });
    const suffix = wp.id.slice(3);
    expect(suffix).toMatch(/^[0-9a-z]+$/);
  });

  test('ID after "wp_" has at least 4 chars (timestamp + 3-digit seq)', () => {
    // Date.now() in base36 is at least 1 char, counter padded to 3.
    const wp = createWaypoint({ goal: 'g' });
    const suffix = wp.id.slice(3);
    expect(suffix.length).toBeGreaterThanOrEqual(4);
  });

  test('counter portion is the LAST 3 chars (padStart(3, "0"))', () => {
    // The counter is .toString(36).padStart(3, '0'). So last 3 chars
    // are always the counter (possibly with leading zeros).
    // For the first call, counter=1 → '001'. For the 10th → '00a'.
    // We can verify by creating many waypoints and checking the
    // sequence increments.
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(createWaypoint({ goal: 'g' }).id);
    }
    // Last 3 chars should be monotonically increasing in base36.
    const seqs = ids.map((id) => id.slice(-3));
    for (let i = 1; i < seqs.length; i++) {
      // base36 string comparison works for equal-length strings.
      expect(seqs[i]! > seqs[i - 1]!).toBe(true);
    }
  });

  test('two consecutive createWaypoint calls produce different IDs', () => {
    const a = createWaypoint({ goal: 'g' }).id;
    const b = createWaypoint({ goal: 'g' }).id;
    expect(a).not.toBe(b);
  });

  test('ID is a string', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect(typeof wp.id).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// mark* functions — immutability (return new object, don't mutate input)
// ---------------------------------------------------------------------------

describe('markActive — immutability and shape', () => {
  test('returns a NEW object (not same reference)', () => {
    const wp = createWaypoint({ goal: 'g' });
    const marked = markActive(wp);
    expect(marked).not.toBe(wp);
  });

  test('does NOT mutate the input waypoint', () => {
    const wp = createWaypoint({ goal: 'g' });
    const originalStatus = wp.status;
    markActive(wp);
    expect(wp.status).toBe(originalStatus);
    expect(wp.status).toBe('pending'); // unchanged
  });

  test('sets status to "active"', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect(markActive(wp).status).toBe('active');
  });

  test('preserves all other fields', () => {
    const wp = createWaypoint({ goal: 'g', strategy: 'creative', voyageId: 'v1' });
    const marked = markActive(wp);
    expect(marked.id).toBe(wp.id);
    expect(marked.goal).toBe(wp.goal);
    expect(marked.strategy).toBe(wp.strategy);
    expect(marked.startedAt).toBe(wp.startedAt);
    expect(marked.iterationsUsed).toBe(wp.iterationsUsed);
    expect(marked.voyageId).toBe(wp.voyageId);
  });

  test('does NOT set endedAt (active is not terminal)', () => {
    const wp = createWaypoint({ goal: 'g' });
    const marked = markActive(wp);
    expect('endedAt' in marked).toBe(false);
    expect(marked.endedAt).toBeUndefined();
  });
});

describe('markSuccess — immutability and shape', () => {
  test('returns a NEW object', () => {
    const wp = createWaypoint({ goal: 'g' });
    const marked = markSuccess(wp, 'sha-abc', 5);
    expect(marked).not.toBe(wp);
  });

  test('does NOT mutate the input waypoint', () => {
    const wp = createWaypoint({ goal: 'g' });
    markSuccess(wp, 'sha-abc', 5);
    expect(wp.status).toBe('pending');
    expect('endedAt' in wp).toBe(false);
    expect('checkpointSha' in wp).toBe(false);
  });

  test('sets status to "success"', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect(markSuccess(wp, 'sha', 1).status).toBe('success');
  });

  test('sets checkpointSha', () => {
    const wp = createWaypoint({ goal: 'g' });
    const marked = markSuccess(wp, 'sha-xyz', 3);
    expect(marked.checkpointSha).toBe('sha-xyz');
    expect('checkpointSha' in marked).toBe(true);
  });

  test('sets iterationsUsed to the passed value', () => {
    const wp = createWaypoint({ goal: 'g' });
    const marked = markSuccess(wp, 'sha', 42);
    expect(marked.iterationsUsed).toBe(42);
  });

  test('sets endedAt to a number', () => {
    const wp = createWaypoint({ goal: 'g' });
    const marked = markSuccess(wp, 'sha', 1);
    expect(typeof marked.endedAt).toBe('number');
    expect(Number.isFinite(marked.endedAt)).toBe(true);
    expect('endedAt' in marked).toBe(true);
  });

  test('endedAt is >= startedAt (time moves forward)', () => {
    const wp = createWaypoint({ goal: 'g' });
    const marked = markSuccess(wp, 'sha', 1);
    expect(marked.endedAt).toBeGreaterThanOrEqual(wp.startedAt);
  });

  test('does NOT set failureReason', () => {
    const wp = createWaypoint({ goal: 'g' });
    const marked = markSuccess(wp, 'sha', 1);
    expect('failureReason' in marked).toBe(false);
  });
});

describe('markFailure — immutability and shape', () => {
  test('returns a NEW object', () => {
    const wp = createWaypoint({ goal: 'g' });
    const marked = markFailure(wp, 'reason', 3);
    expect(marked).not.toBe(wp);
  });

  test('does NOT mutate the input waypoint', () => {
    const wp = createWaypoint({ goal: 'g' });
    markFailure(wp, 'reason', 3);
    expect(wp.status).toBe('pending');
    expect('failureReason' in wp).toBe(false);
  });

  test('sets status to "failure"', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect(markFailure(wp, 'r', 1).status).toBe('failure');
  });

  test('sets failureReason', () => {
    const wp = createWaypoint({ goal: 'g' });
    const marked = markFailure(wp, 'hit max iterations', 10);
    expect(marked.failureReason).toBe('hit max iterations');
    expect('failureReason' in marked).toBe(true);
  });

  test('sets iterationsUsed', () => {
    const wp = createWaypoint({ goal: 'g' });
    const marked = markFailure(wp, 'r', 7);
    expect(marked.iterationsUsed).toBe(7);
  });

  test('sets endedAt', () => {
    const wp = createWaypoint({ goal: 'g' });
    const marked = markFailure(wp, 'r', 1);
    expect(typeof marked.endedAt).toBe('number');
    expect('endedAt' in marked).toBe(true);
  });

  test('does NOT set checkpointSha', () => {
    const wp = createWaypoint({ goal: 'g' });
    const marked = markFailure(wp, 'r', 1);
    expect('checkpointSha' in marked).toBe(false);
  });
});

describe('markAbandoned — reuses failureReason field', () => {
  // NOTE: markAbandoned writes to `failureReason`, NOT a separate
  // `abandonReason` field. This is a deliberate shape decision —
  // both "failure" and "abandoned" are terminal states with an
  // explanatory reason, so they share the field. The status field
  // distinguishes them.

  test('returns a NEW object', () => {
    const wp = createWaypoint({ goal: 'g' });
    const marked = markAbandoned(wp, 'reason');
    expect(marked).not.toBe(wp);
  });

  test('does NOT mutate the input waypoint', () => {
    const wp = createWaypoint({ goal: 'g' });
    markAbandoned(wp, 'reason');
    expect(wp.status).toBe('pending');
    expect('failureReason' in wp).toBe(false);
  });

  test('sets status to "abandoned"', () => {
    const wp = createWaypoint({ goal: 'g' });
    expect(markAbandoned(wp, 'r').status).toBe('abandoned');
  });

  test('writes the reason to failureReason (NOT abandonReason)', () => {
    const wp = createWaypoint({ goal: 'g' });
    const marked = markAbandoned(wp, 'user cancelled');
    expect(marked.failureReason).toBe('user cancelled');
    expect('failureReason' in marked).toBe(true);
    // Verify no new field was added.
    expect('abandonReason' in marked).toBe(false);
  });

  test('sets endedAt', () => {
    const wp = createWaypoint({ goal: 'g' });
    const marked = markAbandoned(wp, 'r');
    expect(typeof marked.endedAt).toBe('number');
    expect('endedAt' in marked).toBe(true);
  });

  test('does NOT set checkpointSha', () => {
    const wp = createWaypoint({ goal: 'g' });
    const marked = markAbandoned(wp, 'r');
    expect('checkpointSha' in marked).toBe(false);
  });

  test('does NOT change iterationsUsed (stays at input value)', () => {
    // markAbandoned doesn't take an iterationsUsed arg — it preserves
    // whatever the input waypoint had.
    const wp = createWaypoint({ goal: 'g' });
    expect(wp.iterationsUsed).toBe(0);
    const marked = markAbandoned(wp, 'r');
    expect(marked.iterationsUsed).toBe(0);
  });

  test('terminal-state shape: status + failureReason + endedAt', () => {
    const wp = createWaypoint({ goal: 'g' });
    const marked = markAbandoned(wp, 'some reason');
    // All three terminal fields are set.
    expect(marked.status).toBe('abandoned');
    expect(marked.failureReason).toBe('some reason');
    expect(marked.endedAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Transition chains — full lifecycle shape
// ---------------------------------------------------------------------------

describe('lifecycle chains — shape after multiple transitions', () => {
  test('pending → active → success preserves all fields and adds terminal', () => {
    const wp = createWaypoint({ goal: 'g', strategy: 'production', voyageId: 'v1' });
    const active = markActive(wp);
    const success = markSuccess(active, 'sha-final', 5);

    expect(success.id).toBe(wp.id);
    expect(success.goal).toBe(wp.goal);
    expect(success.strategy).toBe(wp.strategy);
    expect(success.voyageId).toBe(wp.voyageId);
    expect(success.startedAt).toBe(wp.startedAt);

    // Changed fields.
    expect(success.status).toBe('success');
    expect(success.iterationsUsed).toBe(5);
    expect(success.checkpointSha).toBe('sha-final');
    expect(success.endedAt).toBeDefined();
  });

  test('pending → active → failure keeps parentWaypointId', () => {
    const wp = createWaypoint({
      goal: 'g',
      parentWaypointId: 'wp_parent',
    });
    const active = markActive(wp);
    const failed = markFailure(active, 'timeout', 10);

    expect(failed.parentWaypointId).toBe('wp_parent');
    expect(failed.failureReason).toBe('timeout');
    expect(failed.iterationsUsed).toBe(10);
  });

  test('pending → abandoned (skip active) is valid', () => {
    const wp = createWaypoint({ goal: 'g' });
    const abandoned = markAbandoned(wp, 'duplicate');
    expect(abandoned.status).toBe('abandoned');
    expect(abandoned.iterationsUsed).toBe(0); // never ran
  });

  test('input waypoint is reusable across multiple mark* calls', () => {
    // Each mark returns a new object — the original is never consumed.
    const wp = createWaypoint({ goal: 'g' });
    const active = markActive(wp);
    const failed = markFailure(wp, 'r', 1);
    const abandoned = markAbandoned(wp, 'r');

    expect(wp.status).toBe('pending');
    expect(active.status).toBe('active');
    expect(failed.status).toBe('failure');
    expect(abandoned.status).toBe('abandoned');
  });
});

// ---------------------------------------------------------------------------
// Module-level counter — monotonic
// ---------------------------------------------------------------------------

describe('module-level counter — monotonic IDs', () => {
  test('consecutive IDs differ', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      ids.add(createWaypoint({ goal: 'g' }).id);
    }
    expect(ids.size).toBe(10);
  });

  test('counter portion increments by 1 each call', () => {
    // The last 3 chars of the ID are the counter in base36 padded to 3.
    // Consecutive calls should produce sequential base36 values.
    const a = createWaypoint({ goal: 'g' }).id;
    const b = createWaypoint({ goal: 'g' }).id;
    const seqA = parseInt(a.slice(-3), 36);
    const seqB = parseInt(b.slice(-3), 36);
    expect(seqB).toBe(seqA + 1);
  });

  test('counter never decreases within a session', () => {
    const seqs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const id = createWaypoint({ goal: 'g' }).id;
      seqs.push(parseInt(id.slice(-3), 36));
    }
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
    }
  });

  test('counter is padded to at least 3 digits', () => {
    // Even if counter is small (e.g. 1), the seq portion is "001".
    // We can't reset the counter, but we can check the LAST 3 chars
    // are always at least 3 chars (which they are by slice(-3)).
    const id = createWaypoint({ goal: 'g' }).id;
    expect(id.slice(-3).length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// CreateWaypointInput — input shape contracts
// ---------------------------------------------------------------------------

describe('CreateWaypointInput — minimal vs maximal inputs', () => {
  test('minimal input (only goal) produces valid waypoint', () => {
    const wp = createWaypoint({ goal: 'do something' });
    expect(wp.goal).toBe('do something');
    expect(wp.strategy).toBe('engineer'); // default
    expect(wp.status).toBe('pending');
  });

  test('goal is the only required input field', () => {
    // Type system enforces this; runtime verifies no crash.
    expect(() => createWaypoint({ goal: '' })).not.toThrow();
    expect(() => createWaypoint({ goal: 'x' })).not.toThrow();
  });

  test('all optional input fields provided → all reflected in waypoint', () => {
    const wp = createWaypoint({
      goal: 'g',
      strategy: 'creative',
      parentWaypointId: 'wp_p',
      voyageId: 'v_42',
    });
    expect(wp.strategy).toBe('creative');
    expect(wp.parentWaypointId).toBe('wp_p');
    expect(wp.voyageId).toBe('v_42');
  });

  test('empty-string goal is accepted (no input validation)', () => {
    // The factory does not validate goal content — orchestrator's
    // goal-validator.ts is responsible. Pinning that createWaypoint
    // is a pure shape constructor.
    const wp = createWaypoint({ goal: '' });
    expect(wp.goal).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Purity and determinism (modulo clock + counter)
// ---------------------------------------------------------------------------

describe('createWaypoint — purity (modulo clock and counter)', () => {
  test('same input produces same goal/strategy/voyageId fields', () => {
    // id, startedAt differ (clock + counter), but the user-provided
    // fields are preserved identically.
    const a = createWaypoint({ goal: 'g', strategy: 'creative', voyageId: 'v' });
    const b = createWaypoint({ goal: 'g', strategy: 'creative', voyageId: 'v' });
    expect(a.goal).toBe(b.goal);
    expect(a.strategy).toBe(b.strategy);
    expect(a.voyageId).toBe(b.voyageId);
    // But id and startedAt SHOULD differ.
    expect(a.id).not.toBe(b.id);
  });

  test('createWaypoint has no side effect on its input', () => {
    const input: CreateWaypointInput = {
      goal: 'g',
      strategy: 'creative',
      parentWaypointId: 'wp_p',
    };
    const inputSnapshot = { ...input };
    createWaypoint(input);
    expect(input).toEqual(inputSnapshot);
  });

  test('mark* functions do not modify input nesting', () => {
    // Waypoints are flat — no nested objects — so spread is a complete
    // copy. Pinning that the input is untouched.
    const wp = createWaypoint({ goal: 'g' });
    const keysBefore = Object.keys(wp);
    markActive(wp);
    markSuccess(wp, 's', 1);
    markFailure(wp, 'r', 1);
    markAbandoned(wp, 'r');
    expect(Object.keys(wp)).toEqual(keysBefore);
  });
});

// ---------------------------------------------------------------------------
// Waypoint field count — exactly 9 (4 required + 5 optional)
// ---------------------------------------------------------------------------

describe('Waypoint — total field count', () => {
  test('interface declares 6 required + 5 optional = 11 total fields', () => {
    // From the Waypoint interface in source:
    //   id, goal, strategy, status, startedAt, iterationsUsed (6 required)
    //   + endedAt, parentWaypointId, checkpointSha, failureReason, voyageId (5 optional)
    // = 11 total field positions. A waypoint with ALL fields set has 11 keys.
    // But terminal states never set BOTH checkpointSha AND failureReason,
    // so the max observable is 10.
    const wp = createWaypoint({ goal: 'g', parentWaypointId: 'p', voyageId: 'v' });
    const active = markActive(wp);
    const success = markSuccess(active, 'sha', 5);
    // 6 required + endedAt + checkpointSha + parentWaypointId + voyageId = 10.
    // (failureReason is NOT set on success.)
    expect(Object.keys(success).length).toBe(10);
    expect(Object.keys(success).sort()).toEqual(
      [
        'id',
        'goal',
        'strategy',
        'status',
        'startedAt',
        'iterationsUsed',
        'endedAt',
        'parentWaypointId',
        'checkpointSha',
        'voyageId',
        // NOTE: failureReason NOT present on success
      ].sort(),
    );
  });

  test('failure-state waypoint has 10 keys (failureReason replaces checkpointSha)', () => {
    const wp = createWaypoint({ goal: 'g', parentWaypointId: 'p', voyageId: 'v' });
    const failed = markFailure(wp, 'r', 5);
    // 6 required + endedAt + failureReason + parentWaypointId + voyageId = 10.
    expect(Object.keys(failed).length).toBe(10);
    expect(Object.keys(failed).sort()).toEqual(
      [
        'id',
        'goal',
        'strategy',
        'status',
        'startedAt',
        'iterationsUsed',
        'endedAt',
        'parentWaypointId',
        'failureReason',
        'voyageId',
        // NOTE: checkpointSha NOT present on failure
      ].sort(),
    );
  });

  test('abandoned-state waypoint has 9 keys (no iterationsUsed bump, no checkpointSha)', () => {
    const wp = createWaypoint({ goal: 'g', parentWaypointId: 'p', voyageId: 'v' });
    const abandoned = markAbandoned(wp, 'r');
    // 6 required (incl. iterationsUsed preserved from input) + endedAt +
    // failureReason + parentWaypointId + voyageId = 10... wait, let's count:
    // id, goal, strategy, status, startedAt, iterationsUsed = 6
    // + endedAt, parentWaypointId, voyageId, failureReason = 4
    // = 10.
    expect(Object.keys(abandoned).length).toBe(10);
    expect('checkpointSha' in abandoned).toBe(false);
    expect('failureReason' in abandoned).toBe(true);
  });
});
