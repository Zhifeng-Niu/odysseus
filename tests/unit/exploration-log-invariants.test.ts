import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendExploration } from '../../src/cerebellum/exploration-log.js';

/**
 * appendExploration — default-value + JSON-shape invariants.
 *
 * exploration-log.test.ts covers behavioral contracts (write/read round-trip,
 * sort order, join semantics, markdown rendering — 24 tests). It does NOT pin
 * the default-value population or the exact JSON shape appendExploration
 * writes to disk. Those defaults are a load-bearing contract because:
 *
 *   1. The curiosity phase calls appendExploration with the minimal shape
 *      (goal + origin + priority). The id and ts fields are auto-generated.
 *      A silent default change (e.g. id format drifting from `expl_<hex>`
 *      to a bare UUID) would break operator grep patterns and the markdown
 *      renderer's assumptions.
 *
 *   2. The voyage_id field has exactOptionalPropertyTypes-sensitive
 *      handling: when undefined, it must NOT appear in the JSON output
 *      at all (not `voyage_id: undefined`, which is invalid JSON-with-
 *      optional-semantics). This mirrors the appendTrace contract pinned
 *      in trace-jsonl-invariants.test.ts (Iteration 65) — same shape,
 *      different file.
 *
 *   3. Downstream joinWithTraceOutcomes reads the file and JSON.parses each
 *      line. If the key set drifts (e.g. extra keys appear, or required keys
 *      vanish), the type assertion `as ExplorationRecord` would silently
 *      produce undefined fields, breaking the markdown renderer.
 *
 * Each test below documents one slice of the contract. Tests assert on
 * the raw JSON written to disk (not the returned object) so a regression
 * in the serialization layer is caught.
 */

describe('appendExploration — default id and ts generation', () => {
  let workdir: string;
  let path: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-expl-inv-'));
    path = join(workdir, 'explorations.jsonl');
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  async function appendAndRead(
    input: Parameters<typeof appendExploration>[1],
  ): Promise<Record<string, unknown>> {
    await appendExploration(path, input);
    const raw = await readFile(path, 'utf8');
    const lines = raw.trim().split('\n');
    const last = lines[lines.length - 1]!;
    return JSON.parse(last) as Record<string, unknown>;
  }

  // -------------------------------------------------------------------------
  // id — generated as `expl_<10 hex chars>` when omitted
  // -------------------------------------------------------------------------

  test('id defaults to `expl_<10 hex chars>` format when omitted', async () => {
    // The id is `expl_` + 6 hex (timestamp) + 4 hex (random) = 10 hex
    // chars total. This format is documented in the source as
    // "format: `expl_<8 hex chars>` for grep-ability" — but the actual
    // implementation produces 10 hex chars (6 ts + 4 rand). Pinning the
    // ACTUAL shape so a refactor that changes either side (ts slice or
    // rand length) is caught. Operator workflows rely on `grep expl_`
    // finding every id, so the PREFIX is the load-bearing part.
    const rec = await appendAndRead({
      goal: 'x',
      origin: 'curiosity',
      priority: 90,
    });
    expect(typeof rec['id']).toBe('string');
    expect(rec['id']).toMatch(/^expl_[0-9a-f]{10}$/);
  });

  test('caller-supplied id is preserved verbatim (no format enforcement)', async () => {
    // The function accepts any string for id — there is no validation
    // that it matches the default format. This lets tests pin ids and
    // lets external callers (e.g. a migration script) use their own
    // scheme. Pinning that NO validation runs so a future "helpful"
    // refactor that adds a regex check doesn't break migrations.
    const rec = await appendAndRead({
      id: 'migration_001',
      goal: 'x',
      origin: 'curiosity',
      priority: 90,
    });
    expect(rec['id']).toBe('migration_001');
  });

  test('ids are not duplicated across rapid successive calls', async () => {
    // The id is timestamp + random. Within the same millisecond the ts
    // portion is identical, but the random portion differs. 20 rapid
    // calls should produce 20 distinct ids. If the random source broke
    // (e.g. seeding to 0), this test catches it.
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const rec = await appendAndRead({
        goal: `g${i}`,
        origin: 'curiosity',
        priority: 90,
      });
      ids.add(rec['id'] as string);
    }
    expect(ids.size).toBe(20);
  });

  // -------------------------------------------------------------------------
  // ts — auto-populated ISO 8601, caller cannot forge a historical value
  // -------------------------------------------------------------------------

  test('ts defaults to an ISO 8601 string in the current time window', async () => {
    // The timestamp comes from new Date().toISOString(). Verify it's
    // parseable and falls within a tight window around the call.
    const before = new Date().toISOString();
    const rec = await appendAndRead({
      goal: 'x',
      origin: 'curiosity',
      priority: 90,
    });
    const after = new Date().toISOString();
    const ts = rec['ts'];
    expect(typeof ts).toBe('string');
    expect(new Date(ts as string).toString()).not.toBe('Invalid Date');
    expect(ts >= before).toBe(true);
    expect(ts <= after).toBe(true);
  });

  test('caller-supplied ts is preserved verbatim (no validation)', async () => {
    // Unlike appendTrace (which FORCES ts = new Date().toISOString()
    // regardless of caller), appendExploration accepts caller-supplied
    // ts for test determinism. This asymmetry is intentional: trace
    // records are audit-log entries where forgery is a threat;
    // exploration records are prompt-construction hints where pinning
    // ts in tests is more valuable than preventing forgery. Pinning
    // this so a future "consistency" refactor doesn't accidentally
    // make ts caller-overridable in trace or auto-only in exploration.
    const fakeTs = '1999-01-01T00:00:00.000Z';
    const rec = await appendAndRead({
      ts: fakeTs,
      goal: 'x',
      origin: 'curiosity',
      priority: 90,
    });
    expect(rec['ts']).toBe(fakeTs);
  });

  // -------------------------------------------------------------------------
  // goal / origin / priority — passed through verbatim
  // -------------------------------------------------------------------------

  test('goal is passed through verbatim (no trimming, no normalization)', async () => {
    // appendExploration does NOT normalize the goal — that's the job of
    // normalizeGoal() in dreamer-dedup.ts, called only when joining
    // with trace records. The written record preserves the raw goal
    // so the curiosity prompt can quote it exactly as proposed.
    const rec = await appendAndRead({
      goal: '  Add   SPACES   and Punctuation!  ',
      origin: 'curiosity',
      priority: 90,
    });
    expect(rec['goal']).toBe('  Add   SPACES   and Punctuation!  ');
  });

  test('priority is preserved as a number (no coercion)', async () => {
    // JSON.stringify preserves number types. A future refactor that
    // accepts priority as a string "90" would silently change the
    // written type. Pinning that number in → number out.
    const rec = await appendAndRead({
      goal: 'x',
      origin: 'curiosity',
      priority: 75,
    });
    expect(typeof rec['priority']).toBe('number');
    expect(rec['priority']).toBe(75);
  });

  test('origin is preserved verbatim', async () => {
    // Currently the only accepted value is 'curiosity'. But the field
    // is a string, not an enum, so any value is accepted — this lets
    // future dreamer/reflect phases adopt the log without a migration.
    const rec = await appendAndRead({
      goal: 'x',
      origin: 'curiosity',
      priority: 90,
    });
    expect(rec['origin']).toBe('curiosity');
  });
});

// ---------------------------------------------------------------------------
// voyage_id — exactOptionalPropertyTypes handling
// ---------------------------------------------------------------------------

describe('appendExploration — voyage_id exactOptionalPropertyTypes handling', () => {
  let workdir: string;
  let path: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-expl-voy-'));
    path = join(workdir, 'explorations.jsonl');
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  async function appendAndRead(
    input: Parameters<typeof appendExploration>[1],
  ): Promise<Record<string, unknown>> {
    await appendExploration(path, input);
    const raw = await readFile(path, 'utf8');
    const lines = raw.trim().split('\n');
    const last = lines[lines.length - 1]!;
    return JSON.parse(last) as Record<string, unknown>;
  }

  test('omitted voyage_id → key NOT present in JSON output', async () => {
    // The load-bearing exactOptionalPropertyTypes rule. Same as
    // appendTrace: the key must NOT appear when the value is undefined.
    // JSON.stringify drops undefined silently so this works naturally.
    // But a refactor that switches to `voyage_id: input.voyage_id ?? null`
    // would concrete null into the JSON — breaking the optional contract
    // and forcing downstream readers to handle two "missing" shapes.
    const rec = await appendAndRead({
      goal: 'x',
      origin: 'curiosity',
      priority: 90,
    });
    expect('voyage_id' in rec).toBe(false);
  });

  test('explicitly undefined voyage_id → key still NOT present', async () => {
    // The gate is `input.voyage_id !== undefined`. An explicit undefined
    // is treated the same as omitted — the key does not appear in output.
    const rec = await appendAndRead({
      goal: 'x',
      origin: 'curiosity',
      priority: 90,
      voyage_id: undefined,
    });
    expect('voyage_id' in rec).toBe(false);
  });

  test('voyage_id provided → key present with that value', async () => {
    const rec = await appendAndRead({
      goal: 'x',
      origin: 'curiosity',
      priority: 90,
      voyage_id: 'voy_abc123',
    });
    expect(rec['voyage_id']).toBe('voy_abc123');
    expect('voyage_id' in rec).toBe(true);
  });

  test('empty-string voyage_id → key present (NOT treated as missing)', async () => {
    // The gate is `!== undefined`, not a truthiness check. An empty
    // string is technically a malformed but intentional value — the
    // record preserves it so downstream consumers can decide how to
    // handle legacy/empty values. voyage-log treats empty voyage_id as
    // the legacy bucket; exploration-log delegates to its consumers.
    const rec = await appendAndRead({
      goal: 'x',
      origin: 'curiosity',
      priority: 90,
      voyage_id: '',
    });
    expect(rec['voyage_id']).toBe('');
    expect('voyage_id' in rec).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Written record key set — shape invariant
// ---------------------------------------------------------------------------

describe('appendExploration — written record key set', () => {
  let workdir: string;
  let path: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-expl-keys-'));
    path = join(workdir, 'explorations.jsonl');
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('minimal record (no voyage_id) has exactly 5 keys', async () => {
    // Key set when voyage_id is absent:
    //   id, ts, goal, origin, priority
    // = 5 keys. voyage_id is the 6th and is conditionally present.
    // Pinning this exact set so a future field addition (e.g. 'metadata')
    // or removal is flagged loudly.
    await appendExploration(path, {
      goal: 'x',
      origin: 'curiosity',
      priority: 90,
    });
    const raw = await readFile(path, 'utf8');
    const rec = JSON.parse(raw.trim()) as Record<string, unknown>;
    expect(Object.keys(rec)).toHaveLength(5);
    expect(Object.keys(rec).sort()).toEqual(
      ['goal', 'id', 'origin', 'priority', 'ts'].sort(),
    );
  });

  test('record with voyage_id has exactly 6 keys', async () => {
    await appendExploration(path, {
      goal: 'x',
      origin: 'curiosity',
      priority: 90,
      voyage_id: 'v1',
    });
    const raw = await readFile(path, 'utf8');
    const rec = JSON.parse(raw.trim()) as Record<string, unknown>;
    expect(Object.keys(rec)).toHaveLength(6);
    expect('voyage_id' in rec).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Return value vs disk — consistency invariant
// ---------------------------------------------------------------------------

describe('appendExploration — return value matches disk', () => {
  let workdir: string;
  let path: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-expl-ret-'));
    path = join(workdir, 'explorations.jsonl');
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('returned record deep-equals the JSON written to disk', async () => {
    // The function returns the record it wrote. If a future refactor
    // adds post-processing on the returned object (e.g. stripping a
    // field for the caller), the disk record and the return value
    // would diverge silently. Pinning deep equality so they stay in sync.
    const returned = await appendExploration(path, {
      goal: 'sync test',
      origin: 'curiosity',
      priority: 85,
      voyage_id: 'voy_sync',
    });
    const raw = await readFile(path, 'utf8');
    const onDisk = JSON.parse(raw.trim()) as Record<string, unknown>;
    // Deep equality: every key in `returned` matches `onDisk` and vice versa.
    expect(onDisk).toEqual(returned);
  });

  test('multiple appends produce a multi-line file (append-only)', async () => {
    // The file is append-only — each call adds one line. Pinning this
    // so a refactor that switches to read-modify-write (e.g. sorting
    // after each write) doesn't silently change the file shape.
    await appendExploration(path, {
      goal: 'first',
      origin: 'curiosity',
      priority: 90,
    });
    await appendExploration(path, {
      goal: 'second',
      origin: 'curiosity',
      priority: 90,
    });
    await appendExploration(path, {
      goal: 'third',
      origin: 'curiosity',
      priority: 90,
    });
    const raw = await readFile(path, 'utf8');
    const lines = raw.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(3);
    // Order is append-order (oldest first). Reader reverses if needed.
    const goals = lines.map((l) => (JSON.parse(l) as { goal: string }).goal);
    expect(goals).toEqual(['first', 'second', 'third']);
  });
});

// ---------------------------------------------------------------------------
// Directory creation — lazy mkdir invariant
// ---------------------------------------------------------------------------

describe('appendExploration — lazy mkdir', () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-expl-mkdir-'));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('creates arbitrarily nested parent directories', async () => {
    // mkdir dirname(explorationsPath) recursive:true — the function
    // tolerates any depth of missing parents. Pinning so a refactor
    // that switches to a non-recursive mkdir (which fails on missing
    // grandparents) is caught.
    const deeplyNested = join(
      workdir,
      'a',
      'b',
      'c',
      'd',
      'explorations.jsonl',
    );
    const rec = await appendExploration(deeplyNested, {
      goal: 'deep',
      origin: 'curiosity',
      priority: 90,
    });
    expect(rec.id).toMatch(/^expl_/);
    // File exists — read it back to confirm.
    const raw = await readFile(deeplyNested, 'utf8');
    expect(raw.length).toBeGreaterThan(0);
  });

  test('does NOT error when parent directory already exists', async () => {
    // mkdir recursive:true is idempotent — calling it on an existing
    // directory is a no-op. Pinning so a future refactor that adds a
    // "skip if exists" check (which could race) is flagged.
    const p = join(workdir, 'explorations.jsonl');
    await appendExploration(p, {
      goal: 'first',
      origin: 'curiosity',
      priority: 90,
    });
    // Second call to the same path — parent exists.
    await appendExploration(p, {
      goal: 'second',
      origin: 'curiosity',
      priority: 90,
    });
    const raw = await readFile(p, 'utf8');
    const lines = raw.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(2);
  });

  test('tolerates a pre-existing explorations.jsonl with content', async () => {
    // The function does NOT read the file before appending — it's a
    // pure append. Pre-existing content from another writer (e.g. a
    // previous curiosity phase) is preserved. Pinning so a refactor
    // that adds a read-before-write step (which could fail on a
    // corrupted file) is flagged.
    const p = join(workdir, 'explorations.jsonl');
    await writeFile(p, JSON.stringify({ id: 'legacy', ts: '2020-01-01', goal: 'legacy', origin: 'curiosity', priority: 50 }) + '\n');
    await appendExploration(p, {
      goal: 'new',
      origin: 'curiosity',
      priority: 90,
    });
    const raw = await readFile(p, 'utf8');
    const lines = raw.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(2);
    // Legacy line is preserved verbatim.
    const legacy = JSON.parse(lines[0]!) as { goal: string };
    expect(legacy.goal).toBe('legacy');
  });
});
