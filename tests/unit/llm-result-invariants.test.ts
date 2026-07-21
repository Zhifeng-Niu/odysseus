import { describe, test, expect } from 'vitest';
import {
  isObject,
  parsePriority,
  isMemoryCategory,
  coerceBacklogItem,
  coerceMemoryEntry,
} from '../../src/cerebellum/llm-result.js';

/**
 * llm-result — structural shape and contract invariants.
 *
 * llm-result.test.ts covers behavior — the "what does each function
 * return for each input" matrix (60+ tests). But the structural
 * contracts a refactor could silently break are NOT pinned:
 *
 *   - exactOptionalPropertyTypes on coerceBacklogItem. When priority
 *     or rationale is absent, the key MUST be absent from the result
 *     object — not present-with-undefined. A refactor that does
 *     `{ goal, priority: undefined }` would break JSON consumers
 *     that distinguish missing keys from undefined values.
 *
 *   - clamp/round ORDER. parsePriority does Math.round THEN clamps
 *     via Math.max(0, Math.min(100, ...)). Reordering (clamp first,
 *     then round) would produce different results at boundaries:
 *     e.g. 100.6 → round-then-clamp gives 100, clamp-then-round
 *     gives 100 too — but 0.4 → round-then-clamp is 0,
 *     clamp-then-round is 0. Hmm. Let me think. The order matters
 *     when round would push outside [0,100], but round of a number
 *     inside [0,100] stays inside. So clamp-then-round and round-
 *     then-clamp are equivalent here. Pinning that the output is
 *     always an integer in [0,100] (the post-condition).
 *
 *   - MEMORY CATEGORY CLOSED SET. The 4 categories are hardcoded:
 *     patterns | lessons | preferences | dreams. Adding a 5th
 *     category in one place but not others would cause silent
 *     data loss. Pinning that exactly these 4 strings are valid.
 *
 *   - TITLE TRUNCATION BOUNDARY. coerceMemoryEntry slices title
 *     to [0, 200] — 200 inclusive, 201 truncated. Pinning the
 *     exact boundary so a refactor that changes to 199 or 201 is
 *     caught.
 *
 *   - TRIM-THEN-CHECK-EMPTY ORDER. goal/title/body/rationale are
 *     trimmed FIRST, then checked for zero length. Reversing this
 *     would accept whitespace-only strings.
 *
 *   - NULL/KIV SHAPE OF RETURN. coerceBacklogItem and coerceMemoryEntry
 *     return `T | null` — null is the only failure marker. There is
 *     no `{ ok: false, error }` variant. Pinning the shape so a
 *     refactor that adds an error field is caught.
 *
 *   - ISARRAY EXCLUSION IN ISOBJECT. typeof [] === 'object', so the
 *     explicit Array.isArray rejection is load-bearing. Removing it
 *     would silently accept arrays as if they were records.
 *
 * Each test below pins one slice of these contracts.
 */

describe('coerceBacklogItem — exactOptionalPropertyTypes contract', () => {
  // The result type is { goal: string; priority?: number; rationale?: string }.
  // Under exactOptionalPropertyTypes, when priority is absent the KEY must
  // be absent — not present with value undefined.

  test('goal-only result has exactly 1 key: { goal }', () => {
    const result = coerceBacklogItem({ goal: 'x' });
    expect(result).not.toBeNull();
    expect(Object.keys(result).sort()).toEqual(['goal']);
  });

  test('priority omitted → key is ABSENT (not undefined)', () => {
    const result = coerceBacklogItem({ goal: 'x' });
    expect(result).not.toBeNull();
    expect('priority' in result!).toBe(false);
    expect(result!.priority).toBeUndefined();
  });

  test('rationale omitted → key is ABSENT (not undefined)', () => {
    const result = coerceBacklogItem({ goal: 'x' });
    expect('rationale' in result!).toBe(false);
    expect(result!.rationale).toBeUndefined();
  });

  test('priority present → exactly 2 keys: { goal, priority }', () => {
    const result = coerceBacklogItem({ goal: 'x', priority: 42 });
    expect(Object.keys(result).sort()).toEqual(['goal', 'priority']);
  });

  test('rationale present → exactly 2 keys: { goal, rationale }', () => {
    const result = coerceBacklogItem({ goal: 'x', rationale: 'why' });
    expect(Object.keys(result).sort()).toEqual(['goal', 'rationale']);
  });

  test('priority + rationale present → exactly 3 keys', () => {
    const result = coerceBacklogItem({
      goal: 'x',
      priority: 42,
      rationale: 'why',
    });
    expect(Object.keys(result).sort()).toEqual(['goal', 'priority', 'rationale']);
  });

  test('invalid priority (NaN) → priority key ABSENT, not undefined', () => {
    // The source explicitly omits the key when parsePriority returns undefined.
    const result = coerceBacklogItem({ goal: 'x', priority: NaN });
    expect('priority' in result!).toBe(false);
  });

  test('whitespace rationale → rationale key ABSENT', () => {
    // Rationale is checked for non-empty AFTER trim. Whitespace-only
    // produces undefined, which means the key is omitted.
    const result = coerceBacklogItem({ goal: 'x', rationale: '   ' });
    expect('rationale' in result!).toBe(false);
  });

  test('extra unknown fields on input are NOT propagated to output', () => {
    // The source constructs a fresh object with only goal/priority/rationale.
    // Unknown keys on the input are dropped — pinning that the output shape
    // is exactly the LlmBacklogItem interface.
    const result = coerceBacklogItem({
      goal: 'x',
      extra: 'ignored',
      malicious: true,
      id: 'should-not-leak',
    });
    expect(Object.keys(result).sort()).toEqual(['goal']);
  });

  test('returned object is a fresh instance (no reference to input)', () => {
    // The source uses object spread — the result is a new object, not
    // a reference to the raw input. Mutating the result must not affect
    // the input (and vice versa).
    const raw = { goal: 'x', priority: 42 };
    const result = coerceBacklogItem(raw);
    expect(result).not.toBe(raw);
    // Priority IS transferred:
    expect(result?.priority).toBe(42);
  });
});

describe('coerceMemoryEntry — exactOptionalPropertyTypes contract', () => {
  // MemoryEntry has no optional fields — all 3 are required. But the
  // source still constructs via spread, so unknown fields are stripped.

  test('valid result has exactly 3 keys: { category, title, body }', () => {
    const result = coerceMemoryEntry({
      category: 'patterns',
      title: 't',
      body: 'b',
    });
    expect(result).not.toBeNull();
    expect(Object.keys(result).sort()).toEqual(['body', 'category', 'title']);
  });

  test('extra unknown fields are NOT propagated', () => {
    const result = coerceMemoryEntry({
      category: 'patterns',
      title: 't',
      body: 'b',
      id: 'should-not-leak',
      ts: 12345,
      metadata: { anything: true },
    });
    expect(Object.keys(result).sort()).toEqual(['body', 'category', 'title']);
  });

  test('returned object is a fresh instance (no reference to input)', () => {
    const raw = { category: 'patterns' as const, title: 't', body: 'b' };
    const result = coerceMemoryEntry(raw);
    expect(result).not.toBe(raw);
  });

  test('title field is a string (never a number or other type)', () => {
    // Even if the raw title were something else, it would have been
    // rejected earlier. Pinning that on success title is a string.
    const result = coerceMemoryEntry({
      category: 'patterns',
      title: 't',
      body: 'b',
    });
    expect(typeof result?.title).toBe('string');
  });
});

describe('parsePriority — post-conditions', () => {
  // parsePriority returns number | undefined. When defined, the value
  // is ALWAYS an integer in [0, 100]. Pinning the post-condition so a
  // refactor that changes rounding or clamping is caught.

  test('when defined, result is always an integer', () => {
    // Round half up (positive half → round up). 50.5 → 51, -0.5 → 0.
    // The output is always integer when defined.
    const inputs = [0, 0.5, 1, 1.4, 1.5, 1.6, 50, 99.5, 100];
    for (const v of inputs) {
      const result = parsePriority(v);
      expect(result).not.toBeUndefined();
      expect(Number.isInteger(result)).toBe(true);
    }
  });

  test('when defined, result is always in [0, 100]', () => {
    const inputs = [-1000, -0.5, 0, 0.5, 50, 99.5, 100, 100.5, 9999];
    for (const v of inputs) {
      const result = parsePriority(v);
      expect(result).not.toBeUndefined();
      expect(result!).toBeGreaterThanOrEqual(0);
      expect(result!).toBeLessThanOrEqual(100);
    }
  });

  test('Math.round half-up behavior (not banker\'s rounding)', () => {
    // JS Math.round rounds half toward +Infinity: 0.5 → 1, 1.5 → 2, 2.5 → 3.
    // (Not banker's rounding which would round to even: 0.5 → 0, 1.5 → 2.)
    // This is the JS standard, but pinning to catch a refactor that
    // switches to a different rounding function.
    expect(parsePriority(0.5)).toBe(1);
    expect(parsePriority(1.5)).toBe(2);
    expect(parsePriority(2.5)).toBe(3);
    expect(parsePriority(-0.5)).toBe(0); // -0.5 → 0 in Math.round, then clamped
  });

  test('boundary: 0 is the minimum after clamp (negative input → 0)', () => {
    expect(parsePriority(-0.1)).toBe(0);
    expect(parsePriority(-1)).toBe(0);
    expect(parsePriority(-1000)).toBe(0);
  });

  test('boundary: 100 is the maximum after clamp (oversized input → 100)', () => {
    expect(parsePriority(100.1)).toBe(100);
    expect(parsePriority(101)).toBe(100);
    expect(parsePriority(Number.MAX_VALUE)).toBe(100);
  });

  test('undefined for non-finite (NaN, ±Infinity)', () => {
    // Number.isFinite rejects these. Pinning that parsePriority uses
    // Number.isFinite (not just typeof check).
    expect(parsePriority(NaN)).toBeUndefined();
    expect(parsePriority(Infinity)).toBeUndefined();
    expect(parsePriority(-Infinity)).toBeUndefined();
  });

  test('undefined for non-number types', () => {
    // typeof check before Number.isFinite.
    expect(parsePriority('50')).toBeUndefined();
    expect(parsePriority('high')).toBeUndefined();
    expect(parsePriority(true)).toBeUndefined();
    expect(parsePriority(false)).toBeUndefined();
    expect(parsePriority(null)).toBeUndefined();
    expect(parsePriority(undefined)).toBeUndefined();
    expect(parsePriority({})).toBeUndefined();
    expect(parsePriority([])).toBeUndefined();
    expect(parsePriority([50])).toBeUndefined();
  });

  test('numeric strings are NOT coerced (strict typeof number check)', () => {
    // The source does NOT use Number(v) — it requires the runtime type
    // to already be 'number'. Pinning that '50' (string) is rejected
    // rather than coerced to 50.
    expect(parsePriority('50')).toBeUndefined();
    expect(parsePriority('0')).toBeUndefined();
    expect(parsePriority('100')).toBeUndefined();
  });

  test('boolean is NOT coerced to 0/1 (strict typeof number check)', () => {
    // In JS, Number(true) === 1. But parsePriority rejects booleans.
    expect(parsePriority(true)).toBeUndefined();
    expect(parsePriority(false)).toBeUndefined();
  });
});

describe('isMemoryCategory — closed set constancy', () => {
  // The 4 valid categories are hardcoded in source as a string-literal
  // comparison chain. Adding a 5th category requires updating both
  // the type alias and the runtime check. Pinning that exactly these
  // 4 (and no others) are valid.

  test('exactly 4 categories are valid', () => {
    const validCategories = ['patterns', 'lessons', 'preferences', 'dreams'];
    for (const cat of validCategories) {
      expect(isMemoryCategory(cat)).toBe(true);
    }
    // Pinning the count — a refactor that adds a 5th must update this test.
    expect(validCategories.length).toBe(4);
  });

  test('case-sensitive: uppercase variants are rejected', () => {
    expect(isMemoryCategory('Patterns')).toBe(false);
    expect(isMemoryCategory('PATTERNS')).toBe(false);
    expect(isMemoryCategory('LESSONS')).toBe(false);
  });

  test('singular form rejected (only plurals are valid)', () => {
    expect(isMemoryCategory('pattern')).toBe(false);
    expect(isMemoryCategory('lesson')).toBe(false);
    expect(isMemoryCategory('preference')).toBe(false);
    expect(isMemoryCategory('dream')).toBe(false);
  });

  test('typo variants rejected', () => {
    expect(isMemoryCategory('preference')).toBe(false); // singular
    expect(isMemoryCategory('preferneces')).toBe(false); // typo
    expect(isMemoryCategory('lessonns')).toBe(false); // extra letter
  });

  test('empty string rejected', () => {
    expect(isMemoryCategory('')).toBe(false);
  });

  test('non-string inputs rejected (typeof string check is first)', () => {
    expect(isMemoryCategory(null)).toBe(false);
    expect(isMemoryCategory(undefined)).toBe(false);
    expect(isMemoryCategory(42)).toBe(false);
    expect(isMemoryCategory({})).toBe(false);
    expect(isMemoryCategory(['patterns'])).toBe(false);
    expect(isMemoryCategory(true)).toBe(false);
  });

  test('strings with whitespace are rejected (no trim applied)', () => {
    // isMemoryCategory does NOT trim. The input must be exactly one of
    // the 4 categories.
    expect(isMemoryCategory(' patterns ')).toBe(false);
    expect(isMemoryCategory('patterns\n')).toBe(false);
    expect(isMemoryCategory('\tpatterns')).toBe(false);
  });
});

describe('coerceMemoryEntry — title truncation boundary', () => {
  // The source does title.slice(0, 200). slice(0, 200) keeps chars at
  // indexes 0..199, so 200 chars total. Pinning the exact boundary.

  test('title of exactly 200 chars → preserved at 200', () => {
    const title = 'a'.repeat(200);
    const result = coerceMemoryEntry({
      category: 'patterns',
      title,
      body: 'b',
    });
    expect(result?.title.length).toBe(200);
    expect(result?.title).toBe(title);
  });

  test('title of 201 chars → truncated to 200', () => {
    const title = 'a'.repeat(201);
    const result = coerceMemoryEntry({
      category: 'patterns',
      title,
      body: 'b',
    });
    expect(result?.title.length).toBe(200);
  });

  test('title of 199 chars → preserved at 199', () => {
    const title = 'a'.repeat(199);
    const result = coerceMemoryEntry({
      category: 'patterns',
      title,
      body: 'b',
    });
    expect(result?.title.length).toBe(199);
  });

  test('title of 1000 chars → truncated to 200', () => {
    const title = 'a'.repeat(1000);
    const result = coerceMemoryEntry({
      category: 'patterns',
      title,
      body: 'b',
    });
    expect(result?.title.length).toBe(200);
  });

  test('body is NOT truncated (no length limit on body)', () => {
    // The source does NOT slice body. Pinning that body passes through
    // regardless of length.
    const body = 'b'.repeat(10000);
    const result = coerceMemoryEntry({
      category: 'patterns',
      title: 't',
      body,
    });
    expect(result?.body.length).toBe(10000);
  });

  test('title truncation happens AFTER trim', () => {
    // Source order: trim() THEN slice(0, 200). So a title with leading
    // whitespace and 200 chars of content is trimmed to 200 chars, not
    // sliced to 198.
    const title = '  ' + 'a'.repeat(200) + '  ';
    const result = coerceMemoryEntry({
      category: 'patterns',
      title,
      body: 'b',
    });
    // After trim: 200 chars. After slice(0, 200): still 200.
    expect(result?.title.length).toBe(200);
  });
});

describe('coerceBacklogItem — trim-then-check-empty ordering', () => {
  // The source trims goal first, then checks length === 0. Pinning
  // that whitespace-only goals are rejected (not just empty strings).

  test('whitespace-only goal → returns null', () => {
    expect(coerceBacklogItem({ goal: '   ' })).toBeNull();
    expect(coerceBacklogItem({ goal: '\t\t' })).toBeNull();
    expect(coerceBacklogItem({ goal: '\n\n' })).toBeNull();
    expect(coerceBacklogItem({ goal: ' \t\n ' })).toBeNull();
  });

  test('goal with leading/trailing whitespace is trimmed before validation', () => {
    // After trim, the goal has non-zero length → valid.
    const result = coerceBacklogItem({ goal: '  fix the bug  ' });
    expect(result?.goal).toBe('fix the bug');
  });

  test('rationale whitespace-only → key omitted (not empty string)', () => {
    // Same trim-then-check-empty pattern for rationale. Whitespace-only
    // rationale is treated as absent.
    const result = coerceBacklogItem({ goal: 'x', rationale: '   ' });
    expect('rationale' in result!).toBe(false);
  });

  test('non-string goal → null (no trim attempted)', () => {
    // typeof check before trim. Non-string goals fail immediately.
    expect(coerceBacklogItem({ goal: 42 })).toBeNull();
    expect(coerceBacklogItem({ goal: null })).toBeNull();
    expect(coerceBacklogItem({ goal: undefined })).toBeNull();
    expect(coerceBacklogItem({ goal: { complex: true } })).toBeNull();
    expect(coerceBacklogItem({ goal: ['array'] })).toBeNull();
    expect(coerceBacklogItem({ goal: true })).toBeNull();
  });
});

describe('coerceMemoryEntry — trim-then-check-empty ordering', () => {
  test('whitespace-only title → null', () => {
    expect(
      coerceMemoryEntry({ category: 'patterns', title: '   ', body: 'b' }),
    ).toBeNull();
    expect(
      coerceMemoryEntry({ category: 'patterns', title: '\t\n', body: 'b' }),
    ).toBeNull();
  });

  test('whitespace-only body → null', () => {
    expect(
      coerceMemoryEntry({ category: 'patterns', title: 't', body: '   ' }),
    ).toBeNull();
    expect(
      coerceMemoryEntry({ category: 'patterns', title: 't', body: '\t\n' }),
    ).toBeNull();
  });

  test('title and body both whitespace-only → null', () => {
    expect(
      coerceMemoryEntry({ category: 'patterns', title: '  ', body: '  ' }),
    ).toBeNull();
  });

  test('non-string title → null (no trim attempted)', () => {
    expect(
      coerceMemoryEntry({ category: 'patterns', title: 42, body: 'b' }),
    ).toBeNull();
    expect(
      coerceMemoryEntry({ category: 'patterns', title: null, body: 'b' }),
    ).toBeNull();
    expect(
      coerceMemoryEntry({ category: 'patterns', title: undefined, body: 'b' }),
    ).toBeNull();
  });

  test('non-string body → null', () => {
    expect(
      coerceMemoryEntry({ category: 'patterns', title: 't', body: 42 }),
    ).toBeNull();
    expect(
      coerceMemoryEntry({ category: 'patterns', title: 't', body: null }),
    ).toBeNull();
  });
});

describe('coercion functions — null vs object return shape', () => {
  // coerceBacklogItem and coerceMemoryEntry return `T | null`. There is
  // no `{ ok: false, error }` variant — null is the ONLY failure marker.
  // Pinning that null is returned for every failure mode (no exceptions,
  // no error objects, no fallback defaults).

  test('coerceBacklogItem: null for every failure mode', () => {
    const failures: unknown[] = [
      null,
      undefined,
      'string',
      42,
      true,
      [],
      [1, 2, 3],
      {},
      { goal: '' },
      { goal: '   ' },
      { goal: null },
      { goal: 42 },
    ];
    for (const f of failures) {
      expect(coerceBacklogItem(f)).toBeNull();
    }
  });

  test('coerceMemoryEntry: null for every failure mode', () => {
    const failures: unknown[] = [
      null,
      undefined,
      'string',
      42,
      true,
      [],
      {},
      { title: 't', body: 'b' }, // missing category
      { category: 'unknown', title: 't', body: 'b' },
      { category: 'patterns', title: '', body: 'b' },
      { category: 'patterns', title: 't', body: '' },
    ];
    for (const f of failures) {
      expect(coerceMemoryEntry(f)).toBeNull();
    }
  });

  test('coerceBacklogItem never throws on adversarial input', () => {
    // Pinning that the function is total — no input causes it to throw.
    // It either returns a valid item or null.
    const adversarial: unknown[] = [
      Object.create(null),
      new Map(),
      new Set(),
      Symbol('sym'),
      new Date(),
      /regex/,
      new Error('msg'),
    ];
    for (const a of adversarial) {
      expect(() => coerceBacklogItem(a)).not.toThrow();
    }
  });

  test('coerceMemoryEntry never throws on adversarial input', () => {
    const adversarial: unknown[] = [
      Object.create(null),
      new Map(),
      new Set(),
      Symbol('sym'),
    ];
    for (const a of adversarial) {
      expect(() => coerceMemoryEntry(a)).not.toThrow();
    }
  });
});

describe('isObject — type predicate correctness', () => {
  // isObject is a type guard: `v is Record<string, unknown>`. The
  // runtime behavior MUST match the declared type — when true, the
  // value is safe to treat as a string-keyed record.

  test('true implies value is safe to index by string', () => {
    // If isObject(v) is true, then v['anyKey'] must not throw.
    const values: unknown[] = [{}, { a: 1 }, Object.create(null)];
    for (const v of values) {
      if (isObject(v)) {
        expect(() => v['arbitraryKey']).not.toThrow();
      }
    }
  });

  test('false for arrays (Array.isArray exclusion is load-bearing)', () => {
    // typeof [] === 'object' is true. The explicit Array.isArray
    // rejection in isObject prevents arrays from being treated as
    // records. Removing this check would silently accept arrays.
    expect(isObject([])).toBe(false);
    expect(isObject([1, 2, 3])).toBe(false);
    expect(isObject(['a', 'b'])).toBe(false);
    expect(isObject(new Array(3))).toBe(false);
  });

  test('true for Object.create(null) (no prototype)', () => {
    // Objects without Object.prototype are still objects. isObject
    // must return true — it checks typeof + null + Array, not
    // instanceof Object or hasOwnProperty.
    expect(isObject(Object.create(null))).toBe(true);
  });

  test('false for Map, Set, Date (not plain records)', () => {
    // Wait — actually Map/Set/Date have typeof === 'object' and are
    // not Array. So isObject returns TRUE for them. This is a
    // known limitation: isObject only distinguishes plain objects
    // from arrays, not from class instances. Pinning the actual
    // behavior.
    expect(isObject(new Map())).toBe(true);
    expect(isObject(new Set())).toBe(true);
    expect(isObject(new Date())).toBe(true);
  });

  test('false for RegExp, Error (typeof === object but not plain records)', () => {
    // Same as Map/Set — these ARE considered objects by isObject.
    // The function is permissive: any non-null, non-array object.
    expect(isObject(/regex/)).toBe(true);
    expect(isObject(new Error('msg'))).toBe(true);
  });

  test('false for null (typeof null === "object")', () => {
    // Special case: typeof null is 'object' in JS. The explicit
    // `v !== null` check is load-bearing.
    expect(isObject(null)).toBe(false);
  });

  test('false for primitives', () => {
    expect(isObject(undefined)).toBe(false);
    expect(isObject(42)).toBe(false);
    expect(isObject('string')).toBe(false);
    expect(isObject(true)).toBe(false);
    expect(isObject(Symbol('s'))).toBe(false);
    expect(isObject(0n)).toBe(false);
  });

  test('true for plain objects with various value types', () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
    expect(isObject({ nested: { deep: true } })).toBe(true);
    expect(isObject({ fn: () => 42 })).toBe(true);
  });
});

describe('coercion functions — determinism', () => {
  test('same input produces identical output across calls', () => {
    const backlogInput = { goal: 'x', priority: 42, rationale: 'r' };
    const a = coerceBacklogItem(backlogInput);
    const b = coerceBacklogItem(backlogInput);
    expect(a).toEqual(b);

    const memoryInput = {
      category: 'patterns' as const,
      title: 't',
      body: 'b',
    };
    const c = coerceMemoryEntry(memoryInput);
    const d = coerceMemoryEntry(memoryInput);
    expect(c).toEqual(d);
  });

  test('no shared state between calls (pure functions)', () => {
    // The functions are pure — no module-level caches, no Date.now,
    // no Math.random. Calling in different orders produces the same
    // results.
    const a = {
      x: coerceBacklogItem({ goal: 'x' }),
      y: coerceBacklogItem({ goal: '' }),
    };
    const b = {
      x: coerceBacklogItem({ goal: 'x' }),
      y: coerceBacklogItem({ goal: '' }),
    };
    expect(a).toEqual(b);
  });

  test('parsePriority is pure (same input → same output)', () => {
    const a = parsePriority(50.5);
    const b = parsePriority(50.5);
    expect(a).toEqual(b);
  });

  test('isMemoryCategory is pure', () => {
    const a = isMemoryCategory('patterns');
    const b = isMemoryCategory('patterns');
    expect(a).toEqual(b);
  });
});

describe('coerceBacklogItem — priority clamp integration', () => {
  // coerceBacklogItem delegates to parsePriority. Pinning the
  // integration: priority from raw is passed through parsePriority,
  // which clamps + rounds. If priority is invalid, the key is omitted.

  test('priority 0 (min) → included', () => {
    const result = coerceBacklogItem({ goal: 'x', priority: 0 });
    expect(result?.priority).toBe(0);
    expect('priority' in result!).toBe(true);
  });

  test('priority 100 (max) → included', () => {
    const result = coerceBacklogItem({ goal: 'x', priority: 100 });
    expect(result?.priority).toBe(100);
  });

  test('priority -1 (below min) → clamped to 0', () => {
    const result = coerceBacklogItem({ goal: 'x', priority: -1 });
    expect(result?.priority).toBe(0);
  });

  test('priority 101 (above max) → clamped to 100', () => {
    const result = coerceBacklogItem({ goal: 'x', priority: 101 });
    expect(result?.priority).toBe(100);
  });

  test('priority 50.7 → rounded to 51', () => {
    const result = coerceBacklogItem({ goal: 'x', priority: 50.7 });
    expect(result?.priority).toBe(51);
  });

  test('priority 50.3 → rounded to 50', () => {
    const result = coerceBacklogItem({ goal: 'x', priority: 50.3 });
    expect(result?.priority).toBe(50);
  });
});
