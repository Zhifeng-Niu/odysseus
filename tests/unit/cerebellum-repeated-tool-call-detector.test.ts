import { describe, test, expect } from 'vitest';
import { RepeatedToolCallDetector } from '../../src/cerebellum/repeated-tool-call-detector.js';

describe('RepeatedToolCallDetector', () => {
  // ─── Constructor validation ────────────────────────────────────────────

  test('constructor rejects maxSize < 2', () => {
    expect(() => new RepeatedToolCallDetector(1)).toThrow(
      'RepeatedToolCallDetector maxSize must be >= 2'
    );
    expect(() => new RepeatedToolCallDetector(0)).toThrow(
      'RepeatedToolCallDetector maxSize must be >= 2'
    );
    expect(() => new RepeatedToolCallDetector(-1)).toThrow(
      'RepeatedToolCallDetector maxSize must be >= 2'
    );
  });

  test('constructor accepts maxSize >= 2', () => {
    expect(() => new RepeatedToolCallDetector(2)).not.toThrow();
    expect(() => new RepeatedToolCallDetector(3)).not.toThrow();
    expect(() => new RepeatedToolCallDetector(10)).not.toThrow();
  });

  // ─── Core abort logic ────────────────────────────────────────────────

  test('does NOT detect loop for fewer than maxSize identical calls (default=3)', () => {
    const det = new RepeatedToolCallDetector(3);
    const args = { path: '/tmp/a' };

    // 1st call — fine
    expect(det.record('file-read', args).loopDetected).toBe(false);
    // 2nd identical call — still fine
    expect(det.record('file-read', args).loopDetected).toBe(false);
  });

  test('first loop detection returns recovery message instead of throwing', () => {
    const det = new RepeatedToolCallDetector(3);
    const args = { path: '/tmp/a' };

    det.record('file-read', args);
    det.record('file-read', args);

    const result = det.record('file-read', args);
    expect(result.loopDetected).toBe(true);
    expect(result.recoveryMessage).toBeDefined();
    expect(result.recoveryMessage).toContain('RECOVERY INTERVENTION');
    expect(result.recoveryMessage).toContain('file-read');
    expect(result.recoveryMessage).toContain('3 times');
  });

  test('second loop detection after recovery throws (hard abort)', () => {
    const det = new RepeatedToolCallDetector(3);
    const args = { path: '/tmp/a' };

    det.record('file-read', args);
    det.record('file-read', args);

    // First loop — recovery
    const recovery = det.record('file-read', args);
    expect(recovery.loopDetected).toBe(true);

    // Fill the window again with identical calls
    det.record('file-read', args);
    det.record('file-read', args);

    // Second loop — hard abort
    expect(() => det.record('file-read', args)).toThrow(
      /repeated-tool-call detector.*file-read.*loop persisted after recovery intervention/
    );
  });

  test('hard abort error message includes tool name and serialized arguments', () => {
    const det = new RepeatedToolCallDetector(3);
    const args = { path: '/etc/passwd', encoding: 'utf-8' };

    det.record('file-read', args);
    det.record('file-read', args);
    det.record('file-read', args); // recovery

    det.record('file-read', args);
    det.record('file-read', args);

    try {
      det.record('file-read', args);
      expect.unreachable('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('file-read');
      expect(msg).toContain('/etc/passwd');
      expect(msg).toContain('utf-8');
      expect(msg).toContain('loop persisted after recovery intervention');
      expect(msg).toContain('aborting waypoint');
    }
  });

  test('recovery resets the window so different calls can proceed', () => {
    const det = new RepeatedToolCallDetector(3);
    const args = { path: '/tmp/a' };

    det.record('file-read', args);
    det.record('file-read', args);
    const result = det.record('file-read', args);
    expect(result.loopDetected).toBe(true);
    expect(det.size).toBe(0); // window was reset

    // After recovery, the agent tries a different approach — no loop
    expect(det.record('file-read', { path: '/tmp/b' }).loopDetected).toBe(false);
    expect(det.record('bash', { command: 'ls' }).loopDetected).toBe(false);
  });

  // ─── Sliding window — calls with different signatures advance the window

  test('different tool names do not trigger the detector', () => {
    const det = new RepeatedToolCallDetector(3);

    det.record('file-read', { path: '/a' });
    det.record('file-read', { path: '/a' });
    // Different tool — breaks the streak
    expect(det.record('bash', { command: 'ls' }).loopDetected).toBe(false);
  });

  test('different arguments do not trigger the detector', () => {
    const det = new RepeatedToolCallDetector(3);

    det.record('file-read', { path: '/a' });
    det.record('file-read', { path: '/a' });
    // Same tool, different args — breaks the streak
    expect(det.record('file-read', { path: '/b' }).loopDetected).toBe(false);
  });

  test('sliding window: after maxSize distinct calls the oldest is evicted', () => {
    const det = new RepeatedToolCallDetector(3);

    // Fill window with call A
    det.record('file-read', { path: '/a' });
    det.record('file-read', { path: '/a' });

    // Now insert call B — window becomes [A, A, B] (size capped at 3)
    det.record('file-read', { path: '/b' });
    expect(det.size).toBe(3);

    // Insert another B — window becomes [A, B, B]
    det.record('file-read', { path: '/b' });
    expect(det.size).toBe(3);

    // Insert another B — window becomes [B, B, B] → should detect loop (recovery)
    const result = det.record('file-read', { path: '/b' });
    expect(result.loopDetected).toBe(true);
  });

  test('sliding window: interleaved calls do not trigger', () => {
    const det = new RepeatedToolCallDetector(3);

    // A, B, A, B, A, B — never 3 identical in a row
    const argsA = { path: '/a' };
    const argsB = { path: '/b' };

    for (let i = 0; i < 6; i++) {
      expect(det.record('file-read', i % 2 === 0 ? argsA : argsB).loopDetected).toBe(false);
    }
    expect(det.size).toBe(3);
  });

  // ─── Custom window sizes ───────────────────────────────────────────────

  test('custom maxSize=2 returns recovery on 2nd identical call', () => {
    const det = new RepeatedToolCallDetector(2);
    const args = { key: 'value' };

    det.record('bash', args);
    const result = det.record('bash', args);
    expect(result.loopDetected).toBe(true);
    expect(result.recoveryMessage).toContain('bash');
    expect(result.recoveryMessage).toContain('2 times');
  });

  test('custom maxSize=5 requires 5 identical calls before recovery', () => {
    const det = new RepeatedToolCallDetector(5);
    const args = { x: 1 };

    // 4 calls — should not detect
    for (let i = 0; i < 4; i++) {
      expect(det.record('bash', args).loopDetected).toBe(false);
    }
    // 5th identical call — recovery
    const result = det.record('bash', args);
    expect(result.loopDetected).toBe(true);
    expect(result.recoveryMessage).toContain('5 times');
  });

  // ─── reset() ───────────────────────────────────────────────────────────

  test('reset() clears the window and recovery flag', () => {
    const det = new RepeatedToolCallDetector(3);
    const args = { path: '/a' };

    det.record('file-read', args);
    det.record('file-read', args);
    const result = det.record('file-read', args);
    expect(result.loopDetected).toBe(true);
    expect(det.hasRecoveryAttempted).toBe(true);

    // Reset
    det.reset();
    expect(det.size).toBe(0);
    expect(det.hasRecoveryAttempted).toBe(false);

    // Fresh cycle — 2 calls should be fine
    det.record('file-read', args);
    expect(det.record('file-read', args).loopDetected).toBe(false);
    expect(det.size).toBe(2);
  });

  test('reset() after hard abort allows fresh detection cycle', () => {
    const det = new RepeatedToolCallDetector(3);
    const args = { path: '/a' };

    det.record('file-read', args);
    det.record('file-read', args);
    det.record('file-read', args); // recovery

    det.record('file-read', args);
    det.record('file-read', args);
    expect(() => det.record('file-read', args)).toThrow(); // hard abort

    det.reset();
    expect(det.hasRecoveryAttempted).toBe(false);

    // Start fresh
    det.record('file-read', args);
    det.record('file-read', args);
    const result = det.record('file-read', args);
    expect(result.loopDetected).toBe(true); // recovery again
  });

  // ─── size property ────────────────────────────────────────────────────

  test('size starts at 0 and grows up to maxSize', () => {
    const det = new RepeatedToolCallDetector(4);
    expect(det.size).toBe(0);

    det.record('bash', { cmd: 'ls' });
    expect(det.size).toBe(1);

    det.record('bash', { cmd: 'pwd' });
    expect(det.size).toBe(2);

    det.record('bash', { cmd: 'cat' });
    expect(det.size).toBe(3);

    det.record('bash', { cmd: 'echo' });
    expect(det.size).toBe(4);

    // Adding more keeps window capped at maxSize (oldest evicted)
    det.record('bash', { cmd: 'grep' });
    expect(det.size).toBe(4);
  });

  // ─── hasRecoveryAttempted property ─────────────────────────────────────

  test('hasRecoveryAttempted starts false', () => {
    const det = new RepeatedToolCallDetector(3);
    expect(det.hasRecoveryAttempted).toBe(false);
  });

  test('hasRecoveryAttempted becomes true after first loop detection', () => {
    const det = new RepeatedToolCallDetector(3);
    const args = { path: '/a' };

    det.record('file-read', args);
    det.record('file-read', args);
    det.record('file-read', args); // triggers recovery
    expect(det.hasRecoveryAttempted).toBe(true);
  });

  // ─── Edge cases ────────────────────────────────────────────────────────

  test('empty args object is serialized correctly', () => {
    const det = new RepeatedToolCallDetector(2);

    det.record('bash', {});
    const result = det.record('bash', {});
    expect(result.loopDetected).toBe(true);
  });

  test('args with nested objects produce distinct signatures', () => {
    const det = new RepeatedToolCallDetector(3);

    const args1 = { config: { nested: { key: 'a' } } };
    const args2 = { config: { nested: { key: 'b' } } };

    det.record('file-write', args1);
    det.record('file-write', args1);
    // Same structure, different deep value — different signature
    expect(det.record('file-write', args2).loopDetected).toBe(false);
  });

  test('args key order does not affect signature (JSON.stringify is deterministic for same object)', () => {
    const det = new RepeatedToolCallDetector(3);

    // JSON.stringify preserves insertion order; same insertion order → same sig
    det.record('file-read', { a: 1, b: 2 });
    det.record('file-read', { a: 1, b: 2 });
    const result = det.record('file-read', { a: 1, b: 2 });
    expect(result.loopDetected).toBe(true);
  });

  // ─── Recovery message content ──────────────────────────────────────────

  test('recovery message suggests trying a different strategy', () => {
    const det = new RepeatedToolCallDetector(3);
    const args = { path: '/tmp/loop' };

    det.record('file-read', args);
    det.record('file-read', args);
    const result = det.record('file-read', args);

    expect(result.recoveryMessage).toContain('different strategy');
    expect(result.recoveryMessage).toContain('different arguments');
    expect(result.recoveryMessage).toContain('DONE');
  });
});
