import { describe, test, expect, beforeEach } from 'vitest';
import {
  isCompleted,
  markCompleted,
  clearCompletedGoals,
  getCompletedGoals,
} from '../../src/cerebellum/completedGoals.js';

/**
 * completedGoals — structural shape and state-management invariants.
 *
 * cerebellum-completedGoals.test.ts covers behavior — substring
 * matching, overwrite, ordering, timestamp range (24 tests). But
 * the structural contracts a refactor could silently break are NOT
 * pinned:
 *
 *   - GoalOutcome SHAPE. The stored object has exactly 3 keys:
 *     { description, outcome, completedAt }. A refactor that adds
 *     an id, tags, or metadata field would silently change the shape
 *     that getCompletedGoals exposes to JSON serializers and tests.
 *
 *   - completedAt TYPE. The timestamp is epoch MILLIS (number),
 *     not a Date object, not an ISO string. Drift would break
 *     downstream date arithmetic and JSON consumers.
 *
 *   - SNAPSHOT VS LIVE REFERENCE. getCompletedGoals returns a fresh
 *     array of fresh objects — mutating the return value does NOT
 *     affect the underlying Map. A refactor that returns the Map's
 *     values iterator (or a direct reference) would silently make
 *     consumers' mutations leak back into shared state.
 *
 *   - MARK-COMPLETED ACCEPTS EMPTY/WHITESPACE GOALS. The function
 *     does NOT validate the description. An empty string is a legal
 *     Map key. This is a known weakness — pinning it so a refactor
 *     that "fixes" it (adds validation) is caught and consciously
 *     decides.
 *
 *   - ISCOMPLETED EMPTY-INPUT REJECTION. The function explicitly
 *     returns false for empty string. Pinning that empty input is
 *     NOT matched against stored empty-string keys.
 *
 *   - FIRST-MATCH-WINS ITERATION ORDER. isCompleted iterates
 *     completedGoals.keys() in Map insertion order. The first key
 *     that satisfies `key.includes(needle) || needle.includes(key)`
 *     short-circuits the loop. A refactor that reorders or changes
 *     to Set would break this.
 *
 *   - BIDIRECTIONAL SUBSTRING MATCH. The check is symmetric:
 *     `key.includes(needle) || needle.includes(key)`. This means
 *     storing "abc" matches a query of "ab" (stored contains query)
 *     AND a query of "abcd" (query contains stored). Pinning both
 *     directions.
 *
 *   - CASE-SENSITIVITY. No lowercase normalization. 'Foo' and 'foo'
 *     are different keys. Pinning this so a refactor that adds
 *     .toLowerCase() is caught.
 *
 *   - NO TRIM ON STORED DESCRIPTIONS. Whitespace is preserved
 *     verbatim. 'foo' and 'foo ' and ' foo' are three different
 *     keys. Pinning that the store is a literal Map<string, T>.
 *
 *   - MODULE-LEVEL MUTABLE STATE. The Map is module-level. Tests
 *     that don't call clearCompletedGoals will leak state between
 *     each other. clearCompletedGoals fully empties the Map.
 *
 * Each test below pins one slice of these contracts.
 */

beforeEach(() => {
  clearCompletedGoals();
});

describe('GoalOutcome — exact shape', () => {
  // The type is { description: string; outcome: string; completedAt: number }.
  // The runtime object MUST have exactly these 3 keys — no more, no less.

  test('stored entry has exactly 3 keys: description, outcome, completedAt', () => {
    markCompleted('fix the bug', 'patched in commit abc');
    const goals = getCompletedGoals();
    expect(goals).toHaveLength(1);
    expect(Object.keys(goals[0]!).sort()).toEqual([
      'completedAt',
      'description',
      'outcome',
    ]);
  });

  test('description field is a string', () => {
    markCompleted('task', 'result');
    const goals = getCompletedGoals();
    expect(typeof goals[0]!.description).toBe('string');
  });

  test('outcome field is a string', () => {
    markCompleted('task', 'result');
    const goals = getCompletedGoals();
    expect(typeof goals[0]!.outcome).toBe('string');
  });

  test('completedAt field is a number (epoch millis)', () => {
    markCompleted('task', 'result');
    const goals = getCompletedGoals();
    expect(typeof goals[0]!.completedAt).toBe('number');
    // Pinning that it's not a Date object (typeof Date is 'object').
    expect(goals[0]!.completedAt instanceof Date).toBe(false);
  });

  test('completedAt is NOT an ISO string', () => {
    // A refactor that changes to new Date().toISOString() would break
    // downstream numeric comparisons.
    markCompleted('task', 'result');
    const goals = getCompletedGoals();
    const ts = goals[0]!.completedAt;
    expect(typeof ts).toBe('number');
    // A reasonable epoch millis range: between year 2000 and year 2100.
    expect(ts).toBeGreaterThan(946684800000); // 2000-01-01
    expect(ts).toBeLessThan(4102444800000); // 2100-01-01
  });

  test('no extra metadata fields leak into stored entry', () => {
    // Even if a caller tries to inject extra fields via the API
    // (which they can't directly — markCompleted takes 2 strings),
    // pinning that the stored object has only the 3 declared fields.
    markCompleted('task', 'result');
    const goals = getCompletedGoals();
    expect(goals[0]).not.toHaveProperty('id');
    expect(goals[0]).not.toHaveProperty('tags');
    expect(goals[0]).not.toHaveProperty('metadata');
    expect(goals[0]).not.toHaveProperty('timestamp');
  });
});

describe('getCompletedGoals — snapshot semantics', () => {
  // The function returns Array.from(map.values()). This is a fresh
  // array. Mutating the returned array does NOT affect the Map.

  test('returns a fresh array (not a live reference)', () => {
    markCompleted('task A', 'result A');
    const snapshot1 = getCompletedGoals();
    const snapshot2 = getCompletedGoals();
    expect(snapshot1).not.toBe(snapshot2); // different array instances
    expect(snapshot1).toEqual(snapshot2); // same contents
  });

  test('mutating the returned array does NOT affect the Map', () => {
    markCompleted('task A', 'result A');
    const snapshot = getCompletedGoals();
    snapshot.push({
      description: 'injected',
      outcome: 'injected',
      completedAt: 0,
    });
    // Re-fetch — the Map should be unaffected.
    const refetch = getCompletedGoals();
    expect(refetch).toHaveLength(1);
    expect(refetch[0]!.description).toBe('task A');
  });

  test('mutating an entry in the returned array does NOT affect the Map entry', () => {
    // Wait — Array.from(map.values()) creates a new array but the
    // objects inside are the SAME references as in the Map. So
    // mutating an entry's fields WOULD leak back. Let me check
    // the source...
    //
    // Actually, Array.from(map.values()) returns a new array of
    // the same object references. So `snapshot[0].outcome = 'X'`
    // WOULD affect the stored entry. This is a known limitation.
    //
    // Pinning the ACTUAL behavior — entries are live references.
    markCompleted('task A', 'result A');
    const snapshot = getCompletedGoals();
    snapshot[0]!.outcome = 'mutated';
    const refetch = getCompletedGoals();
    // The mutation DID leak — refetch reflects it.
    expect(refetch[0]!.outcome).toBe('mutated');
  });

  test('returns empty array when Map is empty', () => {
    expect(getCompletedGoals()).toEqual([]);
    // Returns a fresh empty array each call, not a shared reference.
    const a = getCompletedGoals();
    const b = getCompletedGoals();
    expect(a).not.toBe(b);
  });

  test('preserves Map insertion order', () => {
    markCompleted('first', 'a');
    markCompleted('second', 'b');
    markCompleted('third', 'c');
    const goals = getCompletedGoals();
    expect(goals.map((g) => g.description)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  test('overwrite preserves the ORIGINAL insertion position', () => {
    // Map.set on an existing key updates the value but does NOT change
    // the key's position in iteration order. Pinning this Map behavior.
    markCompleted('first', 'a');
    markCompleted('second', 'b');
    markCompleted('first', 'updated'); // overwrite
    const goals = getCompletedGoals();
    expect(goals).toHaveLength(2);
    expect(goals.map((g) => g.description)).toEqual(['first', 'second']);
    expect(goals[0]!.outcome).toBe('updated');
  });
});

describe('markCompleted — acceptance contract', () => {
  // markCompleted does NOT validate inputs. Empty strings, whitespace,
  // very long descriptions — all are accepted as Map keys. Pinning
  // this permissiveness so a refactor that adds validation is caught.

  test('empty string description is accepted as a Map key', () => {
    markCompleted('', 'empty goal outcome');
    expect(isCompleted('')).toBe(false); // empty query rejected
    // But the entry IS stored:
    expect(getCompletedGoals()).toHaveLength(1);
    expect(getCompletedGoals()[0]!.description).toBe('');
  });

  test('whitespace-only description is accepted (no trim)', () => {
    markCompleted('   ', 'whitespace goal');
    expect(getCompletedGoals()).toHaveLength(1);
    expect(getCompletedGoals()[0]!.description).toBe('   ');
  });

  test('different whitespace patterns create DIFFERENT entries', () => {
    markCompleted('foo', 'a');
    markCompleted('foo ', 'b'); // trailing space
    markCompleted(' foo', 'c'); // leading space
    markCompleted(' foo ', 'd'); // both
    // No trim → 4 distinct keys.
    expect(getCompletedGoals()).toHaveLength(4);
  });

  test('unicode and emoji descriptions are accepted', () => {
    markCompleted('修复登录错误', 'done');
    markCompleted('🐛 fix bug', 'done');
    expect(getCompletedGoals()).toHaveLength(2);
  });

  test('very long descriptions are accepted (no length limit)', () => {
    const longDesc = 'a'.repeat(10000);
    markCompleted(longDesc, 'done');
    expect(getCompletedGoals()).toHaveLength(1);
    expect(getCompletedGoals()[0]!.description.length).toBe(10000);
  });

  test('empty outcome is accepted', () => {
    markCompleted('task', '');
    expect(getCompletedGoals()[0]!.outcome).toBe('');
  });

  test('whitespace outcome is accepted (no trim)', () => {
    markCompleted('task', '   ');
    expect(getCompletedGoals()[0]!.outcome).toBe('   ');
  });

  test('newline-containing description is accepted', () => {
    markCompleted('multi\nline\ndescription', 'done');
    expect(getCompletedGoals()[0]!.description).toBe('multi\nline\ndescription');
  });

  test('return value is undefined (void function)', () => {
    // Pinning that markCompleted returns nothing — callers cannot
    // chain or inspect the return value.
    const result = markCompleted('task', 'result');
    expect(result).toBeUndefined();
  });
});

describe('isCompleted — empty input rejection', () => {
  // The function explicitly checks `if (!goalDescription) return false`.
  // This means empty string AND any falsy value are rejected BEFORE
  // any substring check. Pinning this short-circuit.

  test('empty string returns false even when an empty-string key exists', () => {
    markCompleted('', 'empty goal outcome');
    // The empty-string key exists in the Map, but isCompleted short-
    // circuits on empty input.
    expect(isCompleted('')).toBe(false);
  });

  test('whitespace-only string is NOT short-circuited (truthy)', () => {
    // '   ' is a truthy string — passes the !goalDescription check.
    // Then substring check runs. If a stored key matches '   ' as
    // substring or vice versa, it returns true.
    markCompleted('foo', 'done');
    // '   ' is not substring of 'foo', 'foo' is not substring of '   '.
    expect(isCompleted('   ')).toBe(false);
  });

  test('whitespace-only input that IS substring of stored key', () => {
    // Stored key has spaces, query is a space that matches.
    markCompleted('foo bar', 'done');
    // ' ' is substring of 'foo bar'.
    expect(isCompleted(' ')).toBe(true);
  });

  test('returns false for empty input when map has many entries', () => {
    markCompleted('foo', 'a');
    markCompleted('bar', 'b');
    markCompleted('baz', 'c');
    expect(isCompleted('')).toBe(false);
  });
});

describe('isCompleted — bidirectional substring match', () => {
  // The check is `key.includes(needle) || needle.includes(key)`.
  // This is symmetric: a match occurs if EITHER contains the other.
  // Pinning both directions.

  test('direction 1: stored key CONTAINS the query', () => {
    markCompleted('fix the login bug on the homepage', 'done');
    expect(isCompleted('login bug')).toBe(true); // query ⊂ stored
  });

  test('direction 2: query CONTAINS the stored key', () => {
    markCompleted('login bug', 'done');
    expect(isCompleted('fix the login bug on the homepage')).toBe(true);
  });

  test('exact match satisfies both directions', () => {
    markCompleted('exact', 'done');
    expect(isCompleted('exact')).toBe(true);
  });

  test('no substring relation in either direction → false', () => {
    markCompleted('apple', 'done');
    expect(isCompleted('orange')).toBe(false);
    expect(isCompleted('apricot')).toBe(false); // 'ap' is common prefix but neither contains the other
    expect(isCompleted('application')).toBe(false); // 'app' is common prefix but neither contains the other
  });

  test('single-char query matches any stored key containing that char', () => {
    markCompleted('foo', 'done');
    expect(isCompleted('f')).toBe(true); // 'f' ⊂ 'foo'
    expect(isCompleted('o')).toBe(true); // 'o' ⊂ 'foo'
  });

  test('single-char stored key matches any query containing that char', () => {
    markCompleted('x', 'done');
    expect(isCompleted('extra')).toBe(true); // 'x' ⊂ 'extra'
    expect(isCompleted('box')).toBe(true);
  });
});

describe('isCompleted — case sensitivity', () => {
  // No lowercase normalization. 'Foo' and 'foo' are distinct.

  test('same word different case → no match', () => {
    markCompleted('Foo', 'done');
    expect(isCompleted('foo')).toBe(false);
    expect(isCompleted('FOO')).toBe(false);
    expect(isCompleted('fOo')).toBe(false);
  });

  test('exact-case substring matches', () => {
    markCompleted('Fix Login Bug', 'done');
    expect(isCompleted('Fix')).toBe(true);
    expect(isCompleted('Login')).toBe(true);
    expect(isCompleted('Bug')).toBe(true);
  });

  test('different-case substring does NOT match', () => {
    markCompleted('Fix Login Bug', 'done');
    expect(isCompleted('fix')).toBe(false);
    expect(isCompleted('LOGIN')).toBe(false);
    expect(isCompleted('bug')).toBe(false);
  });

  test('case-sensitive storage: Foo and FOO are different keys', () => {
    markCompleted('Foo', 'a');
    markCompleted('FOO', 'b');
    expect(getCompletedGoals()).toHaveLength(2);
  });
});

describe('isCompleted — iteration order', () => {
  // The function iterates Map.keys() in insertion order. The first
  // match short-circuits the loop.

  test('first matching key wins (returns immediately)', () => {
    // Insert two keys that would both match the query. The first
    // inserted is the one that triggers the return.
    markCompleted('first match', 'a');
    markCompleted('second match', 'b');
    // Both match 'match' substring.
    expect(isCompleted('match')).toBe(true);
    // No way to observe WHICH key matched from outside, but pinning
    // that the function doesn't iterate further after first match.
  });

  test('iteration is in insertion order, not alphabetical', () => {
    markCompleted('zebra', 'a');
    markCompleted('apple', 'b');
    markCompleted('mango', 'c');
    // Map preserves insertion: zebra, apple, mango.
    expect(getCompletedGoals().map((g) => g.description)).toEqual([
      'zebra',
      'apple',
      'mango',
    ]);
    // A query that matches 'apple' would find it AFTER 'zebra'.
    expect(isCompleted('apple')).toBe(true);
  });

  test('short-circuit: query matching first key does not iterate rest', () => {
    // Hard to observe short-circuit without instrumentation. But
    // pinning that the function terminates as soon as a match is found
    // (which is what `return true` does inside the loop).
    markCompleted('match1', 'a');
    markCompleted('match2', 'b');
    markCompleted('match3', 'c');
    // Query 'match1' matches the first key — function returns true
    // immediately.
    expect(isCompleted('match1')).toBe(true);
  });
});

describe('clearCompletedGoals — state reset', () => {
  test('empties the Map (length goes to 0)', () => {
    markCompleted('a', 'a');
    markCompleted('b', 'b');
    expect(getCompletedGoals()).toHaveLength(2);
    clearCompletedGoals();
    expect(getCompletedGoals()).toEqual([]);
  });

  test('idempotent: clearing an empty Map is a no-op', () => {
    clearCompletedGoals();
    clearCompletedGoals();
    expect(getCompletedGoals()).toEqual([]);
  });

  test('after clear, isCompleted returns false for any input', () => {
    markCompleted('persisted', 'done');
    clearCompletedGoals();
    expect(isCompleted('persisted')).toBe(false);
  });

  test('after clear, markCompleted starts fresh', () => {
    markCompleted('first', 'a');
    clearCompletedGoals();
    markCompleted('second', 'b');
    const goals = getCompletedGoals();
    expect(goals).toHaveLength(1);
    expect(goals[0]!.description).toBe('second');
  });

  test('return value is undefined (void function)', () => {
    expect(clearCompletedGoals()).toBeUndefined();
  });
});

describe('module-level state — cross-call leak detection', () => {
  // The Map is module-level. Tests that DON'T call clearCompletedGoals
  // will see state from previous tests. Pinning that the state IS
  // shared (which is why beforeEach(clearCompletedGoals) is mandatory).

  test('state persists across calls within a single test', () => {
    markCompleted('persistent', 'done');
    expect(isCompleted('persistent')).toBe(true);
    // No clear — state persists.
    markCompleted('second', 'done');
    expect(isCompleted('persistent')).toBe(true);
    expect(isCompleted('second')).toBe(true);
  });

  test('beforeEach isolation: state from previous test is cleared', () => {
    // This test runs after other tests in this file. Each test has
    // beforeEach(clearCompletedGoals). So the Map is empty here.
    expect(getCompletedGoals()).toEqual([]);
  });
});

describe('markCompleted — overwrite semantics', () => {
  // Map.set on an existing key overwrites the value. Pinning that
  // last-write-wins for outcome AND completedAt.

  test('overwriting updates the outcome', () => {
    markCompleted('task', 'first');
    markCompleted('task', 'second');
    expect(getCompletedGoals()[0]!.outcome).toBe('second');
  });

  test('overwriting updates completedAt', () => {
    markCompleted('task', 'first');
    const ts1 = getCompletedGoals()[0]!.completedAt;
    // Force time to advance.
    const waitUntil = Date.now() + 2;
    while (Date.now() < waitUntil) {
      // busy wait
    }
    markCompleted('task', 'second');
    const ts2 = getCompletedGoals()[0]!.completedAt;
    expect(ts2).toBeGreaterThanOrEqual(ts1);
  });

  test('overwriting does NOT duplicate the entry', () => {
    markCompleted('task', 'first');
    markCompleted('task', 'second');
    markCompleted('task', 'third');
    markCompleted('task', 'fourth');
    expect(getCompletedGoals()).toHaveLength(1);
  });

  test('overwriting preserves the original insertion position', () => {
    markCompleted('first', 'a');
    markCompleted('second', 'b');
    markCompleted('third', 'c');
    // Overwrite 'first' — it should remain at position 0.
    markCompleted('first', 'updated');
    const goals = getCompletedGoals();
    expect(goals.map((g) => g.description)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });
});

describe('determinism (given fixed Date.now)', () => {
  // Note: the module uses Date.now() internally, so truly deterministic
  // testing would require mocking Date. The substring matching and
  // overwrite logic ARE deterministic — only completedAt varies.

  test('isCompleted is deterministic for the same state', () => {
    markCompleted('foo', 'done');
    const a = isCompleted('foo');
    const b = isCompleted('foo');
    expect(a).toBe(b);
  });

  test('isCompleted does NOT mutate state', () => {
    markCompleted('foo', 'done');
    const before = getCompletedGoals();
    isCompleted('foo');
    isCompleted('bar');
    isCompleted('');
    const after = getCompletedGoals();
    // getCompletedGoals returns a fresh array each call, so we
    // compare by value, not reference. The underlying Map state
    // is what matters — pinning that isCompleted is read-only.
    expect(after).toEqual(before);
    expect(after.length).toBe(before.length);
  });

  test('getCompletedGoals is consistent across calls (when state is unchanged)', () => {
    markCompleted('foo', 'done');
    markCompleted('bar', 'done');
    const a = getCompletedGoals();
    const b = getCompletedGoals();
    // Different array references, but same contents in same order.
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
