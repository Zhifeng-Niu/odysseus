import { describe, test, expect } from 'vitest';
import {
  summarizeToolCall,
  detectPattern,
  buildSelfMonitorObservation,
  SELF_MONITOR_WINDOW,
  type ToolCallObservation,
} from '../../src/cerebellum/self-monitor.js';

function call(tool: string, target?: string): ToolCallObservation {
  return target !== undefined ? { tool, target } : { tool };
}

describe('self-monitor', () => {
  describe('SELF_MONITOR_WINDOW', () => {
    test('window is 6 (keeps nudge on one screen line)', () => {
      expect(SELF_MONITOR_WINDOW).toBe(6);
    });
  });

  describe('summarizeToolCall', () => {
    test('extracts path from { path } arg shape', () => {
      const obs = summarizeToolCall('file-read', { path: '/abs/path/to/src/foo.ts' });
      expect(obs.tool).toBe('file-read');
      // Last 2 segments only — cwd is implicit.
      expect(obs.target).toBe('src/foo.ts');
    });

    test('extracts path from { file_path } arg shape (alternate spelling)', () => {
      const obs = summarizeToolCall('file-edit', { file_path: 'src/cerebellum/x.ts' });
      expect(obs.target).toBe('cerebellum/x.ts');
    });

    test('extracts command from { command } arg shape (truncated)', () => {
      const longCmd = 'npm run test -- --grep some-very-long-pattern-that-exceeds-the-limit';
      const obs = summarizeToolCall('bash', { command: longCmd });
      expect(obs.target).toBeDefined();
      expect(obs.target!.length).toBeLessThanOrEqual(40);
      expect(obs.target).toContain('…');
    });

    test('extracts message from { message } arg shape', () => {
      const obs = summarizeToolCall('git-commit', { message: 'feat: add thing' });
      expect(obs.target).toBe('feat: add thing');
    });

    test('returns tool-only when args have no recognized shape', () => {
      const obs = summarizeToolCall('git-status', {});
      expect(obs.tool).toBe('git-status');
      expect(obs.target).toBeUndefined();
    });

    test('returns tool-only when args is not an object', () => {
      expect(summarizeToolCall('bash', null).target).toBeUndefined();
      expect(summarizeToolCall('bash', undefined).target).toBeUndefined();
      expect(summarizeToolCall('bash', 'string-not-object').target).toBeUndefined();
      expect(summarizeToolCall('bash', [1, 2, 3]).target).toBeUndefined();
    });

    test('ignores empty-string paths/commands', () => {
      expect(summarizeToolCall('file-read', { path: '   ' }).target).toBeUndefined();
      expect(summarizeToolCall('bash', { command: '' }).target).toBeUndefined();
    });

    test('short paths are not truncated', () => {
      const obs = summarizeToolCall('file-read', { path: 'package.json' });
      expect(obs.target).toBe('package.json');
    });
  });

  describe('detectPattern — stuck loop', () => {
    test('same tool + same target 3 times in a row → stuck loop', () => {
      const recent = [
        call('bash', 'npm test'),
        call('bash', 'npm test'),
        call('bash', 'npm test'),
      ];
      const pattern = detectPattern(recent, 3);
      expect(pattern).toContain('stuck loop');
      expect(pattern).toContain('bash');
      expect(pattern).toContain('npm test');
    });

    test('same tool + same target at end of longer window still detects', () => {
      const recent = [
        call('file-read', 'a.ts'),
        call('file-read', 'b.ts'),
        call('bash', 'npm test'),
        call('bash', 'npm test'),
        call('bash', 'npm test'),
      ];
      const pattern = detectPattern(recent, 5);
      expect(pattern).toContain('stuck loop');
    });

    test('same tool 3x with DIFFERENT targets is NOT a stuck loop (streak instead)', () => {
      const recent = [
        call('file-read', 'a.ts'),
        call('file-read', 'b.ts'),
        call('file-read', 'c.ts'),
      ];
      const pattern = detectPattern(recent, 3);
      expect(pattern).not.toContain('stuck loop');
      // Should fall through to the same-tool streak pattern.
      expect(pattern).toContain('file-read');
    });

    test('same tool 3x with undefined target still detects stuck loop', () => {
      // E.g., git-status called 3x — no args, but repeating.
      const recent = [
        call('git-status'),
        call('git-status'),
        call('git-status'),
      ];
      const pattern = detectPattern(recent, 3);
      expect(pattern).toContain('stuck loop');
    });

    test('only 2 same calls does NOT trigger stuck loop (need 3)', () => {
      const recent = [
        call('bash', 'npm test'),
        call('bash', 'npm test'),
      ];
      const pattern = detectPattern(recent, 2);
      // No pattern matches at low count → null.
      expect(pattern).toBeNull();
    });
  });

  describe('detectPattern — same-tool streak', () => {
    test('3 file-read calls with different targets → streak, not stuck', () => {
      const recent = [
        call('file-read', 'a.ts'),
        call('file-read', 'b.ts'),
        call('file-read', 'c.ts'),
      ];
      const pattern = detectPattern(recent, 3);
      expect(pattern).toContain('file-read');
      expect(pattern).toContain('a.ts');
      expect(pattern).toContain('c.ts');
      expect(pattern).toMatch(/streak|healthy|verifying/i);
    });

    test('mixed tools → no streak detected', () => {
      const recent = [
        call('file-read', 'a.ts'),
        call('file-edit', 'a.ts'),
        call('bash', 'npm test'),
      ];
      // No 3-in-a-row same tool → falls through to other checks.
      // With only 1 read call, breadth check doesn't fire either.
      // Returns null at low count.
      expect(detectPattern(recent, 3)).toBeNull();
    });
  });

  describe('detectPattern — breadth without action', () => {
    test('3 reads, 0 writes → breadth signal', () => {
      const recent = [
        call('file-read', 'a.ts'),
        call('file-read', 'b.ts'),
        call('git-log'),
      ];
      const pattern = detectPattern(recent, 3);
      expect(pattern).toContain('exploring');
      expect(pattern).toContain('Pick');
    });

    test('reads mixed with writes → no breadth signal', () => {
      const recent = [
        call('file-read', 'a.ts'),
        call('file-edit', 'a.ts'),
        call('file-read', 'b.ts'),
      ];
      // writeCount > 0 so breadth check doesn't fire.
      // No same-tool streak. Returns null at low count.
      expect(detectPattern(recent, 3)).toBeNull();
    });
  });

  describe('detectPattern — high-count no-DONE', () => {
    test('totalCallCount ≥ 9 with no other pattern → high-count signal', () => {
      const recent = [
        call('file-read', 'a.ts'),
        call('file-edit', 'a.ts'),
      ];
      const pattern = detectPattern(recent, 9);
      expect(pattern).toContain('9 tool calls');
      expect(pattern).toContain('DONE');
    });

    test('totalCallCount < 9 with no pattern → null', () => {
      const recent = [
        call('file-read', 'a.ts'),
        call('file-edit', 'a.ts'),
      ];
      expect(detectPattern(recent, 8)).toBeNull();
    });
  });

  describe('detectPattern — empty / healthy cases', () => {
    test('empty recent returns null', () => {
      expect(detectPattern([], 0)).toBeNull();
    });

    test('single call returns null', () => {
      expect(detectPattern([call('file-read', 'a.ts')], 1)).toBeNull();
    });

    test('diverse recent at moderate count returns null (healthy rhythm)', () => {
      const recent = [
        call('file-read', 'a.ts'),
        call('file-edit', 'a.ts'),
        call('bash', 'npm test'),
        call('file-read', 'b.ts'),
      ];
      // No 3-in-a-row, has writes, count under 9 → null.
      expect(detectPattern(recent, 4)).toBeNull();
    });
  });

  describe('buildSelfMonitorObservation', () => {
    test('always starts with [self-monitor] tag and call count', () => {
      const nudge = buildSelfMonitorObservation([call('file-read', 'a.ts')], 1);
      expect(nudge.startsWith('[self-monitor]')).toBe(true);
      expect(nudge).toContain('1 tool call');
    });

    test('pluralizes correctly (1 call vs N calls)', () => {
      expect(buildSelfMonitorObservation([call('x')], 1)).toContain('1 tool call');
      expect(buildSelfMonitorObservation([call('x')], 3)).toContain('3 tool calls');
    });

    test('lists recent sequence with targets in parentheses', () => {
      const recent = [
        call('file-read', 'a.ts'),
        call('bash', 'npm test'),
        call('file-edit'),
      ];
      const nudge = buildSelfMonitorObservation(recent, 3);
      expect(nudge).toContain('file-read(a.ts)');
      expect(nudge).toContain('bash(npm test)');
      expect(nudge).toContain('file-edit');
    });

    test('handles empty recent sequence gracefully', () => {
      const nudge = buildSelfMonitorObservation([], 0);
      expect(nudge).toContain('(no recent calls)');
    });

    test('appends detected pattern observation when one matches', () => {
      const stuck = [
        call('bash', 'npm test'),
        call('bash', 'npm test'),
        call('bash', 'npm test'),
      ];
      const nudge = buildSelfMonitorObservation(stuck, 3);
      expect(nudge).toContain('stuck loop');
    });

    test('appends "Keep going" fallback when no pattern matches', () => {
      const healthy = [
        call('file-read', 'a.ts'),
        call('file-edit', 'a.ts'),
      ];
      const nudge = buildSelfMonitorObservation(healthy, 2);
      expect(nudge).toContain('Keep going');
    });
  });
});
