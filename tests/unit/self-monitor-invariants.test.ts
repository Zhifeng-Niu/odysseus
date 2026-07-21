/**
 * Invariants for src/cerebellum/self-monitor.ts.
 *
 * The existing self-monitor.test.ts covers behavior-driven cases (what
 * the nudge says in scenario X). This file pins the load-bearing
 * structural contracts that must not silently drift:
 *
 *   - SELF_MONITOR_WINDOW exact value (one-screen-line budget)
 *   - ToolCallObservation type shape (1 required + 2 optional, all readonly)
 *   - exactOptionalPropertyTypes enforcement (no `{ target: undefined }`)
 *   - summarizeToolCall arg-shape priority (path > file_path > command > message)
 *   - truncate off-by-one (total length === max when truncated, U+2026 ellipsis)
 *   - truncatePath last-2-segments behavior including leading/trailing slash edge cases
 *   - makeObs 4-branch output shapes
 *   - buildSelfMonitorObservation exact template (hardcoded plural "tool calls")
 *   - empty/healthy fallbacks with exact strings
 *   - newline separator between sequence and observation
 *   - purity: input arrays/objects never mutated
 *   - re-export of detectPattern (Iteration 48 extraction contract)
 *
 * Style: pin actual source behavior. If a test disagrees with the
 * source, the source is the truth — update the test, never the other
 * way around.
 */

import { describe, test, expect } from 'vitest';
import {
  summarizeToolCall,
  buildSelfMonitorObservation,
  SELF_MONITOR_WINDOW,
  detectPattern,
  type ToolCallObservation,
} from '../../src/cerebellum/self-monitor.js';

describe('self-monitor invariants', () => {
  describe('SELF_MONITOR_WINDOW', () => {
    test('is exactly 6 (one-screen-line budget)', () => {
      expect(SELF_MONITOR_WINDOW).toBe(6);
    });

    test('is a number primitive, not boxed', () => {
      expect(typeof SELF_MONITOR_WINDOW).toBe('number');
      expect(Number.isInteger(SELF_MONITOR_WINDOW)).toBe(true);
    });

    test('is greater than the stuck-loop threshold (3) so the loop can fire', () => {
      // detectStuckLoop needs 3 same-call entries in the window; if the
      // window shrank below 3, the detector would become dead code.
      expect(SELF_MONITOR_WINDOW).toBeGreaterThanOrEqual(3);
    });

    test('is greater than the error-loop threshold (2) so that detector can fire', () => {
      expect(SELF_MONITOR_WINDOW).toBeGreaterThanOrEqual(2);
    });
  });

  describe('ToolCallObservation type shape', () => {
    test('all fields are readonly at the type level', () => {
      // This is a type-level check enforced by `readonly` in the interface.
      // We verify the runtime values comply with the narrowest intended shape.
      const obs: ToolCallObservation = { tool: 'file-read', target: 'a.ts' };
      expect(obs.tool).toBe('file-read');
      expect(obs.target).toBe('a.ts');
    });

    test('tool is the only required field (target/error both optional)', () => {
      const obs: ToolCallObservation = { tool: 'x' };
      expect(obs.tool).toBe('x');
      expect(obs.target).toBeUndefined();
      expect(obs.error).toBeUndefined();
    });

    test('target can be present without error', () => {
      const obs: ToolCallObservation = { tool: 'x', target: 'y' };
      expect('target' in obs).toBe(true);
      expect('error' in obs).toBe(false);
    });

    test('error can be present without target', () => {
      const obs: ToolCallObservation = { tool: 'x', error: true };
      expect('error' in obs).toBe(true);
      expect('target' in obs).toBe(false);
    });

    test('error, when present, is always strictly true (never false)', () => {
      // summarizeToolCall + makeObs never produce `{ error: false }`.
      // Verify by exercising all isError input variations.
      const withPathTrue = summarizeToolCall('t', { path: 'a' }, true);
      const withPathFalse = summarizeToolCall('t', { path: 'a' }, false);
      const withPathUndef = summarizeToolCall('t', { path: 'a' }, undefined);
      const noPathTrue = summarizeToolCall('t', {}, true);

      expect(withPathTrue.error).toBe(true);
      expect(withPathFalse.error).toBeUndefined();
      expect(withPathUndef.error).toBeUndefined();
      expect(noPathTrue.error).toBe(true);
    });
  });

  describe('exactOptionalPropertyTypes: key presence', () => {
    // With exactOptionalPropertyTypes, `{ target: undefined }` is NOT
    // assignable. The source must omit the key entirely. Verify via
    // `'key' in obj` — value-undefined would still pass `in`.

    test('summarizeToolCall never produces { target: undefined }', () => {
      // Unknown arg shape → target omitted entirely (not undefined-valued).
      const obs = summarizeToolCall('x', {});
      expect('target' in obs).toBe(false);
    });

    test('summarizeToolCall never produces { error: undefined }', () => {
      // isError=false or omitted → error key absent entirely.
      const obs1 = summarizeToolCall('x', { path: 'a' }, false);
      const obs2 = summarizeToolCall('x', { path: 'a' });
      expect('error' in obs1).toBe(false);
      expect('error' in obs2).toBe(false);
    });

    test('null args produce neither target nor error key', () => {
      const obs = summarizeToolCall('x', null);
      expect('target' in obs).toBe(false);
      expect('error' in obs).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(obs, 'target')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(obs, 'error')).toBe(false);
    });

    test('output object has exactly the keys assigned by makeObs', () => {
      // Enumerate own keys to verify no spurious fields.
      const onlyTool = summarizeToolCall('x', {});
      const withTarget = summarizeToolCall('x', { path: 'a' });
      const withErr = summarizeToolCall('x', {}, true);
      const withBoth = summarizeToolCall('x', { path: 'a' }, true);

      expect(Object.keys(onlyTool)).toEqual(['tool']);
      expect(Object.keys(withTarget).sort()).toEqual(['target', 'tool']);
      expect(Object.keys(withErr).sort()).toEqual(['error', 'tool']);
      expect(Object.keys(withBoth).sort()).toEqual(['error', 'target', 'tool']);
    });
  });

  describe('summarizeToolCall arg-shape priority', () => {
    // Priority is load-bearing: path > file_path > command > message.
    // If two shapes are present, the higher-priority one wins.

    test('path takes priority over file_path', () => {
      const obs = summarizeToolCall('t', { path: 'p/a.ts', file_path: 'fp/a.ts' });
      expect(obs.target).toBe('p/a.ts');
    });

    test('file_path is used only when path is absent', () => {
      const obs = summarizeToolCall('t', { file_path: 'fp/a.ts' });
      expect(obs.target).toBe('fp/a.ts');
    });

    test('whitespace path does NOT fall through to file_path (load-bearing quirk)', () => {
      // file_path is consulted only during the initial path lookup. Once
      // args.path is a string (even whitespace), file_path is never re-examined.
      // The whitespace path fails the trim().length>0 check, so the function
      // returns tool-only rather than backing up to file_path.
      const obs = summarizeToolCall('t', { path: '   ', file_path: 'fp/a.ts' });
      expect(obs.target).toBeUndefined();
    });

    test('empty-string path does NOT fall through to file_path either', () => {
      const obs = summarizeToolCall('t', { path: '', file_path: 'fp/a.ts' });
      expect(obs.target).toBeUndefined();
    });

    test('path (non-string) falls through to file_path', () => {
      const obs = summarizeToolCall('t', { path: 42, file_path: 'fp/a.ts' });
      expect(obs.target).toBe('fp/a.ts');
    });

    test('path/file_path both take priority over command', () => {
      const obs1 = summarizeToolCall('t', { path: 'p/a.ts', command: 'ls' });
      const obs2 = summarizeToolCall('t', { file_path: 'fp/a.ts', command: 'ls' });
      expect(obs1.target).toBe('p/a.ts');
      expect(obs2.target).toBe('fp/a.ts');
    });

    test('command is used when neither path nor file_path present', () => {
      const obs = summarizeToolCall('t', { command: 'npm test' });
      expect(obs.target).toBe('npm test');
    });

    test('command takes priority over message', () => {
      const obs = summarizeToolCall('t', { command: 'npm test', message: 'commit msg' });
      expect(obs.target).toBe('npm test');
    });

    test('message is used only when no higher-priority shape exists', () => {
      const obs = summarizeToolCall('t', { message: 'commit msg' });
      expect(obs.target).toBe('commit msg');
    });

    test('empty command falls through to message', () => {
      const obs = summarizeToolCall('t', { command: '', message: 'fallback msg' });
      expect(obs.target).toBe('fallback msg');
    });

    test('whitespace-only message falls through to unknown shape', () => {
      const obs = summarizeToolCall('t', { message: '   ' });
      expect(obs.target).toBeUndefined();
    });
  });

  describe('summarizeToolCall — adversarial args', () => {
    test('null args → tool-only observation', () => {
      const obs = summarizeToolCall('bash', null);
      expect(obs.tool).toBe('bash');
      expect(obs.target).toBeUndefined();
    });

    test('undefined args → tool-only observation', () => {
      const obs = summarizeToolCall('bash', undefined);
      expect(obs.tool).toBe('bash');
      expect(obs.target).toBeUndefined();
    });

    test('array args → tool-only (arrays are not objects here)', () => {
      // isObject explicitly rejects arrays.
      const obs = summarizeToolCall('bash', [1, 2, 3]);
      expect(obs.target).toBeUndefined();
    });

    test('string args → tool-only', () => {
      const obs = summarizeToolCall('bash', 'not-an-object');
      expect(obs.target).toBeUndefined();
    });

    test('number args → tool-only', () => {
      const obs = summarizeToolCall('bash', 42);
      expect(obs.target).toBeUndefined();
    });

    test('boolean args → tool-only', () => {
      const obs = summarizeToolCall('bash', true);
      expect(obs.target).toBeUndefined();
    });

    test('empty object {} → tool-only', () => {
      const obs = summarizeToolCall('bash', {});
      expect(obs.target).toBeUndefined();
    });

    test('object with only unrelated keys → tool-only', () => {
      const obs = summarizeToolCall('bash', { foo: 'bar', baz: 42 });
      expect(obs.target).toBeUndefined();
    });
  });

  describe('truncate (command: max=40, message: max=30)', () => {
    test('command at exactly 40 chars is NOT truncated', () => {
      const cmd = 'c'.repeat(40);
      const obs = summarizeToolCall('bash', { command: cmd });
      expect(obs.target).toBe(cmd);
      expect(obs.target!.length).toBe(40);
      expect(obs.target).not.toContain('…');
    });

    test('command at 41 chars IS truncated to total length 40', () => {
      // Off-by-one: slice(0, 39) + '…' → total length 40, not 41.
      const cmd = 'c'.repeat(41);
      const obs = summarizeToolCall('bash', { command: cmd });
      expect(obs.target!.length).toBe(40);
      expect(obs.target).toContain('…');
      expect(obs.target!.endsWith('…')).toBe(true);
    });

    test('command truncation uses U+2026 ellipsis (…), not three dots (...)', () => {
      const cmd = 'c'.repeat(100);
      const obs = summarizeToolCall('bash', { command: cmd });
      // U+2026 is a single codepoint; '...' is three ASCII dots.
      expect(obs.target).toContain('…');
      expect(obs.target).not.toContain('...');
    });

    test('command is trimmed BEFORE truncation', () => {
      // Leading/trailing whitespace is removed, then length is measured.
      // 38 chars + 2 spaces padding = 40 total input; trim → 38 chars (< 40) → no truncation.
      const padded = '  ' + 'd'.repeat(38) + '  ';
      expect(padded.length).toBe(42);
      const obs = summarizeToolCall('bash', { command: padded });
      expect(obs.target).toBe('d'.repeat(38));
      expect(obs.target!.length).toBe(38);
    });

    test('message at exactly 30 chars is NOT truncated', () => {
      const msg = 'm'.repeat(30);
      const obs = summarizeToolCall('git-commit', { message: msg });
      expect(obs.target).toBe(msg);
      expect(obs.target!.length).toBe(30);
    });

    test('message at 31 chars IS truncated to total length 30', () => {
      const msg = 'm'.repeat(31);
      const obs = summarizeToolCall('git-commit', { message: msg });
      expect(obs.target!.length).toBe(30);
      expect(obs.target).toContain('…');
    });

    test('command max (40) differs from message max (30) — load-bearing', () => {
      // If someone unified the limits, the nudge density would shift.
      // Pin both thresholds independently.
      const cmd40 = summarizeToolCall('bash', { command: 'c'.repeat(40) });
      const msg30 = summarizeToolCall('x', { message: 'm'.repeat(30) });
      expect(cmd40.target!.length).toBe(40);
      expect(msg30.target!.length).toBe(30);
    });
  });

  describe('truncatePath — last 2 segments', () => {
    test('single segment returns as-is', () => {
      expect(summarizeToolCall('r', { path: 'foo.ts' }).target).toBe('foo.ts');
    });

    test('two segments returns as-is', () => {
      expect(summarizeToolCall('r', { path: 'src/foo.ts' }).target).toBe('src/foo.ts');
    });

    test('three segments returns last 2', () => {
      expect(summarizeToolCall('r', { path: 'a/b/foo.ts' }).target).toBe('b/foo.ts');
    });

    test('four segments returns last 2', () => {
      expect(summarizeToolCall('r', { path: 'a/b/c/foo.ts' }).target).toBe('c/foo.ts');
    });

    test('absolute path /a/b/c/foo.ts → last 2', () => {
      // Leading slash produces an empty first segment, filtered out.
      expect(summarizeToolCall('r', { path: '/a/b/c/foo.ts' }).target).toBe('c/foo.ts');
    });

    test('leading slash + single segment is preserved verbatim (≤2 filter rule)', () => {
      // '/foo.ts' → split → ['', 'foo.ts'] → filter → ['foo.ts']
      // length 1 ≤ 2 → return trimmed input '/foo.ts' (leading slash kept).
      expect(summarizeToolCall('r', { path: '/foo.ts' }).target).toBe('/foo.ts');
    });

    test('leading slash + two segments is preserved verbatim', () => {
      // '/src/foo.ts' → filter → ['src', 'foo.ts'] → length 2 → return trimmed.
      expect(summarizeToolCall('r', { path: '/src/foo.ts' }).target).toBe('/src/foo.ts');
    });

    test('leading slash only kicks in when > 2 filter-segments exist', () => {
      // '/a/src/foo.ts' → filter → ['a', 'src', 'foo.ts'] → length 3 → slice(-2).
      expect(summarizeToolCall('r', { path: '/a/src/foo.ts' }).target).toBe('src/foo.ts');
    });

    test('whitespace padding around path is trimmed', () => {
      expect(summarizeToolCall('r', { path: '  src/foo.ts  ' }).target).toBe('src/foo.ts');
    });

    test('trailing slash on short path is preserved in output', () => {
      // /foo/bar/ → split → ['', 'foo', 'bar', ''] → filter → ['foo', 'bar']
      // length 2, return trimmed input which still has trailing slash.
      // This is a subtle quirk: trim does not strip trailing slash.
      expect(summarizeToolCall('r', { path: '/foo/bar/' }).target).toBe('/foo/bar/');
    });

    test('double slashes are collapsed (empty segments filtered)', () => {
      expect(summarizeToolCall('r', { path: 'a//b//foo.ts' }).target).toBe('b/foo.ts');
    });

    test('root-only path "/" → empty after filter, length 0, returns "/"', () => {
      // split('/') on '/' → ['', ''] → filter → [] → length 0 ≤ 2 → return trimmed.
      expect(summarizeToolCall('r', { path: '/' }).target).toBe('/');
    });

    test('empty string path falls through to unknown shape', () => {
      // trim().length > 0 check rejects empty paths.
      expect(summarizeToolCall('r', { path: '' }).target).toBeUndefined();
    });
  });

  describe('makeObs — 4 output shapes', () => {
    // makeObs is private but its 4 branches are observable via summarizeToolCall.

    test('branch 1: target + error → {tool, target, error: true}', () => {
      const obs = summarizeToolCall('t', { path: 'a.ts' }, true);
      expect(obs).toEqual({ tool: 't', target: 'a.ts', error: true });
      expect(Object.keys(obs).sort()).toEqual(['error', 'target', 'tool']);
    });

    test('branch 2: target only → {tool, target}', () => {
      const obs = summarizeToolCall('t', { path: 'a.ts' });
      expect(obs).toEqual({ tool: 't', target: 'a.ts' });
      expect(Object.keys(obs).sort()).toEqual(['target', 'tool']);
    });

    test('branch 2 also covers target + isError=false (error omitted)', () => {
      const obs = summarizeToolCall('t', { path: 'a.ts' }, false);
      expect(obs).toEqual({ tool: 't', target: 'a.ts' });
      expect('error' in obs).toBe(false);
    });

    test('branch 3: error only → {tool, error: true}', () => {
      // No recognizable target in args, isError=true.
      const obs = summarizeToolCall('t', {}, true);
      expect(obs).toEqual({ tool: 't', error: true });
      expect(Object.keys(obs).sort()).toEqual(['error', 'tool']);
    });

    test('branch 4: neither → {tool} only', () => {
      const obs = summarizeToolCall('t', {});
      expect(obs).toEqual({ tool: 't' });
      expect(Object.keys(obs)).toEqual(['tool']);
    });

    test('isError=false with no target → still {tool} (no error key)', () => {
      const obs = summarizeToolCall('t', {}, false);
      expect(obs).toEqual({ tool: 't' });
      expect('error' in obs).toBe(false);
    });
  });

  describe('buildSelfMonitorObservation — exact template', () => {
    test('hardcodes plural "tool calls" even when N=1', () => {
      // Template is `${N} tool calls so far` — never singular.
      // Existing test name "pluralizes correctly" is misleading: the
      // template does NOT branch on N. Pin this quirk.
      const nudge = buildSelfMonitorObservation(
        [{ tool: 'x', target: 'a' }],
        1,
      );
      expect(nudge).toContain('1 tool calls so far');
      expect(nudge).not.toContain('1 tool call\n');
    });

    test('N=0 also uses plural form', () => {
      const nudge = buildSelfMonitorObservation([], 0);
      expect(nudge).toContain('0 tool calls so far');
    });

    test('always starts with literal "[self-monitor] "', () => {
      const nudge = buildSelfMonitorObservation([], 0);
      expect(nudge.startsWith('[self-monitor] ')).toBe(true);
    });

    test('line 1 ends with "Recent: <sequence>"', () => {
      const nudge = buildSelfMonitorObservation([{ tool: 'x' }], 1);
      const firstLine = nudge.split('\n')[0];
      expect(firstLine!.endsWith('Recent: x')).toBe(true);
    });

    test('exactly one newline separates line 1 from observation', () => {
      const nudge = buildSelfMonitorObservation([{ tool: 'x' }], 1);
      const lines = nudge.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/\[self-monitor\]/);
      expect(lines[1]).not.toMatch(/^\[self-monitor\]/);
    });

    test('multi-entry sequence joins with ", "', () => {
      const nudge = buildSelfMonitorObservation(
        [
          { tool: 'a', target: 'x' },
          { tool: 'b' },
          { tool: 'c', target: 'y' },
        ],
        3,
      );
      expect(nudge).toContain('Recent: a(x), b, c(y)');
    });

    test('formatEntry renders target as tool(target), bare tool otherwise', () => {
      const withTarget = buildSelfMonitorObservation([{ tool: 'r', target: 'p' }], 1);
      const withoutTarget = buildSelfMonitorObservation([{ tool: 'r' }], 1);
      expect(withTarget).toContain('r(p)');
      expect(withoutTarget).toContain('Recent: r');
      expect(withoutTarget).not.toContain('r(');
    });
  });

  describe('buildSelfMonitorObservation — fallbacks', () => {
    test('empty recent window → sequence is literal "(no recent calls)"', () => {
      const nudge = buildSelfMonitorObservation([], 0);
      expect(nudge).toContain('Recent: (no recent calls)');
    });

    test('no pattern detected → observation is the "Keep going" fallback', () => {
      // The fallback is an em-dash joined sentence, NOT just "Keep going.".
      // Exact string matters — the em-dash (U+2014) and period are load-bearing.
      const healthy = [
        { tool: 'file-read', target: 'a.ts' },
        { tool: 'file-edit', target: 'a.ts' },
      ];
      const nudge = buildSelfMonitorObservation(healthy, 2);
      expect(nudge).toContain('Keep going — no obvious loop or stall.');
    });

    test('healthy fallback uses em-dash (U+2014), not hyphen', () => {
      const nudge = buildSelfMonitorObservation(
        [{ tool: 'file-read', target: 'a' }],
        1,
      );
      // Single char em-dash, not `-` or `--`.
      expect(nudge).toContain('—');
      expect(nudge).not.toContain('--');
    });

    test('when pattern fires, the "Keep going" fallback is absent', () => {
      const stuck = [
        { tool: 'bash', target: 'npm test' },
        { tool: 'bash', target: 'npm test' },
        { tool: 'bash', target: 'npm test' },
      ];
      const nudge = buildSelfMonitorObservation(stuck, 3);
      expect(nudge).not.toContain('Keep going');
      expect(nudge).toContain('stuck loop');
    });

    test('totalCallCount is reflected verbatim in line 1', () => {
      const nudge = buildSelfMonitorObservation([], 42);
      expect(nudge.startsWith('[self-monitor] 42 tool calls so far.')).toBe(true);
    });
  });

  describe('purity — inputs are never mutated', () => {
    test('summarizeToolCall does not mutate the args object', () => {
      const args = { path: 'a/b.ts', command: 'ls' };
      const snapshot = { ...args };
      summarizeToolCall('t', args);
      expect(args).toEqual(snapshot);
    });

    test('buildSelfMonitorObservation does not mutate the recent array', () => {
      const recent: ToolCallObservation[] = [
        { tool: 'a', target: 'x' },
        { tool: 'b' },
      ];
      const snapshot = recent.map((e) => ({ ...e }));
      buildSelfMonitorObservation(recent, 2);
      expect(recent).toEqual(snapshot);
      expect(recent.length).toBe(2);
    });

    test('buildSelfMonitorObservation does not mutate individual entries', () => {
      const entry: ToolCallObservation = { tool: 'x', target: 'y' };
      const recent = [entry];
      buildSelfMonitorObservation(recent, 1);
      expect(entry).toEqual({ tool: 'x', target: 'y' });
    });

    test('detectPattern does not mutate the recent array', () => {
      const recent: ToolCallObservation[] = [
        { tool: 'bash', target: 'npm test' },
        { tool: 'bash', target: 'npm test' },
        { tool: 'bash', target: 'npm test' },
      ];
      const snapshot = recent.map((e) => ({ ...e }));
      detectPattern(recent, 3);
      expect(recent).toEqual(snapshot);
    });
  });

  describe('detectPattern re-export (Iteration 48 extraction)', () => {
    test('detectPattern is callable from self-monitor.js exports', () => {
      // The re-export pattern keeps backwards compat so importers
      // don't need to know about the Iteration 48 split.
      expect(typeof detectPattern).toBe('function');
    });

    test('detectPattern produces identical results to direct import semantics', () => {
      // Verify by exercising a stuck-loop case through the re-exported symbol.
      const stuck: ToolCallObservation[] = [
        { tool: 'bash', target: 'npm test' },
        { tool: 'bash', target: 'npm test' },
        { tool: 'bash', target: 'npm test' },
      ];
      const result = detectPattern(stuck, 3);
      expect(result).toContain('stuck loop');
      expect(result).toContain('bash');
      expect(result).toContain('npm test');
    });

    test('healthy window returns null through the re-export', () => {
      const healthy: ToolCallObservation[] = [
        { tool: 'file-read', target: 'a' },
        { tool: 'file-edit', target: 'a' },
      ];
      expect(detectPattern(healthy, 2)).toBeNull();
    });
  });

  describe('cross-cutting: summarizeToolCall feeds buildSelfMonitorObservation', () => {
    // Verify the two functions share the same ToolCallObservation shape
    // contract — summarizeToolCall's output is buildSelfMonitorObservation's input.

    test('round-trip: summarizeToolCall output is a valid buildSelfMonitorObservation entry', () => {
      const obs = summarizeToolCall('file-read', { path: 'src/x.ts' });
      // No throw — shape is compatible.
      const nudge = buildSelfMonitorObservation([obs], 1);
      expect(nudge).toContain('file-read(');
      expect(nudge).toContain('src/x.ts');
    });

    test('error-flagged observation survives round-trip and surfaces in detectPattern', () => {
      const errObs = summarizeToolCall('bash', { command: 'npm test' }, true);
      expect(errObs.error).toBe(true);
      // Error loop needs 2 consecutive errors to fire.
      const nudge = buildSelfMonitorObservation([errObs, errObs], 2);
      expect(nudge).toContain('errored');
    });

    test('windowed slice of observations renders as comma-joined sequence', () => {
      // Simulate the orchestrator's rolling window: 6 entries (SELF_MONITOR_WINDOW).
      const window: ToolCallObservation[] = Array.from({ length: SELF_MONITOR_WINDOW }, (_, i) => ({
        tool: `t${i}`,
        target: `arg${i}`,
      }));
      const nudge = buildSelfMonitorObservation(window, SELF_MONITOR_WINDOW);
      for (let i = 0; i < SELF_MONITOR_WINDOW; i++) {
        expect(nudge).toContain(`t${i}(arg${i})`);
      }
    });
  });
});
