import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendTrace } from '../../src/trace/jsonl.js';

/**
 * appendTrace default-value invariants.
 *
 * trace-jsonl.test.ts covers basic round-trip mechanics (append, read,
 * malformed-line skip). It does NOT pin the default-value population
 * that appendTrace applies when the caller omits a field. Those defaults
 * are a load-bearing contract because:
 *
 *   1. The orchestrator's trace() method always populates every field
 *      explicitly, so the default path is exercised only by tests,
 *      probes, and direct callers. A silent default change (e.g.
 *      outcome defaulting to 'failure' instead of 'success') would
 *      not be caught by any existing test.
 *
 *   2. Downstream consumers rely on specific shapes. voyage-stats.ts's
 *      countOutcomes switches on outcome; dreamer-dedup.ts's
 *      buildSucceededGoalSet filters on outcome === 'success'. If the
 *      default flipped, every probe-written trace would suddenly count
 *      as a failure and pollute voyage stats.
 *
 *   3. The voyage_id field has exactOptionalPropertyTypes-sensitive
 *      handling: when undefined, it must NOT appear in the JSON output
 *      at all (not `voyage_id: undefined`, which is invalid JSON-with-
 *      optional-semantics). This is the only field with this shape;
 *      the rest are always present in the written record.
 *
 * Each test below documents one default. The default value is pinned
 * via toBe() (not toEqual() on the whole record) so that a regression
 * error message names the specific field that drifted.
 */

describe('appendTrace — required vs defaulted fields', () => {
  let workdir: string;
  let tracePath: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-trace-inv-'));
    tracePath = join(workdir, 'trace.jsonl');
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  async function appendAndRead(
    partial: Parameters<typeof appendTrace>[1],
  ): Promise<Record<string, unknown>> {
    await appendTrace(tracePath, partial);
    const raw = await readFile(tracePath, 'utf8');
    const lines = raw.trim().split('\n');
    const last = lines[lines.length - 1]!;
    return JSON.parse(last) as Record<string, unknown>;
  }

  // -------------------------------------------------------------------------
  // waypoint_id — the ONLY required field (enforced by type signature)
  // -------------------------------------------------------------------------

  test('waypoint_id is always passed through to the written record', async () => {
    const rec = await appendAndRead({ waypoint_id: 'wp_abc' });
    expect(rec['waypoint_id']).toBe('wp_abc');
  });

  // -------------------------------------------------------------------------
  // outcome — default 'success' (load-bearing for dreamer-dedup filter)
  // -------------------------------------------------------------------------

  test('outcome defaults to "success" when omitted', async () => {
    // Downstream consumers (buildSucceededGoalSet, countOutcomes) treat
    // 'success' as the "this shipped" signal. If the default flipped to
    // 'failure', every probe-written record would suddenly count as a
    // failed waypoint and pollute voyage stats + dreamer dedup set.
    const rec = await appendAndRead({ waypoint_id: 'wp' });
    expect(rec['outcome']).toBe('success');
  });

  test('outcome is preserved when caller specifies "failure"', async () => {
    const rec = await appendAndRead({
      waypoint_id: 'wp',
      outcome: 'failure',
    });
    expect(rec['outcome']).toBe('failure');
  });

  test('outcome is preserved when caller specifies "abandoned"', async () => {
    const rec = await appendAndRead({
      waypoint_id: 'wp',
      outcome: 'abandoned',
    });
    expect(rec['outcome']).toBe('abandoned');
  });

  // -------------------------------------------------------------------------
  // goal — default empty string (NOT null or undefined)
  // -------------------------------------------------------------------------

  test('goal defaults to empty string when omitted', async () => {
    // downstream dreamer-prompt.ts renders `${r.goal}` directly in a
    // markdown list; null/undefined would render as the literal string
    // "null"/"undefined" in the prompt. Empty string renders as an
    // empty bullet, which is correct for a probe waypoint.
    const rec = await appendAndRead({ waypoint_id: 'wp' });
    expect(rec['goal']).toBe('');
  });

  // -------------------------------------------------------------------------
  // strategy — default 'engineer'
  // -------------------------------------------------------------------------

  test('strategy defaults to "engineer" when omitted', async () => {
    // The 'engineer' strategy is the wakeful-waypoint default. Probes
    // that write trace records without specifying a strategy should
    // appear as engineer waypoints in the voyage log.
    const rec = await appendAndRead({ waypoint_id: 'wp' });
    expect(rec['strategy']).toBe('engineer');
  });

  // -------------------------------------------------------------------------
  // parent — default null (NOT undefined — must be present in JSON)
  // -------------------------------------------------------------------------

  test('parent defaults to null when omitted', async () => {
    // parent is the lineage pointer (parentWaypointId). null means
    // "no parent" — a top-level waypoint. Must be JSON null (not
    // undefined, which JSON.stringify drops) so downstream consumers
    // can branch on `record.parent === null` without a separate
    // undefined-check.
    const rec = await appendAndRead({ waypoint_id: 'wp' });
    expect(rec['parent']).toBeNull();
    expect('parent' in rec).toBe(true); // key is present, not dropped
  });

  // -------------------------------------------------------------------------
  // checkpoint_sha, fail_reason, diff_summary — nullable defaults
  // -------------------------------------------------------------------------

  test('checkpoint_sha defaults to null when omitted', async () => {
    const rec = await appendAndRead({ waypoint_id: 'wp' });
    expect(rec['checkpoint_sha']).toBeNull();
    expect('checkpoint_sha' in rec).toBe(true);
  });

  test('fail_reason defaults to null when omitted', async () => {
    // fail_reason is null on success. Downstream dreamer-prompt.ts
    // appends ` — FAIL: ${fail_reason.slice(0, 200)}` only when
    // fail_reason is truthy. A null default keeps the success path
    // clean.
    const rec = await appendAndRead({ waypoint_id: 'wp' });
    expect(rec['fail_reason']).toBeNull();
    expect('fail_reason' in rec).toBe(true);
  });

  test('diff_summary defaults to null when omitted', async () => {
    const rec = await appendAndRead({ waypoint_id: 'wp' });
    expect(rec['diff_summary']).toBeNull();
    expect('diff_summary' in rec).toBe(true);
  });

  // -------------------------------------------------------------------------
  // iterations_used — default 0
  // -------------------------------------------------------------------------

  test('iterations_used defaults to 0 when omitted', async () => {
    // Voyage stats sum iterations_used across records. A probe that
    // omits this field should contribute 0, not undefined+NaN.
    const rec = await appendAndRead({ waypoint_id: 'wp' });
    expect(rec['iterations_used']).toBe(0);
  });

  // -------------------------------------------------------------------------
  // tokens_consumed — default { input: 0, output: 0 }
  // -------------------------------------------------------------------------

  test('tokens_consumed defaults to { input: 0, output: 0 } when omitted', async () => {
    // voyage-stats.ts sums tokens_consumed.input and .output. A
    // missing tokens_consumed would crash on `.input` access. The
    // default is a zero-shaped object so probes contribute zero
    // tokens to the voyage totals.
    const rec = await appendAndRead({ waypoint_id: 'wp' });
    expect(rec['tokens_consumed']).toEqual({ input: 0, output: 0 });
  });

  test('tokens_consumed preserves caller-provided values', async () => {
    const rec = await appendAndRead({
      waypoint_id: 'wp',
      tokens_consumed: { input: 150, output: 42 },
    });
    expect(rec['tokens_consumed']).toEqual({ input: 150, output: 42 });
  });

  // -------------------------------------------------------------------------
  // verify_result — default {} (empty object, NOT null)
  // -------------------------------------------------------------------------

  test('verify_result defaults to empty object when omitted', async () => {
    // verify_result is a key-value map of verify-layer results. The
    // orchestrator always passes {} (no layers report results in the
    // current spike). Empty object (not null) lets downstream code
    // iterate without a null check.
    const rec = await appendAndRead({ waypoint_id: 'wp' });
    expect(rec['verify_result']).toEqual({});
    expect('verify_result' in rec).toBe(true);
  });

  // -------------------------------------------------------------------------
  // ts — auto-populated ISO timestamp (caller cannot override)
  // -------------------------------------------------------------------------

  test('ts is auto-populated as an ISO 8601 string', async () => {
    // The timestamp is taken from `new Date().toISOString()` inside
    // appendTrace — the caller cannot pass it. This is load-bearing
    // because voyage-log.ts sorts records by ts when reconstructing
    // voyage boundaries.
    const before = new Date().toISOString();
    const rec = await appendAndRead({ waypoint_id: 'wp' });
    const after = new Date().toISOString();
    const ts = rec['ts'];
    expect(typeof ts).toBe('string');
    // Parseable as ISO date.
    const parsed = new Date(ts as string);
    expect(parsed.toString()).not.toBe('Invalid Date');
    // Falls within the [before, after] window.
    expect(ts >= before).toBe(true);
    expect(ts <= after).toBe(true);
  });

  test('ts cannot be overridden by the caller (appendTrace owns it)', async () => {
    // The type signature forbids passing ts because Partial<TraceRecord>
    // includes all fields — but the implementation always overwrites
    // with new Date().toISOString(). Pinning that the implementation
    // ignores any caller-supplied ts (defensive against an LLM-written
    // probe that tries to forge a historical timestamp).
    const fakeTs = '1999-01-01T00:00:00.000Z';
    const rec = await appendAndRead({
      waypoint_id: 'wp',
      // Casting to bypass type signature — the contract is "even if
      // a caller forces this, appendTrace ignores it."
      ts: fakeTs as never,
    } as Parameters<typeof appendTrace>[1]);
    expect(rec['ts']).not.toBe(fakeTs);
  });

  // -------------------------------------------------------------------------
  // voyage_id — special exactOptionalPropertyTypes handling
  // -------------------------------------------------------------------------

  describe('voyage_id — exactOptionalPropertyTypes handling', () => {
    test('omitted voyage_id → key NOT present in JSON output', async () => {
      // This is the load-bearing exactOptionalPropertyTypes rule.
      // voyage_id is optional in TraceRecord, and the JSON written to
      // disk MUST NOT include the key when the value is undefined.
      // JSON.stringify drops undefined values silently, so this works
      // naturally. But if the implementation ever switched to explicit
      // `voyage_id: partial.voyage_id ?? undefined`, the key would
      // appear as null in the JSON, breaking the optional contract.
      const rec = await appendAndRead({ waypoint_id: 'wp' });
      expect('voyage_id' in rec).toBe(false);
    });

    test('explicitly undefined voyage_id → key still NOT present', async () => {
      // The implementation uses `partial.voyage_id !== undefined` as
      // the gate. So an explicit undefined (vs omitted) also produces
      // no key in the output. This matches the exactOptionalPropertyTypes
      // contract: undefined and missing are equivalent for optional
      // fields.
      const rec = await appendAndRead({
        waypoint_id: 'wp',
        voyage_id: undefined,
      });
      expect('voyage_id' in rec).toBe(false);
    });

    test('voyage_id provided → key present with that value', async () => {
      const rec = await appendAndRead({
        waypoint_id: 'wp',
        voyage_id: 'voyage_abc',
      });
      expect(rec['voyage_id']).toBe('voyage_abc');
      expect('voyage_id' in rec).toBe(true);
    });

    test('empty-string voyage_id → key present (NOT treated as missing)', async () => {
      // The gate is `!== undefined`, not a truthiness check. So an
      // empty-string voyage_id (which is technically a malformed but
      // intentional value) IS written. voyage-log.ts treats empty
      // voyage_id as the legacy voyage bucket. Pinning this so a future
      // refactor that tightens the gate (e.g. `?.length` check) is
      // flagged loudly.
      const rec = await appendAndRead({
        waypoint_id: 'wp',
        voyage_id: '',
      });
      expect(rec['voyage_id']).toBe('');
      expect('voyage_id' in rec).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Full record shape — round-trip of every field
  // -------------------------------------------------------------------------

  test('fully-specified record preserves every field exactly', async () => {
    // Sanity check: when the caller provides every field, the output
    // matches exactly (no field is silently dropped or transformed).
    const rec = await appendAndRead({
      waypoint_id: 'wp_full',
      goal: 'add retry logic',
      strategy: 'engineer-bias-action',
      parent: 'wp_parent',
      outcome: 'failure',
      checkpoint_sha: 'abc123',
      iterations_used: 7,
      tokens_consumed: { input: 1000, output: 500 },
      verify_result: { lint: 'pass', tests: 'fail' },
      fail_reason: 'tests failed',
      diff_summary: '3 files changed',
      voyage_id: 'voyage_xyz',
    });
    expect(rec['waypoint_id']).toBe('wp_full');
    expect(rec['goal']).toBe('add retry logic');
    expect(rec['strategy']).toBe('engineer-bias-action');
    expect(rec['parent']).toBe('wp_parent');
    expect(rec['outcome']).toBe('failure');
    expect(rec['checkpoint_sha']).toBe('abc123');
    expect(rec['iterations_used']).toBe(7);
    expect(rec['tokens_consumed']).toEqual({ input: 1000, output: 500 });
    expect(rec['verify_result']).toEqual({ lint: 'pass', tests: 'fail' });
    expect(rec['fail_reason']).toBe('tests failed');
    expect(rec['diff_summary']).toBe('3 files changed');
    expect(rec['voyage_id']).toBe('voyage_xyz');
    // ts is auto-populated — verify it exists but don't pin the value.
    expect(typeof rec['ts']).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Top-level record shape — invariant on the set of keys present
// ---------------------------------------------------------------------------

describe('appendTrace — written record key set', () => {
  let workdir: string;
  let tracePath: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-trace-keys-'));
    tracePath = join(workdir, 'trace.jsonl');
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('minimal record (waypoint_id only) has exactly 12 keys', async () => {
    // The complete key set when voyage_id is absent:
    //   ts, waypoint_id, goal, strategy, parent, outcome,
    //   checkpoint_sha, iterations_used, tokens_consumed,
    //   verify_result, fail_reason, diff_summary
    // = 12 keys. voyage_id is the 13th and is conditionally present.
    await appendTrace(tracePath, { waypoint_id: 'wp' });
    const raw = await readFile(tracePath, 'utf8');
    const rec = JSON.parse(raw.trim()) as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    expect(keys).toEqual(
      [
        'checkpoint_sha',
        'diff_summary',
        'fail_reason',
        'goal',
        'iterations_used',
        'outcome',
        'parent',
        'strategy',
        'tokens_consumed',
        'ts',
        'verify_result',
        'waypoint_id',
      ].sort(),
    );
  });

  test('record with voyage_id has exactly 13 keys', async () => {
    await appendTrace(tracePath, { waypoint_id: 'wp', voyage_id: 'v1' });
    const raw = await readFile(tracePath, 'utf8');
    const rec = JSON.parse(raw.trim()) as Record<string, unknown>;
    expect(Object.keys(rec)).toHaveLength(13);
    expect('voyage_id' in rec).toBe(true);
  });
});
