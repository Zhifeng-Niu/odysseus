import { describe, test, expect, beforeEach } from 'vitest';
import { RepeatedToolCallDetector } from '../../src/cerebellum/repeated-tool-call-detector.js';
import { StuckLoopError } from '../../src/orchestrator/errors.js';

/**
 * RepeatedToolCallDetector — structural invariants.
 *
 * No existing test file covers this module. It implements a sliding-
 * window loop detector with a TWO-PHASE recovery contract:
 *
 *   Phase 1 (first loop): return { loopDetected: true, recoveryMessage }
 *                         and RESET the window so the agent gets a fresh
 *                         chance. The orchestrator injects recoveryMessage
 *                         into LLM history.
 *
 *   Phase 2 (recurrence): throw StuckLoopError. Orchestrator aborts +
 *                         rolls back.
 *
 * A silent regression here could either:
 *   - Abort too eagerly (no recovery → wasted waypoint on first loop)
 *   - Never abort (recovery flag never set → infinite-loop risk)
 *   - Mis-detect (window semantics off → false positives/negatives)
 *
 * Contracts pinned:
 *
 *   - CONSTRUCTOR: default maxSize=3, rejects maxSize<2, accepts 2+.
 *
 *   - WINDOW: FIFO via shift(). Window reflects actual push history up
 *     to maxSize.
 *
 *   - SIGNATURE: `${toolName}:${JSON.stringify(args)}`. Parameter key
 *     order matters (JSON.stringify is order-sensitive).
 *
 *   - LOOP DETECTION: only triggers when window is FULL and all entries
 *     match. Partial windows don't trigger.
 *
 *   - TWO-PHASE RECOVERY: first detection returns recoveryMessage +
 *     resets window + flips hasRecoveryAttempted. Second detection
 *     throws StuckLoopError.
 *
 *   - RECOVERY MESSAGE SHAPE: includes toolName, maxSize, and args JSON.
 *
 *   - RESET: clears window + clears hasRecoveryAttempted.
 *
 *   - SIZE GETTER: reflects current window length, NOT maxSize.
 *
 * Each test below pins one slice.
 */

// ---------------------------------------------------------------------------
// Constructor — default, boundaries, validation
// ---------------------------------------------------------------------------

describe('constructor — maxSize handling', () => {
  test('default maxSize is 3', () => {
    const d = new RepeatedToolCallDetector();
    // Default behavior: 3 identical calls trigger detection.
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    expect(d.record('tool', { x: 1 }).loopDetected).toBe(true);
  });

  test('maxSize=2 is accepted', () => {
    const d = new RepeatedToolCallDetector(2);
    d.record('tool', { x: 1 });
    expect(d.record('tool', { x: 1 }).loopDetected).toBe(true);
  });

  test('maxSize=1 throws (must be >= 2)', () => {
    expect(() => new RepeatedToolCallDetector(1)).toThrow();
  });

  test('maxSize=0 throws', () => {
    expect(() => new RepeatedToolCallDetector(0)).toThrow();
  });

  test('maxSize=-1 throws', () => {
    expect(() => new RepeatedToolCallDetector(-1)).toThrow();
  });

  test('maxSize=100 is accepted (large windows OK)', () => {
    const d = new RepeatedToolCallDetector(100);
    expect(d.size).toBe(0);
  });

  test('error message mentions "must be >= 2"', () => {
    expect(() => new RepeatedToolCallDetector(1)).toThrow(/>= 2/);
  });

  test('constructor does NOT populate the window', () => {
    const d = new RepeatedToolCallDetector();
    expect(d.size).toBe(0);
    expect(d.hasRecoveryAttempted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Window semantics — FIFO with maxSize cap
// ---------------------------------------------------------------------------

describe('record — FIFO window behavior', () => {
  test('window grows one at a time', () => {
    const d = new RepeatedToolCallDetector(5);
    expect(d.size).toBe(0);
    d.record('a', {});
    expect(d.size).toBe(1);
    d.record('a', {});
    expect(d.size).toBe(2);
    d.record('a', {});
    expect(d.size).toBe(3);
  });

  test('window caps at maxSize (shift drops oldest)', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('a', { n: 1 });
    d.record('a', { n: 2 });
    d.record('a', { n: 3 });
    expect(d.size).toBe(3);
    // Push one more — oldest ({n:1}) should be dropped.
    d.record('a', { n: 4 });
    expect(d.size).toBe(3);
  });

  test('after cap, window contents shift (oldest dropped)', () => {
    const d = new RepeatedToolCallDetector(3);
    // 3 distinct calls fill window without triggering loop.
    d.record('a', { n: 1 });
    d.record('a', { n: 2 });
    d.record('a', { n: 3 });
    // Now push 2 more with args matching the LAST one ({n:3}).
    // After shift, window should be [{n:2},{n:3},{n:3}] — wait that's
    // a loop. Let's think: the NEW signature is what gets pushed, then
    // if length>maxSize shift.
    // Initial window after 3 distinct: [{n:1},{n:2},{n:3}].
    // Push {n:1} again → [{n:1},{n:2},{n:3},{n:1}] → shift → [{n:2},{n:3},{n:1}].
    // Not all same → no loop.
    d.record('a', { n: 1 });
    expect(d.size).toBe(3);
  });

  test('window at maxSize but not all-same → no detection', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('a', { n: 1 });
    d.record('a', { n: 2 });
    const r = d.record('a', { n: 3 });
    expect(r.loopDetected).toBe(false);
    expect(r.recoveryMessage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Signature construction — toolName + JSON.stringify(args)
// ---------------------------------------------------------------------------

describe('record — signature construction', () => {
  test('same toolName + same args → same signature (loop)', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('writeFile', { path: '/a', content: 'x' });
    d.record('writeFile', { path: '/a', content: 'x' });
    const r = d.record('writeFile', { path: '/a', content: 'x' });
    expect(r.loopDetected).toBe(true);
  });

  test('same toolName but different args → distinct signatures', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('writeFile', { path: '/a' });
    d.record('writeFile', { path: '/b' });
    const r = d.record('writeFile', { path: '/c' });
    expect(r.loopDetected).toBe(false);
  });

  test('different toolName, same args → distinct signatures', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('writeFile', { path: '/a' });
    d.record('readFile', { path: '/a' });
    const r = d.record('editFile', { path: '/a' });
    expect(r.loopDetected).toBe(false);
  });

  test('empty args object {} is a valid signature', () => {
    const d = new RepeatedToolCallDetector(2);
    d.record('noop', {});
    const r = d.record('noop', {});
    expect(r.loopDetected).toBe(true);
  });

  test('JSON.stringify key ORDER matters for signatures', () => {
    // JSON.stringify({a:1,b:2}) !== JSON.stringify({b:2,a:1}) in theory,
    // but V8 preserves insertion order. Still, calling with different
    // insertion orders produces different string arguments.
    const d = new RepeatedToolCallDetector(3);
    d.record('tool', { a: 1, b: 2 });
    d.record('tool', { b: 2, a: 1 }); // different insertion order
    const r = d.record('tool', { a: 1, b: 2 });
    // Two of one signature, one of the other — no loop.
    expect(r.loopDetected).toBe(false);
  });

  test('numeric vs string args are distinct signatures', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('tool', { n: 1 });
    d.record('tool', { n: '1' });
    const r = d.record('tool', { n: 1 });
    expect(r.loopDetected).toBe(false);
  });

  test('nested object args are JSON.stringify-ed', () => {
    const d = new RepeatedToolCallDetector(2);
    d.record('tool', { nested: { deep: { value: 42 } } });
    const r = d.record('tool', { nested: { deep: { value: 42 } } });
    expect(r.loopDetected).toBe(true);
  });

  test('array args are JSON.stringify-ed', () => {
    const d = new RepeatedToolCallDetector(2);
    d.record('tool', { list: [1, 2, 3] });
    const r = d.record('tool', { list: [1, 2, 3] });
    expect(r.loopDetected).toBe(true);
  });

  test('null vs undefined args produce distinct signatures', () => {
    // JSON.stringify({x:null}) = '{"x":null}'
    // JSON.stringify({}) = '{}' (undefined is omitted)
    const d = new RepeatedToolCallDetector(3);
    d.record('tool', { x: null });
    d.record('tool', { x: undefined });
    const r = d.record('tool', { x: null });
    expect(r.loopDetected).toBe(false);
  });

  test('toolName is case-sensitive in signature', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('WriteFile', {});
    d.record('writefile', {});
    const r = d.record('WriteFile', {});
    expect(r.loopDetected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Loop detection — boundary conditions
// ---------------------------------------------------------------------------

describe('loop detection — triggers only when window FULL and UNIFORM', () => {
  test('maxSize=3: 2 identical calls → no detection (window not full)', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('tool', { x: 1 });
    const r = d.record('tool', { x: 1 });
    expect(r.loopDetected).toBe(false);
  });

  test('maxSize=3: 3 identical calls → detection (window full + uniform)', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    const r = d.record('tool', { x: 1 });
    expect(r.loopDetected).toBe(true);
  });

  test('maxSize=2: 2 identical calls → detection', () => {
    const d = new RepeatedToolCallDetector(2);
    d.record('tool', { x: 1 });
    const r = d.record('tool', { x: 1 });
    expect(r.loopDetected).toBe(true);
  });

  test('maxSize=3: 2 identical + 1 different → no detection', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    const r = d.record('tool', { x: 2 });
    expect(r.loopDetected).toBe(false);
  });

  test('window full but only 2 of 3 match → no detection', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    const r = d.record('tool', { x: 2 });
    expect(r.loopDetected).toBe(false);
  });

  test('window full but only first and last match → no detection', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('tool', { x: 1 });
    d.record('tool', { x: 2 });
    const r = d.record('tool', { x: 1 });
    expect(r.loopDetected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Two-phase recovery — the load-bearing contract
// ---------------------------------------------------------------------------

describe('two-phase recovery — first detection returns message + resets', () => {
  test('first detection: loopDetected=true AND recoveryMessage present', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    const r = d.record('tool', { x: 1 });
    expect(r.loopDetected).toBe(true);
    expect(typeof r.recoveryMessage).toBe('string');
    expect(r.recoveryMessage!.length).toBeGreaterThan(0);
  });

  test('after first detection, window is RESET to empty', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    expect(d.size).toBe(0); // window cleared post-recovery
  });

  test('after first detection, hasRecoveryAttempted is true', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    expect(d.hasRecoveryAttempted).toBe(true);
  });

  test('before any detection, hasRecoveryAttempted is false', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('tool', { x: 1 });
    d.record('tool', { x: 2 });
    expect(d.hasRecoveryAttempted).toBe(false);
  });

  test('after recovery, more record() calls work normally', () => {
    const d = new RepeatedToolCallDetector(3);
    // Trigger recovery.
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    // New calls after recovery.
    expect(d.size).toBe(0);
    d.record('tool', { x: 2 });
    expect(d.size).toBe(1);
    expect(d.hasRecoveryAttempted).toBe(true);
  });
});

describe('two-phase recovery — second detection throws StuckLoopError', () => {
  test('second detection throws StuckLoopError', () => {
    const d = new RepeatedToolCallDetector(3);
    // First loop → recovery.
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    // Build up to a second loop.
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    expect(() => d.record('tool', { x: 1 })).toThrow(StuckLoopError);
  });

  test('second detection with DIFFERENT signature still throws', () => {
    // The recovery flag is global per detector — ANY second loop triggers
    // the abort, regardless of whether the signature matches the first.
    const d = new RepeatedToolCallDetector(3);
    // First loop with sig A.
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    // Second loop with sig B (different).
    d.record('tool', { y: 2 });
    d.record('tool', { y: 2 });
    expect(() => d.record('tool', { y: 2 })).toThrow(StuckLoopError);
  });

  test('after recovery, non-looping calls do NOT throw', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    // Varying calls — no second loop, no throw.
    expect(() => {
      d.record('tool', { x: 2 });
      d.record('tool', { x: 3 });
      d.record('tool', { x: 4 });
    }).not.toThrow();
  });

  test('StuckLoopError is exported from orchestrator/errors.js', () => {
    // Pin the import path — if this moves, the detector can't throw.
    expect(StuckLoopError).toBeDefined();
    expect(typeof StuckLoopError).toBe('function');
  });

  test('StuckLoopError thrown has the right shape', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    d.record('tool', { x: 1 });
    try {
      d.record('tool', { x: 1 });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(StuckLoopError);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/tool/);
    }
  });
});

// ---------------------------------------------------------------------------
// Recovery message — content and format
// ---------------------------------------------------------------------------

describe('recoveryMessage — content and format', () => {
  test('includes "[RECOVERY INTERVENTION]" prefix', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('myTool', { x: 1 });
    d.record('myTool', { x: 1 });
    const r = d.record('myTool', { x: 1 });
    expect(r.recoveryMessage).toContain('[RECOVERY INTERVENTION]');
  });

  test('includes the toolName', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('specialToolName', { x: 1 });
    d.record('specialToolName', { x: 1 });
    const r = d.record('specialToolName', { x: 1 });
    expect(r.recoveryMessage).toContain('specialToolName');
  });

  test('includes the maxSize as count', () => {
    const d = new RepeatedToolCallDetector(5);
    d.record('t', {});
    d.record('t', {});
    d.record('t', {});
    d.record('t', {});
    const r = d.record('t', {});
    expect(r.recoveryMessage).toContain('5');
    expect(r.recoveryMessage).toMatch(/5 times/);
  });

  test('includes JSON.stringify of args', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('t', { special: 'marker-xyz' });
    d.record('t', { special: 'marker-xyz' });
    const r = d.record('t', { special: 'marker-xyz' });
    expect(r.recoveryMessage).toContain('"special":"marker-xyz"');
  });

  test('mentions "loop" or "progress"', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('t', {});
    d.record('t', {});
    const r = d.record('t', {});
    // Message should convey "this is a loop / no progress".
    expect(/loop|progress/i.test(r.recoveryMessage!)).toBe(true);
  });

  test('is a non-empty string when loop is first detected', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('t', {});
    d.record('t', {});
    const r = d.record('t', {});
    expect(typeof r.recoveryMessage).toBe('string');
    expect(r.recoveryMessage!.length).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// reset() — clears window AND recovery flag
// ---------------------------------------------------------------------------

describe('reset — clears both window and recovery flag', () => {
  test('reset empties the window', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('a', {});
    d.record('b', {});
    expect(d.size).toBe(2);
    d.reset();
    expect(d.size).toBe(0);
  });

  test('reset clears hasRecoveryAttempted', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('t', {});
    d.record('t', {});
    d.record('t', {});
    expect(d.hasRecoveryAttempted).toBe(true);
    d.reset();
    expect(d.hasRecoveryAttempted).toBe(false);
  });

  test('after reset, a loop triggers RECOVERY (not StuckLoopError)', () => {
    const d = new RepeatedToolCallDetector(3);
    // First loop + recovery.
    d.record('t', {});
    d.record('t', {});
    d.record('t', {});
    expect(d.hasRecoveryAttempted).toBe(true);
    // Reset clears the recovery flag.
    d.reset();
    // Now a new loop should trigger recovery again, NOT throw.
    d.record('t', {});
    d.record('t', {});
    const r = d.record('t', {});
    expect(r.loopDetected).toBe(true);
    expect(r.recoveryMessage).toBeDefined();
  });

  test('reset on empty detector is a no-op', () => {
    const d = new RepeatedToolCallDetector(3);
    expect(() => d.reset()).not.toThrow();
    expect(d.size).toBe(0);
    expect(d.hasRecoveryAttempted).toBe(false);
  });

  test('reset returns undefined (void)', () => {
    const d = new RepeatedToolCallDetector(3);
    expect(d.reset()).toBeUndefined();
  });

  test('multiple resets in a row are safe', () => {
    const d = new RepeatedToolCallDetector(3);
    d.reset();
    d.reset();
    d.reset();
    expect(d.size).toBe(0);
    expect(d.hasRecoveryAttempted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Getters — size and hasRecoveryAttempted
// ---------------------------------------------------------------------------

describe('size getter — reflects current window length', () => {
  test('initial size is 0', () => {
    const d = new RepeatedToolCallDetector(3);
    expect(d.size).toBe(0);
  });

  test('size reflects pushes up to maxSize', () => {
    // Use distinct args so no loop triggers mid-fill.
    const d = new RepeatedToolCallDetector(3);
    d.record('a', { n: 1 });
    expect(d.size).toBe(1);
    d.record('a', { n: 2 });
    expect(d.size).toBe(2);
    d.record('a', { n: 3 });
    expect(d.size).toBe(3);
  });

  test('size does NOT exceed maxSize', () => {
    const d = new RepeatedToolCallDetector(3);
    for (let i = 0; i < 10; i++) {
      d.record('a', { n: i }); // distinct args → no loop
    }
    expect(d.size).toBeLessThanOrEqual(3);
  });

  test('size reflects post-recovery reset', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('t', {});
    d.record('t', {});
    d.record('t', {});
    expect(d.size).toBe(0); // cleared post-recovery
  });
});

describe('hasRecoveryAttempted getter — boolean state', () => {
  test('initial value is false', () => {
    const d = new RepeatedToolCallDetector(3);
    expect(d.hasRecoveryAttempted).toBe(false);
  });

  test('flips to true exactly after first loop detection', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('t', {});
    d.record('t', {});
    expect(d.hasRecoveryAttempted).toBe(false); // not yet
    d.record('t', {});
    expect(d.hasRecoveryAttempted).toBe(true); // now flipped
  });

  test('stays false when no loop detected', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('a', { n: 1 });
    d.record('a', { n: 2 });
    d.record('a', { n: 3 });
    d.record('a', { n: 4 });
    expect(d.hasRecoveryAttempted).toBe(false);
  });

  test('is always a boolean', () => {
    const d = new RepeatedToolCallDetector(3);
    expect(typeof d.hasRecoveryAttempted).toBe('boolean');
    d.record('t', {});
    d.record('t', {});
    d.record('t', {});
    expect(typeof d.hasRecoveryAttempted).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// RecordResult shape — type contracts
// ---------------------------------------------------------------------------

describe('RecordResult — shape invariants', () => {
  test('loopDetected is always a boolean', () => {
    const d = new RepeatedToolCallDetector(3);
    const r1 = d.record('a', {});
    expect(typeof r1.loopDetected).toBe('boolean');
    d.record('a', { n: 1 });
    d.record('a', { n: 1 });
    const r2 = d.record('a', { n: 1 });
    expect(typeof r2.loopDetected).toBe('boolean');
  });

  test('recoveryMessage is undefined when no loop', () => {
    const d = new RepeatedToolCallDetector(3);
    const r = d.record('a', {});
    expect(r.recoveryMessage).toBeUndefined();
  });

  test('recoveryMessage is undefined when window full but not uniform', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('a', { n: 1 });
    d.record('a', { n: 2 });
    const r = d.record('a', { n: 3 });
    expect(r.recoveryMessage).toBeUndefined();
  });

  test('recoveryMessage is a string when first loop detected', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('a', {});
    d.record('a', {});
    const r = d.record('a', {});
    expect(typeof r.recoveryMessage).toBe('string');
  });

  test('RecordResult has at most 2 keys', () => {
    const d = new RepeatedToolCallDetector(3);
    const r1 = d.record('a', {});
    expect(Object.keys(r1).length).toBeLessThanOrEqual(2);
    d.record('a', {});
    const r2 = d.record('a', {});
    expect(Object.keys(r2).length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Realistic scenarios — integration-flavored invariants
// ---------------------------------------------------------------------------

describe('realistic loop scenarios', () => {
  test('writeFile to same path 3x → loop detected', () => {
    const d = new RepeatedToolCallDetector(3);
    const args = { path: '/src/file.ts', content: 'export const x = 1;' };
    d.record('writeFile', args);
    d.record('writeFile', args);
    const r = d.record('writeFile', args);
    expect(r.loopDetected).toBe(true);
  });

  test('writeFile to different paths → no loop', () => {
    const d = new RepeatedToolCallDetector(3);
    d.record('writeFile', { path: '/a' });
    d.record('writeFile', { path: '/b' });
    const r = d.record('writeFile', { path: '/c' });
    expect(r.loopDetected).toBe(false);
  });

  test('editFile with identical replace_all → loop detected', () => {
    const d = new RepeatedToolCallDetector(3);
    const args = {
      file: '/x.ts',
      old: 'foo',
      new: 'bar',
      replace_all: false,
    };
    d.record('editFile', args);
    d.record('editFile', args);
    const r = d.record('editFile', args);
    expect(r.loopDetected).toBe(true);
  });

  test('agent breaks loop after recovery → no second throw', () => {
    const d = new RepeatedToolCallDetector(3);
    // First loop.
    d.record('writeFile', { path: '/a', content: 'x' });
    d.record('writeFile', { path: '/a', content: 'x' });
    d.record('writeFile', { path: '/a', content: 'x' });
    // After recovery, agent changes strategy.
    d.record('editFile', { file: '/a', old: 'x', new: 'y' });
    d.record('readFile', { file: '/a' });
    d.record('writeFile', { path: '/b', content: 'z' });
    expect(d.hasRecoveryAttempted).toBe(true);
    // No throw — agent broke out of the loop.
    expect(d.size).toBe(3);
  });

  test('agent falls back into loop → StuckLoopError', () => {
    const d = new RepeatedToolCallDetector(3);
    // First loop → recovery.
    for (let i = 0; i < 3; i++) {
      d.record('writeFile', { path: '/a' });
    }
    // Agent briefly varies, then falls back into the same loop.
    d.record('editFile', { file: '/a' });
    d.record('writeFile', { path: '/a' });
    d.record('writeFile', { path: '/a' });
    expect(() => d.record('writeFile', { path: '/a' })).toThrow(StuckLoopError);
  });
});
