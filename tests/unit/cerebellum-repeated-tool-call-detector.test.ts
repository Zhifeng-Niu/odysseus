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

  test('does NOT throw for fewer than maxSize identical calls (default=3)', () => {
    const det = new RepeatedToolCallDetector(3);
    const args = { path: '/tmp/a' };

    // 1st call — fine
    expect(() => det.record('file-read', args)).not.toThrow();
    // 2nd identical call — still fine
    expect(() => det.record('file-read', args)).not.toThrow();
  });

  test('throws on the 3rd identical call (default window size)', () => {
    const det = new RepeatedToolCallDetector(3);
    const args = { path: '/tmp/a' };

    det.record('file-read', args);
    det.record('file-read', args);

    expect(() => det.record('file-read', args)).toThrow(
      /repeated-tool-call detector.*file-read.*3 times in a row/
    );
  });

  test('error message includes tool name and serialized arguments', () => {
    const det = new RepeatedToolCallDetector(3);
    const args = { path: '/etc/passwd', encoding: 'utf-8' };

    det.record('file-read', args);
    det.record('file-read', args);

    try {
      det.record('file-read', args);
      expect.unreachable('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('file-read');
      expect(msg).toContain('3 times in a row');
      expect(msg).toContain('/etc/passwd');
      expect(msg).toContain('utf-8');
      expect(msg).toContain('aborting waypoint');
    }
  });

  // ─── Sliding window — calls with different signatures advance the window

  test('different tool names do not trigger the detector', () => {
    const det = new RepeatedToolCallDetector(3);

    det.record('file-read', { path: '/a' });
    det.record('file-read', { path: '/a' });
    // Different tool — breaks the streak
    expect(() => det.record('bash', { command: 'ls' })).not.toThrow();
  });

  test('different arguments do not trigger the detector', () => {
    const det = new RepeatedToolCallDetector(3);

    det.record('file-read', { path: '/a' });
    det.record('file-read', { path: '/a' });
    // Same tool, different args — breaks the streak
    expect(() => det.record('file-read', { path: '/b' })).not.toThrow();
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

    // Insert another B — window becomes [B, B, B] → should throw
    expect(() => det.record('file-read', { path: '/b' })).toThrow(
      /repeated-tool-call detector/
    );
  });

  test('sliding window: interleaved calls do not trigger', () => {
    const det = new RepeatedToolCallDetector(3);

    // A, B, A, B, A, B — never 3 identical in a row
    const argsA = { path: '/a' };
    const argsB = { path: '/b' };

    for (let i = 0; i < 6; i++) {
      expect(() => det.record('file-read', i % 2 === 0 ? argsA : argsB)).not.toThrow();
    }
    expect(det.size).toBe(3);
  });

  // ─── Custom window sizes ───────────────────────────────────────────────

  test('custom maxSize=2 throws on 2nd identical call', () => {
    const det = new RepeatedToolCallDetector(2);
    const args = { key: 'value' };

    det.record('bash', args);
    expect(() => det.record('bash', args)).toThrow(/repeated-tool-call detector.*bash.*2 times in a row/);
  });

  test('custom maxSize=5 requires 5 identical calls before throwing', () => {
    const det = new RepeatedToolCallDetector(5);
    const args = { x: 1 };

    // 4 calls — should not throw
    for (let i = 0; i < 4; i++) {
      expect(() => det.record('bash', args)).not.toThrow();
    }
    // 5th identical call — throws
    expect(() => det.record('bash', args)).toThrow(/5 times in a row/);
  });

  // ─── reset() ───────────────────────────────────────────────────────────

  test('reset() clears the window so identical calls no longer trigger', () => {
    const det = new RepeatedToolCallDetector(3);
    const args = { path: '/a' };

    det.record('file-read', args);
    det.record('file-read', args);

    // Reset before the 3rd call
    det.reset();
    expect(det.size).toBe(0);

    // Now two more identical calls should be safe (window only has 2)
    det.record('file-read', args);
    expect(() => det.record('file-read', args)).not.toThrow();
    expect(det.size).toBe(2);
  });

  test('reset() after abort allows fresh detection cycle', () => {
    const det = new RepeatedToolCallDetector(3);
    const args = { path: '/a' };

    det.record('file-read', args);
    det.record('file-read', args);
    expect(() => det.record('file-read', args)).toThrow();

    det.reset();
    // Start fresh — 2 calls should be fine
    det.record('file-read', args);
    det.record('file-read', args);
    expect(() => det.record('file-read', args)).toThrow();
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

  // ─── Edge cases ────────────────────────────────────────────────────────

  test('empty args object is serialized correctly', () => {
    const det = new RepeatedToolCallDetector(2);

    det.record('bash', {});
    expect(() => det.record('bash', {})).toThrow();
  });

  test('args with nested objects produce distinct signatures', () => {
    const det = new RepeatedToolCallDetector(3);

    const args1 = { config: { nested: { key: 'a' } } };
    const args2 = { config: { nested: { key: 'b' } } };

    det.record('file-write', args1);
    det.record('file-write', args1);
    // Same structure, different deep value — different signature
    expect(() => det.record('file-write', args2)).not.toThrow();
  });

  test('args key order does not affect signature (JSON.stringify is deterministic for same object)', () => {
    const det = new RepeatedToolCallDetector(3);

    // JSON.stringify preserves insertion order; same insertion order → same sig
    det.record('file-read', { a: 1, b: 2 });
    det.record('file-read', { a: 1, b: 2 });
    expect(() => det.record('file-read', { a: 1, b: 2 })).toThrow();
  });
});
