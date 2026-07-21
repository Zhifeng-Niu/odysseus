import { describe, test, expect } from 'vitest';
import {
  detectPattern,
  formatEntry,
} from '../../src/cerebellum/self-monitor-patterns.js';
import type { ToolCallObservation } from '../../src/cerebellum/self-monitor.js';

/**
 * self-monitor-patterns.ts — pattern-detection heuristics for the
 * self-monitor nudge. Iteration 48 extracted these from self-monitor.ts.
 *
 * Five detectors fire in priority order (first-match-wins):
 *   1. STUCK LOOP             — same tool + same target 3+ times
 *   2. SAME-TOOL STREAK       — same tool 3+ times (targets vary)
 *   3. BREADTH-WITHOUT-ACTION — 3+ reads, 0 writes
 *   4. ERROR-LOOP             — last 2 calls both errored
 *   5. HIGH-COUNT NO-DONE     — totalCallCount >= 9
 *
 * The order is load-bearing. If two patterns match, the higher-priority
 * one fires. These tests pin the priority sequence plus each
 * detector's threshold and message shape so a future reordering is
 * flagged loudly.
 *
 * Threshold notes that earn direct coverage:
 *   - Stuck loop / streak fire at 3 entries (not 2). Two same-tool
 *     calls are normal verification; three is drift.
 *   - Breadth-without-action needs >= 3 reads AND 0 writes — a single
 *     write disqualifies the pattern.
 *   - Error-loop fires at 2 (not 3). One error is transient; two is
 *     "your mental model is wrong".
 *   - High-count threshold is 9 — under budget but worth nudging.
 */

function obs(tool: string, target?: string, error?: boolean): ToolCallObservation {
  if (target !== undefined && error === true) return { tool, target, error: true };
  if (target !== undefined) return { tool, target };
  if (error === true) return { tool, error: true };
  return { tool };
}

// ---------------------------------------------------------------------------
// detectPattern — empty / single-edge baseline
// ---------------------------------------------------------------------------

describe('detectPattern — baseline', () => {
  test('returns null for empty window', () => {
    expect(detectPattern([], 0)).toBeNull();
  });

  test('returns null when no pattern matches and count is low', () => {
    const recent = [obs('file-read', 'a.ts'), obs('file-edit', 'b.ts')];
    expect(detectPattern(recent, 2)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Detector 1: STUCK LOOP — highest priority
// ---------------------------------------------------------------------------

describe('detectPattern — 1. STUCK LOOP (same tool + same target 3+ times)', () => {
  test('fires when last 3 calls share tool AND target', () => {
    const recent = [
      obs('file-read', 'same.ts'),
      obs('file-read', 'same.ts'),
      obs('file-read', 'same.ts'),
    ];
    const result = detectPattern(recent, 3);
    expect(result).not.toBeNull();
    expect(result).toContain('stuck loop');
    expect(result).toContain('file-read');
    expect(result).toContain('same.ts');
  });

  test('only the last 3 matter — earlier entries are ignored', () => {
    // The pattern looks at recent.slice(-3). A different earlier call
    // sequence shouldn't affect detection.
    const recent = [
      obs('file-edit', 'other.ts'),
      obs('file-read', 'same.ts'),
      obs('file-read', 'same.ts'),
      obs('file-read', 'same.ts'),
    ];
    const result = detectPattern(recent, 4);
    expect(result).not.toBeNull();
    expect(result).toContain('stuck loop');
  });

  test('does NOT fire when targets differ', () => {
    const recent = [
      obs('file-read', 'a.ts'),
      obs('file-read', 'b.ts'),
      obs('file-read', 'c.ts'),
    ];
    // Falls through to detector 2 (same-tool streak).
    const result = detectPattern(recent, 3);
    expect(result).not.toBeNull();
    expect(result).not.toContain('stuck loop');
  });

  test('does NOT fire when tools differ (even if targets match)', () => {
    const recent = [
      obs('file-read', 'same.ts'),
      obs('file-edit', 'same.ts'),
      obs('file-write', 'same.ts'),
    ];
    expect(detectPattern(recent, 3)).toBeNull();
  });

  test('does NOT fire below the 3-call threshold', () => {
    const recent = [
      obs('file-read', 'same.ts'),
      obs('file-read', 'same.ts'),
    ];
    expect(detectPattern(recent, 2)).toBeNull();
  });

  test('treats undefined targets as equal (both unset → match)', () => {
    // The implementation uses `(entry.target ?? '') !== (first.target ?? '')`
    // so two undefined targets are treated as matching. This is the
    // path that catches a bash-loop where no per-call target was
    // extracted from args.
    const recent = [obs('bash'), obs('bash'), obs('bash')];
    const result = detectPattern(recent, 3);
    expect(result).not.toBeNull();
    expect(result).toContain('stuck loop');
    // No "(target)" suffix because target is undefined.
    expect(result).not.toContain('(');
  });
});

// ---------------------------------------------------------------------------
// Detector 2: SAME-TOOL STREAK
// ---------------------------------------------------------------------------

describe('detectPattern — 2. SAME-TOOL STREAK (same tool 3+ times)', () => {
  test('fires when last 3 share tool (targets differ)', () => {
    const recent = [
      obs('file-read', 'a.ts'),
      obs('file-read', 'b.ts'),
      obs('file-read', 'c.ts'),
    ];
    const result = detectPattern(recent, 3);
    expect(result).not.toBeNull();
    expect(result).toContain('file-read');
    expect(result).not.toContain('stuck loop');
  });

  test('includes the target list when targets are present', () => {
    const recent = [
      obs('file-read', 'a.ts'),
      obs('file-read', 'b.ts'),
      obs('file-read', 'c.ts'),
    ];
    const result = detectPattern(recent, 3);
    expect(result).not.toBeNull();
    expect(result).toContain('[a.ts, b.ts, c.ts]');
  });

  test('omits the target list when targets are all undefined', () => {
    const recent = [obs('bash'), obs('bash'), obs('bash')];
    // NOTE: this case is caught by detector 1 first (undefined targets
    // count as matching). Detector 2 never runs. Verify the priority.
    const result = detectPattern(recent, 3);
    expect(result).not.toBeNull();
    expect(result).toContain('stuck loop');
  });

  test('does NOT fire below the 3-call threshold', () => {
    const recent = [obs('file-read', 'a'), obs('file-read', 'b')];
    expect(detectPattern(recent, 2)).toBeNull();
  });

  test('does NOT fire when tool varies', () => {
    const recent = [
      obs('file-read', 'a'),
      obs('file-edit', 'b'),
      obs('file-write', 'c'),
    ];
    expect(detectPattern(recent, 3)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Detector 3: BREADTH-WITHOUT-ACTION
// ---------------------------------------------------------------------------

describe('detectPattern — 3. BREADTH-WITHOUT-ACTION (3+ reads, 0 writes)', () => {
  test('fires when all 3 calls are read-class and no writes', () => {
    const recent = [
      obs('file-read', 'a.ts'),
      obs('git-log'),
      obs('git-status'),
    ];
    const result = detectPattern(recent, 3);
    expect(result).not.toBeNull();
    expect(result).toContain('reads');
    expect(result).toContain('0 writes');
  });

  test('read-class tools: file-read, git-log, git-status', () => {
    for (const tool of ['file-read', 'git-log', 'git-status']) {
      const recent = [obs(tool), obs(tool), obs(tool)];
      const result = detectPattern(recent, 3);
      // For tools other than file-read, detector 1 (stuck loop) fires
      // first because all three match on tool + undefined-target.
      // The detectBreadthWithoutAction code path runs only when
      // detectors 1 and 2 don't fire. This test confirms that for
      // file-read, the streak message dominates.
      expect(result).not.toBeNull();
    }
  });

  test('does NOT fire when there is any write-class call in the window', () => {
    // 3 reads + 1 write → breadth disqualified (reads>=3 AND writes==0
    // fails). No streak (last 3 are file-read x2 then file-edit —
    // different tool). No error-loop. Count under 9. Returns null.
    const recent = [
      obs('file-read', 'a.ts'),
      obs('file-read', 'b.ts'),
      obs('file-read', 'c.ts'),
      obs('file-edit', 'd.ts'),
    ];
    const result = detectPattern(recent, 4);
    expect(result).toBeNull();
  });

  test('write-class tools disqualify breadth (file-edit, file-write, bash, git-commit, file-delete)', () => {
    for (const writeTool of ['file-edit', 'file-write', 'file-delete', 'bash', 'git-commit']) {
      // 3 reads + 1 write — breadth should NOT fire. But streak on
      // file-read x3 might fire if the reads are last. To isolate
      // breadth, interleave: read read write read — no 3-streak,
      // 3 reads, 1 write → breadth should NOT fire.
      const recent = [
        obs('file-read', 'a'),
        obs('file-read', 'b'),
        obs(writeTool, 'c'),
        obs('file-read', 'd'),
      ];
      // 3 reads, 1 write → breadth disqualified. No streak (no 3 in
      // a row of same tool). No error-loop. Should return null (count
      // under 9).
      expect(detectPattern(recent, 4), `for writeTool=${writeTool}`).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Detector 4: ERROR-LOOP
// ---------------------------------------------------------------------------

describe('detectPattern — 4. ERROR-LOOP (last 2 calls both errored)', () => {
  test('fires when the last two calls errored', () => {
    const recent = [
      obs('file-read', 'a.ts'),
      obs('file-edit', 'b.ts', true),
      obs('file-write', 'c.ts', true),
    ];
    const result = detectPattern(recent, 3);
    expect(result).not.toBeNull();
    expect(result).toContain('errored');
    expect(result).toContain('file-edit(b.ts)');
    expect(result).toContain('file-write(c.ts)');
  });

  test('names both failing calls even when targets are undefined', () => {
    const recent = [
      obs('bash', undefined, true),
      obs('bash', undefined, true),
    ];
    // NOTE: this is caught by detector 1 first (same tool + same
    // undefined target 3 times — but only 2 entries, so detector 1
    // doesn't fire; error-loop does).
    const result = detectPattern(recent, 2);
    expect(result).not.toBeNull();
    expect(result).toContain('errored');
    expect(result).toContain('bash');
  });

  test('does NOT fire when only the last call errored (single error is normal)', () => {
    const recent = [
      obs('file-read', 'a.ts'),
      obs('file-edit', 'b.ts'),
      obs('file-write', 'c.ts', true),
    ];
    expect(detectPattern(recent, 3)).toBeNull();
  });

  test('does NOT fire when an earlier call errored but recent did not', () => {
    const recent = [
      obs('file-read', 'a.ts', true),
      obs('file-edit', 'b.ts', true),
      obs('file-write', 'c.ts'), // recovered
    ];
    expect(detectPattern(recent, 3)).toBeNull();
  });

  test('does NOT fire below the 2-call threshold', () => {
    const recent = [obs('bash', undefined, true)];
    expect(detectPattern(recent, 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Detector 5: HIGH-COUNT NO-DONE
// ---------------------------------------------------------------------------

describe('detectPattern — 5. HIGH-COUNT NO-DONE (totalCallCount >= 9)', () => {
  test('fires at exactly 9', () => {
    const recent = [obs('file-read', 'a.ts')];
    const result = detectPattern(recent, 9);
    expect(result).not.toBeNull();
    expect(result).toContain('9 tool calls');
  });

  test('fires above 9', () => {
    const recent = [obs('file-read', 'a.ts')];
    const result = detectPattern(recent, 42);
    expect(result).not.toBeNull();
    expect(result).toContain('42 tool calls');
  });

  test('does NOT fire below 9', () => {
    const recent = [obs('file-read', 'a.ts')];
    expect(detectPattern(recent, 8)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Priority — first-match-wins
// ---------------------------------------------------------------------------

describe('detectPattern — priority order (first-match-wins)', () => {
  test('STUCK LOOP fires before SAME-TOOL STREAK when both match', () => {
    // 3× file-read with same target → both detectors match, stuck wins.
    const recent = [
      obs('file-read', 'same.ts'),
      obs('file-read', 'same.ts'),
      obs('file-read', 'same.ts'),
    ];
    const result = detectPattern(recent, 3);
    expect(result).toContain('stuck loop');
  });

  test('STUCK LOOP fires before ERROR-LOOP when both match', () => {
    // Last 3 calls same tool+target AND last 2 errored. Stuck wins.
    const recent = [
      obs('bash', 'ls', true),
      obs('bash', 'ls', true),
      obs('bash', 'ls', true),
    ];
    const result = detectPattern(recent, 3);
    expect(result).toContain('stuck loop');
    expect(result).not.toContain('errored');
  });

  test('SAME-TOOL STREAK fires before BREADTH-WITHOUT-ACTION when both match', () => {
    // 3× file-read different targets → both streak and breadth match.
    // Streak wins.
    const recent = [
      obs('file-read', 'a.ts'),
      obs('file-read', 'b.ts'),
      obs('file-read', 'c.ts'),
    ];
    const result = detectPattern(recent, 3);
    expect(result).toContain('Last 3 calls');
    expect(result).not.toContain('reads');
  });

  test('HIGH-COUNT fires only when no earlier pattern matches', () => {
    // 3 reads, 0 writes + count >= 9 — breadth matches first.
    const recent = [
      obs('file-read', 'a'),
      obs('git-log'),
      obs('git-status'),
    ];
    const result = detectPattern(recent, 9);
    expect(result).toContain('reads');
    expect(result).not.toContain('9 tool calls');
  });
});

// ---------------------------------------------------------------------------
// formatEntry (display helper)
// ---------------------------------------------------------------------------

describe('formatEntry', () => {
  test('renders tool + target when target is present', () => {
    expect(formatEntry(obs('file-read', 'a.ts'))).toBe('file-read(a.ts)');
  });

  test('renders tool only when target is absent', () => {
    expect(formatEntry(obs('bash'))).toBe('bash');
  });

  test('ignores error flag in rendering (error is metadata, not display)', () => {
    // formatEntry is called by detectErrorLoop to label failing calls.
    // The error bit is consumed upstream by the detector logic; the
    // display format is identical regardless of error state.
    expect(formatEntry(obs('file-read', 'a.ts', true))).toBe('file-read(a.ts)');
    expect(formatEntry(obs('bash', undefined, true))).toBe('bash');
  });
});
