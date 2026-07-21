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

function callErr(tool: string, target?: string): ToolCallObservation {
  return target !== undefined ? { tool, target, error: true } : { tool, error: true };
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

    test('isError=true (3rd arg) adds error: true to observation', () => {
      const obs = summarizeToolCall('file-read', { path: 'a.ts' }, true);
      expect(obs.tool).toBe('file-read');
      expect(obs.target).toBe('a.ts');
      expect(obs.error).toBe(true);
    });

    test('isError=false is treated as "no error" (error field omitted)', () => {
      // exactOptionalPropertyTypes: must not produce { error: undefined }
      const obs = summarizeToolCall('file-read', { path: 'a.ts' }, false);
      expect(obs.error).toBeUndefined();
      expect(obs.tool).toBe('file-read');
      expect(obs.target).toBe('a.ts');
    });

    test('isError omitted behaves identically to isError=false', () => {
      const obs = summarizeToolCall('file-read', { path: 'a.ts' });
      expect(obs.error).toBeUndefined();
    });

    test('error flag works on tool-only observations (no target)', () => {
      const obs = summarizeToolCall('git-status', {}, true);
      expect(obs.tool).toBe('git-status');
      expect(obs.target).toBeUndefined();
      expect(obs.error).toBe(true);
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

  describe('detectPattern — error-loop (Iteration 14)', () => {
    test('last 2 calls both errored → error-loop signal', () => {
      const recent = [
        call('file-read', 'a.ts'),
        callErr('file-edit', 'b.ts'),
        callErr('file-edit', 'b.ts'),
      ];
      const pattern = detectPattern(recent, 3);
      expect(pattern).toContain('errored');
      expect(pattern).toContain('re-read');
      // Concrete failing calls named.
      expect(pattern).toContain('file-edit');
    });

    test('error-loop fires even when the 2 failing calls target different things', () => {
      // Distinct from stuck-loop — error-loop doesn't require same args.
      const recent = [
        call('file-read', 'a.ts'),
        callErr('file-edit', 'b.ts'),
        callErr('bash', 'npm test'),
      ];
      const pattern = detectPattern(recent, 3);
      expect(pattern).toContain('errored');
      // Both failing tools named so LLM can recognize them.
      expect(pattern).toContain('file-edit');
      expect(pattern).toContain('bash');
    });

    test('only 1 error in last 2 calls → no error-loop (single error is normal)', () => {
      const recent = [
        call('file-read', 'a.ts'),
        callErr('file-edit', 'b.ts'),
        call('file-read', 'c.ts'),
      ];
      // Last call did NOT error — no error-loop.
      // No other pattern matches either (no 3-streak, has write).
      expect(detectPattern(recent, 3)).toBeNull();
    });

    test('2 errors earlier in window but last call succeeded → no error-loop', () => {
      const recent = [
        callErr('file-read', 'a.ts'),
        callErr('file-read', 'b.ts'),
        call('file-read', 'c.ts'),
      ];
      // The 2 errors are not the *last* 2 calls.
      // But this triggers same-tool streak (3 file-reads) — streak wins.
      const pattern = detectPattern(recent, 3);
      expect(pattern).not.toContain('errored');
      expect(pattern).toContain('file-read');
    });

    test('stuck-loop takes priority over error-loop', () => {
      // Same call, same target, 3x, all erroring.
      // Stuck-loop is the more specific diagnosis ("same args 3x").
      const recent = [
        callErr('bash', 'npm test'),
        callErr('bash', 'npm test'),
        callErr('bash', 'npm test'),
      ];
      const pattern = detectPattern(recent, 3);
      expect(pattern).toContain('stuck loop');
      expect(pattern).not.toContain('errored');
    });

    test('error-loop with only 1 entry in window → no signal (need 2)', () => {
      expect(detectPattern([callErr('bash')], 1)).toBeNull();
    });

    test('error-loop fires at low call count (2 calls, both errored)', () => {
      // Don't require totalCallCount ≥ some threshold — 2 errors is
      // already a strong signal regardless of total budget spent.
      const recent = [
        callErr('bash', 'npm test'),
        callErr('bash', 'npm run build'),
      ];
      const pattern = detectPattern(recent, 2);
      expect(pattern).toContain('errored');
    });

    test('error message warns against blind retry', () => {
      const recent = [
        callErr('bash', 'npm test'),
        callErr('bash', 'npm test'),
      ];
      const pattern = detectPattern(recent, 2);
      expect(pattern).toContain('same args will likely fail');
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

  describe('pattern extraction (Iteration 48)', () => {
    // Iteration 48 moved detectPattern + its 4 detectors (stuckLoop,
    // sameToolStreak, breadthWithoutAction, errorLoop) + READ/WRITE tool
    // constants + formatEntry helper from self-monitor.ts to
    // self-monitor-patterns.ts (mirrors Iter 44 curiosity-prompt and
    // Iter 47 dreamer-prompt extractions). These tests pin the extraction
    // so a future refactor cannot silently re-inline the code.

    test('detectPattern lives in self-monitor-patterns.ts', async () => {
      const { readFile } = await import('node:fs/promises');
      const patternsSrc = await readFile(
        'src/cerebellum/self-monitor-patterns.ts',
        'utf8',
      );
      const monitorSrc = await readFile(
        'src/cerebellum/self-monitor.ts',
        'utf8',
      );
      expect(patternsSrc).toContain('export function detectPattern');
      expect(patternsSrc).toContain('function detectStuckLoop');
      expect(patternsSrc).toContain('function detectSameToolStreak');
      expect(patternsSrc).toContain('function detectBreadthWithoutAction');
      expect(patternsSrc).toContain('function detectErrorLoop');
      // The detectors must NOT be re-defined in self-monitor.ts.
      expect(monitorSrc).not.toContain('function detectPattern');
      expect(monitorSrc).not.toContain('function detectStuckLoop');
      expect(monitorSrc).not.toContain('function detectErrorLoop');
    });

    test('self-monitor.ts imports the extracted symbols (not re-defines them)', async () => {
      const { readFile } = await import('node:fs/promises');
      const monitorSrc = await readFile(
        'src/cerebellum/self-monitor.ts',
        'utf8',
      );
      expect(monitorSrc).toContain("from './self-monitor-patterns.js'");
      // buildSelfMonitorObservation in self-monitor.ts must use the
      // imported detectPattern and formatEntry, not its own copies.
      // If the import line is stripped, the file won't compile.
      expect(monitorSrc).toMatch(
        /import\s*\{[^}]*detectPattern[^}]*\}\s*from\s*'\.\/self-monitor-patterns\.js'/,
      );
    });

    test('self-monitor.ts re-exports detectPattern for backwards compat', async () => {
      // self-monitor.test.ts imports detectPattern from self-monitor.js.
      // The re-export pattern mirrors Iter 42 planner-policy, Iter 44
      // curiosity-prompt, and Iter 47 dreamer-prompt.
      const { readFile } = await import('node:fs/promises');
      const monitorSrc = await readFile(
        'src/cerebellum/self-monitor.ts',
        'utf8',
      );
      expect(monitorSrc).toContain(
        "export { detectPattern } from './self-monitor-patterns.js';",
      );
    });
  });
});
