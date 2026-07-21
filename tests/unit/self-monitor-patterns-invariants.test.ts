/**
 * Invariants for src/cerebellum/self-monitor-patterns.ts.
 *
 * self-monitor-patterns.test.ts covers behavior: each of the 5 patterns
 * (STUCK LOOP, SAME-TOOL STREAK, BREADTH-WITHOUT-ACTION, ERROR-LOOP,
 * HIGH-COUNT NO-DONE) has its trigger condition tested, plus the
 * priority order (first-match-wins) and formatEntry rendering. This
 * file pins the load-bearing structural contracts that the behavioral
 * tests imply but do not make explicit:
 *
 *   - detectPattern is a pure function: same inputs produce byte-
 *     identical outputs across calls; the input array is never
 *     mutated.
 *   - detectPattern returns string | null (strictly).
 *   - detectPattern never mutates the totalCallCount (it is read-only).
 *   - formatEntry is a pure function.
 *   - formatEntry returns a non-empty string for every valid input.
 *   - READ_TOOLS contains exactly { file-read, git-log, git-status }
 *     (3 members, no duplicates, no write-class overlap).
 *   - WRITE_TOOLS contains exactly { file-write, file-edit, file-
 *     delete, bash, git-commit } (5 members, no duplicates, no read-
 *     class overlap).
 *   - READ_TOOLS and WRITE_TOOLS are disjoint (a tool cannot be both
 *     a read and a write).
 *   - detectPattern early-returns null on empty window (documented
 *     boundary).
 *   - Threshold values are pinned: STUCK LOOP=3 calls, SAME-TOOL
 *     STREAK=3 calls, BREADTH-WITHOUT-ACTION=3 reads + 0 writes,
 *     ERROR-LOOP=2 calls, HIGH-COUNT=9 total.
 *   - HIGH-COUNT fires only when no earlier pattern matches (priority
 *     invariant: HIGH-COUNT is the last resort).
 *   - self-monitor-patterns.ts exports exactly { detectPattern,
 *     formatEntry } and nothing else (private helpers stay private).
 *
 * The READ_TOOLS / WRITE_TOOLS disjointness invariant is load-bearing:
 * if 'bash' were ever moved to READ_TOOLS, the BREADTH-WITHOUT-ACTION
 * detector would silently stop firing (because writeCount would be 0
 * for shell-only sequences).
 *
 * The threshold invariants are load-bearing: ERROR-LOOP fires at 2
 * (not 3) on purpose — waiting for a third error wastes a tool call
 * against a broken approach. HIGH-COUNT fires at 9 — below the
 * orchestrator's hard ceiling (16) to leave room for the agent to
 * converge after the nudge.
 */

import { describe, test, expect } from 'vitest';
import { detectPattern, formatEntry } from '../../src/cerebellum/self-monitor-patterns.js';
import type { ToolCallObservation } from '../../src/cerebellum/self-monitor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function obs(
  tool: string,
  target?: string,
  error?: boolean,
): ToolCallObservation {
  // Build with conditional spread so undefined keys are absent.
  return {
    tool,
    ...(target !== undefined ? { target } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

// ---------------------------------------------------------------------------
// detectPattern — type contract
// ---------------------------------------------------------------------------

describe('detectPattern — type contract', () => {
  test('returns null for empty window', () => {
    expect(detectPattern([], 0)).toBeNull();
    expect(detectPattern([], 5)).toBeNull();
    expect(detectPattern([], 100)).toBeNull();
  });

  test('returns null when no pattern matches and count is below 9', () => {
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a.ts'),
      obs('file-edit', 'b.ts'),
    ];
    expect(detectPattern(recent, 2)).toBeNull();
  });

  test('returns a string when a pattern matches', () => {
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a.ts'),
      obs('file-read', 'a.ts'),
      obs('file-read', 'a.ts'),
    ];
    const result = detectPattern(recent, 3);
    expect(typeof result).toBe('string');
    expect(result).not.toBe('');
  });

  test('return type is strictly string | null (never undefined)', () => {
    // Try many inputs — result must always be string or null.
    const inputs: Array<{ recent: ToolCallObservation[]; count: number }> = [
      { recent: [], count: 0 },
      { recent: [obs('file-read', 'a')], count: 1 },
      { recent: [obs('file-read', 'a'), obs('file-read', 'a'), obs('file-read', 'a')], count: 3 },
      { recent: [obs('file-edit', 'a'), obs('file-edit', 'a')], count: 2 },
      { recent: [obs('file-read')], count: 100 },
    ];
    for (const { recent, count } of inputs) {
      const r = detectPattern(recent, count);
      expect(r === null || typeof r === 'string').toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// detectPattern — purity
// ---------------------------------------------------------------------------

describe('detectPattern — purity', () => {
  test('same inputs produce identical outputs across multiple calls', () => {
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a.ts'),
      obs('file-read', 'a.ts'),
      obs('file-read', 'a.ts'),
    ];
    const r1 = detectPattern(recent, 3);
    const r2 = detectPattern(recent, 3);
    const r3 = detectPattern(recent, 3);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  test('does NOT mutate the recent array', () => {
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a.ts'),
      obs('file-read', 'a.ts'),
      obs('file-read', 'a.ts'),
    ];
    const snapshot = [...recent];
    detectPattern(recent, 3);
    expect(recent).toEqual(snapshot);
    expect(recent.length).toBe(snapshot.length);
  });

  test('does NOT mutate entries inside the recent array', () => {
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a.ts'),
      obs('file-read', 'a.ts'),
      obs('file-read', 'a.ts'),
    ];
    const snapshot = recent.map((e) => ({ ...e }));
    detectPattern(recent, 3);
    for (let i = 0; i < recent.length; i++) {
      expect(recent[i]).toEqual(snapshot[i]);
    }
  });

  test('deterministic regardless of call order with different inputs', () => {
    const a: ToolCallObservation[] = [
      obs('file-read', 'a'),
      obs('file-read', 'a'),
      obs('file-read', 'a'),
    ];
    const b: ToolCallObservation[] = [obs('file-edit', 'b')];
    const ra1 = detectPattern(a, 3);
    const rb1 = detectPattern(b, 1);
    const ra2 = detectPattern(a, 3);
    const rb2 = detectPattern(b, 1);
    expect(ra1).toEqual(ra2);
    expect(rb1).toEqual(rb2);
  });
});

// ---------------------------------------------------------------------------
// detectPattern — threshold boundaries (pinned)
// ---------------------------------------------------------------------------

describe('detectPattern — threshold boundaries (pinned)', () => {
  test('STUCK LOOP fires at exactly 3 same-tool-same-target calls (boundary)', () => {
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a.ts'),
      obs('file-read', 'a.ts'),
      obs('file-read', 'a.ts'),
    ];
    expect(detectPattern(recent, 3)).not.toBeNull();
  });

  test('STUCK LOOP does NOT fire below 3 calls', () => {
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a.ts'),
      obs('file-read', 'a.ts'),
    ];
    expect(detectPattern(recent, 2)).toBeNull();
  });

  test('ERROR-LOOP fires at exactly 2 errored calls (boundary)', () => {
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a.ts', true),
      obs('file-read', 'a.ts', true),
    ];
    expect(detectPattern(recent, 2)).not.toBeNull();
  });

  test('ERROR-LOOP does NOT fire below 2 calls', () => {
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a.ts', true),
    ];
    expect(detectPattern(recent, 1)).toBeNull();
  });

  test('HIGH-COUNT fires at exactly totalCallCount=9 (boundary)', () => {
    // Need a recent that doesn't trigger any other pattern.
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a.ts'),
      obs('file-edit', 'b.ts'),
    ];
    expect(detectPattern(recent, 9)).not.toBeNull();
  });

  test('HIGH-COUNT does NOT fire below 9', () => {
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a.ts'),
      obs('file-edit', 'b.ts'),
    ];
    expect(detectPattern(recent, 8)).toBeNull();
  });

  test('HIGH-COUNT fires above 9', () => {
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a.ts'),
      obs('file-edit', 'b.ts'),
    ];
    expect(detectPattern(recent, 15)).not.toBeNull();
  });

  test('BREADTH-WITHOUT-ACTION fires at exactly 3 reads + 0 writes (boundary)', () => {
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a.ts'),
      obs('git-log'),
      obs('git-status'),
    ];
    expect(detectPattern(recent, 3)).not.toBeNull();
  });

  test('BREADTH-WITHOUT-ACTION does NOT fire below 3 reads', () => {
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a.ts'),
      obs('git-log'),
    ];
    expect(detectPattern(recent, 2)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectPattern — priority order (first-match-wins)
// ---------------------------------------------------------------------------

describe('detectPattern — priority order (first-match-wins)', () => {
  test('STUCK LOOP takes priority over ERROR-LOOP', () => {
    // 3 errored same-tool-same-target calls: both STUCK LOOP and
    // ERROR-LOOP could fire. STUCK LOOP wins.
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a.ts', true),
      obs('file-read', 'a.ts', true),
      obs('file-read', 'a.ts', true),
    ];
    const result = detectPattern(recent, 3);
    expect(result).toContain('stuck loop');
  });

  test('STUCK LOOP takes priority over HIGH-COUNT', () => {
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a.ts'),
      obs('file-read', 'a.ts'),
      obs('file-read', 'a.ts'),
    ];
    const result = detectPattern(recent, 100);
    expect(result).toContain('stuck loop');
    expect(result).not.toContain('tool calls without reaching DONE');
  });

  test('SAME-TOOL STREAK takes priority over BREADTH-WITHOUT-ACTION', () => {
    // 3 file-reads (same tool, different targets) — both patterns
    // could fire. SAME-TOOL STREAK wins (comes earlier).
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a.ts'),
      obs('file-read', 'b.ts'),
      obs('file-read', 'c.ts'),
    ];
    const result = detectPattern(recent, 3);
    expect(result).toContain('Last 3 calls were all file-read');
    expect(result).not.toContain("haven't acted yet");
  });

  test('HIGH-COUNT is the lowest-priority pattern (last resort)', () => {
    // Only HIGH-COUNT fires when no other pattern matches.
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a.ts'),
      obs('file-edit', 'b.ts'),
    ];
    const result = detectPattern(recent, 9);
    expect(result).toContain('tool calls without reaching DONE');
  });
});

// ---------------------------------------------------------------------------
// detectPattern — message content invariants
// ---------------------------------------------------------------------------

describe('detectPattern — message content invariants', () => {
  test('STUCK LOOP message names the tool and target', () => {
    const recent: ToolCallObservation[] = [
      obs('file-read', 'src/foo.ts'),
      obs('file-read', 'src/foo.ts'),
      obs('file-read', 'src/foo.ts'),
    ];
    const result = detectPattern(recent, 3);
    expect(result).toContain('file-read');
    expect(result).toContain('src/foo.ts');
    expect(result).toContain('3 times');
  });

  test('ERROR-LOOP message names both failing calls via formatEntry', () => {
    const recent: ToolCallObservation[] = [
      obs('bash', 'build', true),
      obs('file-edit', 'src/x.ts', true),
    ];
    const result = detectPattern(recent, 2);
    expect(result).toContain('bash(build)');
    expect(result).toContain('file-edit(src/x.ts)');
  });

  test('HIGH-COUNT message contains the exact count', () => {
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a.ts'),
      obs('file-edit', 'b.ts'),
    ];
    for (const count of [9, 10, 12, 15, 20]) {
      const result = detectPattern(recent, count);
      expect(result).toContain(String(count));
    }
  });

  test('every non-null result is non-empty', () => {
    const inputs: Array<ToolCallObservation[]> = [
      [
        obs('file-read', 'a'),
        obs('file-read', 'a'),
        obs('file-read', 'a'),
      ],
      [obs('bash', 'x', true), obs('bash', 'y', true)],
      [obs('file-read'), obs('file-edit')],
    ];
    for (const recent of inputs) {
      const r = detectPattern(recent, 9);
      if (r !== null) {
        expect(r.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// formatEntry — type contract and purity
// ---------------------------------------------------------------------------

describe('formatEntry — type contract', () => {
  test('returns a string', () => {
    expect(typeof formatEntry(obs('file-read', 'a'))).toBe('string');
    expect(typeof formatEntry(obs('file-read'))).toBe('string');
    expect(typeof formatEntry(obs('bash', 'cmd', true))).toBe('string');
  });

  test('returns a non-empty string for every input', () => {
    const entries: ToolCallObservation[] = [
      obs('file-read'),
      obs('file-read', 'a.ts'),
      obs('bash', 'cmd'),
      obs('git-commit'),
      obs('file-edit', 'x', true),
    ];
    for (const e of entries) {
      expect(formatEntry(e).length).toBeGreaterThan(0);
    }
  });
});

describe('formatEntry — rendering rules', () => {
  test('renders "tool(target)" when target is present', () => {
    expect(formatEntry(obs('file-read', 'a.ts'))).toBe('file-read(a.ts)');
  });

  test('renders "tool" when target is absent', () => {
    expect(formatEntry(obs('file-read'))).toBe('file-read');
  });

  test('does NOT render the error flag (metadata, not display)', () => {
    expect(formatEntry(obs('bash', 'cmd', true))).toBe('bash(cmd)');
    expect(formatEntry(obs('bash', undefined, true))).toBe('bash');
  });

  test('uses parentheses (not brackets or arrows) for target', () => {
    const r = formatEntry(obs('file-read', 'a.ts'));
    expect(r).toContain('(');
    expect(r).toContain(')');
    expect(r).not.toContain('[');
    expect(r).not.toContain('<');
  });
});

describe('formatEntry — purity', () => {
  test('same input produces identical output across calls', () => {
    const e = obs('file-read', 'a.ts');
    const a = formatEntry(e);
    const b = formatEntry(e);
    const c = formatEntry(e);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  test('does NOT mutate the input entry', () => {
    const e = obs('file-read', 'a.ts');
    const snapshot = { ...e };
    formatEntry(e);
    expect(e).toEqual(snapshot);
  });

  test('deterministic regardless of call order', () => {
    const a = obs('file-read', 'a');
    const b = obs('bash', 'cmd', true);
    const ra1 = formatEntry(a);
    const rb1 = formatEntry(b);
    const ra2 = formatEntry(a);
    const rb2 = formatEntry(b);
    expect(ra1).toBe(ra2);
    expect(rb1).toBe(rb2);
  });
});

// ---------------------------------------------------------------------------
// READ_TOOLS / WRITE_TOOLS — set membership (pinned via source inspection)
// ---------------------------------------------------------------------------

describe('READ_TOOLS and WRITE_TOOLS — set membership invariants', () => {
  // These sets are private (not exported). We verify by reading the
  // source file, which pins the membership against accidental drift
  // (e.g. someone moving 'bash' to READ_TOOLS would silently break
  // BREADTH-WITHOUT-ACTION detection).

  test('READ_TOOLS contains exactly { file-read, git-log, git-status }', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/self-monitor-patterns.ts', 'utf8');
    // Extract the line that defines READ_TOOLS.
    const match = src.match(/const\s+READ_TOOLS\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/);
    expect(match).not.toBeNull();
    const members = match![1]!
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter((s) => s.length > 0);
    expect(members.sort()).toEqual(['file-read', 'git-log', 'git-status']);
  });

  test('WRITE_TOOLS contains exactly { file-write, file-edit, file-delete, bash, git-commit }', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/self-monitor-patterns.ts', 'utf8');
    const match = src.match(/const\s+WRITE_TOOLS\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/);
    expect(match).not.toBeNull();
    const members = match![1]!
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter((s) => s.length > 0);
    expect(members.sort()).toEqual(
      ['bash', 'file-delete', 'file-edit', 'file-write', 'git-commit'].sort(),
    );
  });

  test('READ_TOOLS has exactly 3 members (no more, no less)', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/self-monitor-patterns.ts', 'utf8');
    const match = src.match(/const\s+READ_TOOLS\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/);
    const members = match![1]!
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter((s) => s.length > 0);
    expect(members).toHaveLength(3);
  });

  test('WRITE_TOOLS has exactly 5 members (no more, no less)', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/self-monitor-patterns.ts', 'utf8');
    const match = src.match(/const\s+WRITE_TOOLS\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/);
    const members = match![1]!
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter((s) => s.length > 0);
    expect(members).toHaveLength(5);
  });

  test('READ_TOOLS and WRITE_TOOLS are DISJOINT (no overlap)', async () => {
    // This is load-bearing: if 'bash' were ever moved to READ_TOOLS,
    // BREADTH-WITHOUT-ACTION would silently break.
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/self-monitor-patterns.ts', 'utf8');
    const readMatch = src.match(/const\s+READ_TOOLS\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/);
    const writeMatch = src.match(/const\s+WRITE_TOOLS\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/);
    const reads = new Set(
      readMatch![1]!
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''))
        .filter((s) => s.length > 0),
    );
    const writes = new Set(
      writeMatch![1]!
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''))
        .filter((s) => s.length > 0),
    );
    for (const r of reads) {
      expect(writes.has(r)).toBe(false);
    }
    for (const w of writes) {
      expect(reads.has(w)).toBe(false);
    }
  });

  test('all READ_TOOLS entries are lowercase strings', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/self-monitor-patterns.ts', 'utf8');
    const match = src.match(/const\s+READ_TOOLS\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/);
    const members = match![1]!
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter((s) => s.length > 0);
    for (const m of members) {
      expect(m).toBe(m.toLowerCase());
    }
  });

  test('all WRITE_TOOLS entries are lowercase strings', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/self-monitor-patterns.ts', 'utf8');
    const match = src.match(/const\s+WRITE_TOOLS\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/);
    const members = match![1]!
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter((s) => s.length > 0);
    for (const m of members) {
      expect(m).toBe(m.toLowerCase());
    }
  });
});

// ---------------------------------------------------------------------------
// BREADTH-WITHOUT-ACTION — classifier boundaries (observable via detectPattern)
// ---------------------------------------------------------------------------

describe('BREADTH-WITHOUT-ACTION — classifier membership', () => {
  test('file-read counts as a read', () => {
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a'),
      obs('file-read', 'b'),
      obs('file-read', 'c'),
    ];
    const result = detectPattern(recent, 3);
    expect(result).not.toBeNull();
    // SAME-TOOL STREAK would also fire here (3 file-reads); check that
    // the message is one of the two.
    expect(
      result!.includes('Last 3 calls were all') ||
        result!.includes("haven't acted yet"),
    ).toBe(true);
  });

  test('git-log counts as a read (not a write)', () => {
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a'),
      obs('git-log'),
      obs('git-status'),
    ];
    const result = detectPattern(recent, 3);
    expect(result).toContain("haven't acted yet");
  });

  test('file-edit counts as a write (breaks breadth)', () => {
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a'),
      obs('git-log'),
      obs('file-edit', 'b.ts'),
    ];
    // Even though there are 2 reads, the presence of 1 write means
    // BREADTH-WITHOUT-ACTION (which requires writeCount === 0) does
    // NOT fire.
    expect(detectPattern(recent, 3)).toBeNull();
  });

  test('bash counts as a write (breaks breadth)', () => {
    const recent: ToolCallObservation[] = [
      obs('file-read', 'a'),
      obs('file-read', 'b'),
      obs('bash', 'cmd'),
    ];
    // bash is a write-class tool — writeCount=1, so BREADTH-WITHOUT-ACTION
    // (which requires writeCount === 0) does NOT fire. Tools differ, so
    // STUCK LOOP and STREAK don't fire. totalCallCount=3 < 9. Result: null.
    expect(detectPattern(recent, 3)).toBeNull();
  });

  test('unclassified tool (e.g. custom-tool) is neither read nor write', () => {
    const recent: ToolCallObservation[] = [
      obs('custom-tool', 'a'),
      obs('custom-tool', 'b'),
      obs('custom-tool', 'c'),
    ];
    // SAME-TOOL STREAK fires (3 same tool). custom-tool is not in
    // either set so breadth would technically fire — but STREAK
    // wins by priority.
    const result = detectPattern(recent, 3);
    expect(result).toContain('Last 3 calls were all custom-tool');
  });
});

// ---------------------------------------------------------------------------
// Module exports — exactly { detectPattern, formatEntry }
// ---------------------------------------------------------------------------

describe('module exports — exactly { detectPattern, formatEntry }', () => {
  test('detectPattern and formatEntry are both functions', () => {
    expect(typeof detectPattern).toBe('function');
    expect(typeof formatEntry).toBe('function');
  });

  test('module does NOT export private helpers (detectStuckLoop, etc.)', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/self-monitor-patterns.ts', 'utf8');
    // The private helpers must NOT be marked `export`.
    expect(src).not.toMatch(/export\s+function\s+detectStuckLoop/);
    expect(src).not.toMatch(/export\s+function\s+detectSameToolStreak/);
    expect(src).not.toMatch(/export\s+function\s+detectBreadthWithoutAction/);
    expect(src).not.toMatch(/export\s+function\s+detectErrorLoop/);
    expect(src).not.toMatch(/export\s+const\s+READ_TOOLS/);
    expect(src).not.toMatch(/export\s+const\s+WRITE_TOOLS/);
  });

  test('exactly two exported symbols are declared with `export function`', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/self-monitor-patterns.ts', 'utf8');
    const exportMatches = src.match(/export\s+function\s+(\w+)/g) ?? [];
    const names = exportMatches.map((m) => m.replace(/export\s+function\s+/, ''));
    expect(names.sort()).toEqual(['detectPattern', 'formatEntry']);
  });
});
