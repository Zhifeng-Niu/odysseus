import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recordEvent,
  readEventLog,
  eventsForWaypoint,
} from '../../src/trace/event-log.js';
import type { OrchestratorEvent } from '../../src/orchestrator/events.js';

/**
 * event-log.ts — the agent's retrospective observability spine.
 *
 * Iteration 27 — no dedicated test file existed. The module is small
 * but its contracts are load-bearing for the feedback loop documented
 * in memory: "复盘优先读 .odysseus/events.jsonl". If readEventLog ever
 * started throwing on malformed lines, a single corrupted tail would
 * make the ENTIRE voyage unreadable — losing every prior event. If
 * recordEvent ever started throwing on disk-full, a logging failure
 * would crash the voyage itself.
 *
 * These tests pin:
 *   - recordEvent appends JSONL and swallows errors
 *   - recordEvent serializes concurrent writes (no interleaved partial lines)
 *   - readEventLog treats missing file as empty (not an error)
 *   - readEventLog skips malformed lines, preserves valid ones
 *   - eventsForWaypoint filters by waypointId and excludes events without it
 */

// Helper: wait long enough for the module's internal writeChain to flush.
// recordEvent is fire-and-forget — it returns void and the write happens
// in a promise chain captured at module scope. Tests cannot await the
// chain directly, so we poll for the expected line count.
async function waitForLineCount(
  path: string,
  expected: number,
  timeoutMs = 500
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const content = await import('node:fs/promises').then((fs) => fs.readFile(path, 'utf8'));
      const lines = content.split('\n').filter((l) => l.trim().length > 0).length;
      if (lines >= expected) return;
    } catch {
      // File may not exist yet — keep polling.
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${expected} lines at ${path}`);
}

describe('trace/event-log', () => {
  let dir: string;
  let logPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ody-el-'));
    logPath = join(dir, 'events.jsonl');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // recordEvent — append + serialize + swallow
  // -----------------------------------------------------------------------

  describe('recordEvent', () => {
    test('appends an event as a single JSON line', async () => {
      const event: OrchestratorEvent = {
        type: 'voyage-started',
        voyageId: 'v_1',
        prompt: 'hello',
        ts: 1_000,
      };
      recordEvent(logPath, event);
      await waitForLineCount(logPath, 1);
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(logPath, 'utf8');
      expect(raw).toBe(`${JSON.stringify(event)}\n`);
    });

    test('serializes concurrent writes — no interleaved partial lines', async () => {
      // Fire 50 events on the same tick. Without serialization, the
      // appendFile calls would race and produce partial-line garbage
      // like `{"type":"voyage-st\narted"...}`. The writeChain promise
      // queue must sequence them.
      const N = 50;
      for (let i = 0; i < N; i++) {
        const event: OrchestratorEvent = {
          type: 'voyage-started',
          voyageId: `v_${i}`,
          prompt: `p_${i}`,
          ts: i,
        };
        recordEvent(logPath, event);
      }
      await waitForLineCount(logPath, N);
      const events = await readEventLog(logPath);
      expect(events).toHaveLength(N);
      // Every line must round-trip — if any had been a parse failure,
      // readEventLog would have silently dropped it (see the malformed-
      // line test below).
      expect(events[0]!.type).toBe('voyage-started');
      expect((events[0] as { voyageId: string }).voyageId).toBe('v_0');
      expect((events[N - 1] as { voyageId: string }).voyageId).toBe(`v_${N - 1}`);
    });

    test('creates parent directory if it does not exist', async () => {
      const nested = join(dir, 'nested', 'deep', 'events.jsonl');
      const event: OrchestratorEvent = {
        type: 'voyage-started',
        voyageId: 'v_nested',
        prompt: '',
        ts: 1,
      };
      recordEvent(nested, event);
      await waitForLineCount(nested, 1);
      // No assertion needed beyond waitForLineCount succeeding — if the
      // parent dir hadn't been created, the write would have failed
      // silently and the file would never appear.
    });

    test('swallows write errors (best-effort logging, never throws)', async () => {
      // Point recordEvent at a path whose parent is a file (not a dir).
      // mkdir({recursive:true}) would still succeed, but appendFile
      // would hit ENOTDIR. recordEvent must catch this internally —
      // a logging failure must not propagate.
      const blocker = join(dir, 'blocker');
      await writeFile(blocker, 'i am a file, not a directory', 'utf8');
      const badPath = join(blocker, 'events.jsonl');
      const event: OrchestratorEvent = {
        type: 'voyage-started',
        voyageId: 'v_blocked',
        prompt: '',
        ts: 1,
      };
      // The contract: does not throw.
      expect(() => recordEvent(badPath, event)).not.toThrow();
      // Give the swallowed rejection time to settle so it doesn't bleed
      // into the next test as an unhandled rejection.
      await new Promise((r) => setTimeout(r, 30));
    });
  });

  // -----------------------------------------------------------------------
  // readEventLog — defensive parsing
  // -----------------------------------------------------------------------

  describe('readEventLog', () => {
    test('returns empty array when the file does not exist', async () => {
      // Retrospective reads must not crash on a fresh install where
      // no events have been recorded yet.
      const result = await readEventLog(join(dir, 'never-existed.jsonl'));
      expect(result).toEqual([]);
    });

    test('returns empty array for an empty file', async () => {
      await writeFile(logPath, '', 'utf8');
      const result = await readEventLog(logPath);
      expect(result).toEqual([]);
    });

    test('skips blank lines (trailing newline, double newline)', async () => {
      await writeFile(logPath, '{"type":"x"}\n\n{"type":"y"}\n', 'utf8');
      // Note: these are NOT valid OrchestratorEvent shapes (the union
      // doesn't include type:'x'), but readEventLog doesn't validate —
      // it just parses. The filter is purely structural. Tests below
      // verify the valid-event behavior with real shapes.
      const result = await readEventLog(logPath);
      expect(result).toHaveLength(2);
    });

    test('skips malformed JSON lines, preserves valid ones', async () => {
      // The critical regression: if the tail of the file is corrupted
      // (partial write, disk error, concurrent writer race), the earlier
      // events must still be readable. A single throw on parse would
      // make the entire voyage unreadable.
      const valid: OrchestratorEvent = {
        type: 'voyage-started',
        voyageId: 'v_ok',
        prompt: 'p',
        ts: 1,
      };
      const raw = [
        `${JSON.stringify(valid)}\n`,
        '{not valid json\n',
        'also not valid\n',
        `${JSON.stringify({ type: 'voyage-completed', voyageId: 'v_ok', ts: 2 })}\n`,
      ].join('');
      await writeFile(logPath, raw, 'utf8');
      const result = await readEventLog(logPath);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(valid);
      expect(result[1]).toEqual({ type: 'voyage-completed', voyageId: 'v_ok', ts: 2 });
    });

    test('returns events in emission (file) order', async () => {
      // Order matters for retrospective — the chain of tool calls and
      // verify outcomes only makes sense in the order they happened.
      const events: OrchestratorEvent[] = [
        { type: 'voyage-started', voyageId: 'v', prompt: '', ts: 1 },
        { type: 'voyage-completed', voyageId: 'v', ts: 2 },
      ];
      await writeFile(logPath, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
      const result = await readEventLog(logPath);
      expect(result.map((e) => e.type)).toEqual(['voyage-started', 'voyage-completed']);
    });

    test('handles file with no trailing newline on the last line', async () => {
      // POSIX tools often omit the trailing newline. readEventLog must
      // still pick up the last line.
      await writeFile(logPath, '{"type":"voyage-started","voyageId":"v","prompt":"","ts":1}', 'utf8');
      const result = await readEventLog(logPath);
      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe('voyage-started');
    });
  });

  // -----------------------------------------------------------------------
  // eventsForWaypoint — waypoint-scoped retrospective
  // -----------------------------------------------------------------------

  describe('eventsForWaypoint', () => {
    test('returns only events whose waypointId matches', () => {
      const events: OrchestratorEvent[] = [
        { type: 'waypoint-started', waypointId: 'wp_a', goal: 'g', strategy: 'direct-edit', ts: 1 },
        { type: 'assistant-message', waypointId: 'wp_a', content: 'c', ts: 2 },
        { type: 'waypoint-started', waypointId: 'wp_b', goal: 'g', strategy: 'direct-edit', ts: 3 },
        { type: 'assistant-message', waypointId: 'wp_a', content: 'c2', ts: 4 },
      ];
      const result = eventsForWaypoint(events, 'wp_a');
      expect(result).toHaveLength(3);
      expect(result.every((e) => 'waypointId' in e && e.waypointId === 'wp_a')).toBe(true);
    });

    test('returns empty array when no events match', () => {
      const events: OrchestratorEvent[] = [
        { type: 'waypoint-started', waypointId: 'wp_a', goal: 'g', strategy: 'direct-edit', ts: 1 },
      ];
      expect(eventsForWaypoint(events, 'wp_other')).toEqual([]);
    });

    test('excludes events that do not carry a waypointId field', () => {
      // Brain-state and voyage-level events are NOT waypoint-scoped.
      // eventsForWaypoint filters them out by checking 'waypointId' in e.
      // If anyone widened the filter to "include events with no waypointId",
      // voyage-level noise would pollute waypoint retrospectives.
      const events: OrchestratorEvent[] = [
        { type: 'voyage-started', voyageId: 'v', prompt: '', ts: 1 }, // no waypointId
        {
          type: 'brain-state-changed',
          from: 'idle',
          to: 'wakeful',
          reason: 'first input',
          ts: 2,
        }, // no waypointId
        { type: 'waypoint-started', waypointId: 'wp_a', goal: 'g', strategy: 'direct-edit', ts: 3 },
      ];
      const result = eventsForWaypoint(events, 'wp_a');
      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe('waypoint-started');
    });

    test('returns empty array for an empty input', () => {
      expect(eventsForWaypoint([], 'wp_a')).toEqual([]);
    });

    test('preserves original event order', () => {
      // eventsForWaypoint is a filter, not a sort. The retrospective UI
      // relies on getting events back in the order they were emitted.
      const events: OrchestratorEvent[] = [
        { type: 'waypoint-started', waypointId: 'wp', goal: 'g', strategy: 'direct-edit', ts: 10 },
        { type: 'assistant-message', waypointId: 'wp', content: 'first', ts: 20 },
        { type: 'assistant-message', waypointId: 'wp', content: 'second', ts: 30 },
      ];
      const result = eventsForWaypoint(events, 'wp');
      expect(result.map((e) => (e as { content?: string }).content)).toEqual([
        undefined,
        'first',
        'second',
      ]);
    });

    test('does not mutate the input array', () => {
      // Immutability contract per CLAUDE.md — filter returns a new array.
      const events: OrchestratorEvent[] = [
        { type: 'waypoint-started', waypointId: 'wp', goal: 'g', strategy: 'direct-edit', ts: 1 },
        { type: 'assistant-message', waypointId: 'wp', content: 'c', ts: 2 },
      ];
      const snapshot = [...events];
      eventsForWaypoint(events, 'wp');
      expect(events).toEqual(snapshot);
    });
  });

  // -----------------------------------------------------------------------
  // Cross-cutting: recordEvent → readEventLog round-trip
  // -----------------------------------------------------------------------

  describe('recordEvent + readEventLog round-trip', () => {
    test('every recorded event is readable with no loss', async () => {
      const events: OrchestratorEvent[] = [
        { type: 'voyage-started', voyageId: 'v_rt', prompt: 'p', ts: 1 },
        {
          type: 'waypoint-started',
          waypointId: 'wp_rt',
          goal: 'goal',
          strategy: 'direct-edit',
          ts: 2,
        },
        { type: 'assistant-message', waypointId: 'wp_rt', content: 'hi', ts: 3 },
        { type: 'voyage-completed', voyageId: 'v_rt', ts: 4 },
      ];
      for (const e of events) {
        recordEvent(logPath, e);
      }
      await waitForLineCount(logPath, events.length);
      const read = await readEventLog(logPath);
      expect(read).toEqual(events);
    });
  });
});
