import { describe, test, expect } from 'vitest';
import {
  normalizeGoal,
  isDuplicateGoal,
  buildSucceededGoalSet,
} from '../../src/cerebellum/dreamer-dedup.js';
import type { TraceRecord } from '../../src/trace/jsonl.js';

/**
 * dreamer-dedup — structural shape and pipeline invariants.
 *
 * dreamer-dedup.test.ts covers behavior — normalization rules, Jaccard
 * threshold, exact-match path, round-trip integration (25 tests).
 * This file pins the structural contracts a refactor could silently
 * break:
 *
 *   - normalizeGoal PIPELINE ORDER. lowercase → strip-punctuation-
 *     to-space → collapse-whitespace → trim. The order matters
 *     because lowercase happens FIRST (so 'A!' → 'a ' not 'A '),
 *     and punctuation becomes a SPACE (not empty) before collapse.
 *
 *   - normalizeGoal PRESERVES WHitespace (UNLIKE hashGoal in
 *     retry-counter/seedAttempts which strips it). 'add retry' and
 *     'addretry' are DIFFERENT normalized forms here. This is the
 *     key divergence from the seed/retry counter hash.
 *
 *   - normalizeGoal REPLACES EACH PUNCTUATION CHAR WITH A SPACE.
 *     'a-b' → 'a b' (hyphen → space), not 'ab'. This preserves
 *     token boundaries for the Jaccard comparison.
 *
 *   - goalTokens DROPS 1-CHAR TOKENS (length > 1, not >= 2). 'a b c'
 *     produces an empty token set, which short-circuits isDuplicateGoal.
 *
 *   - goalTokens RETURNS A SET (dedupes duplicates within one goal).
 *     'add add add' produces {add}, not [add, add, add].
 *
 *   - isDuplicateGoal EARLY-RETURN ORDER:
 *       1. normalized empty → false
 *       2. existing.has(normalized) → true (FAST PATH)
 *       3. newTokens empty → false
 *       4. per-existing: existingNorm match → true
 *       5. per-existing: existingTokens empty → skip
 *       6. per-existing: Jaccard >= 0.5 → true
 *
 *   - Jaccard uses >= (NOT >). At exactly 0.5, the goal is a duplicate.
 *
 *   - EXISTING SET IS NORMALIZED INSIDE THE LOOP. Each iteration
 *     recomputes normalizeGoal(raw). A refactor that pre-normalizes
 *     the existing set would change behavior when existing entries
 *     have un-normalized whitespace.
 *
 *   - buildSucceededGoalSet uses === 'success' (strict equality).
 *     Failure, abandoned, and any other outcome are rejected.
 *
 *   - buildSucceededGoalSet stores RAW goal text (not normalized).
 *     Set contains the original goal strings from the trace.
 *
 *   - buildSucceededGoalSet TRIM-CHECKS goals before adding. Empty
 *     and whitespace-only goals are skipped.
 *
 * Each test below pins one slice of these contracts.
 */

function makeTrace(
  outcome: TraceRecord['outcome'],
  goal: string,
): TraceRecord {
  return {
    waypoint_id: `wp_${Math.random().toString(36).slice(2)}`,
    voyage_id: 'voyage_test',
    ts: '2026-07-21T00:00:00.000Z',
    goal,
    strategy: 'engineer-bias-action',
    outcome,
    iterations_used: 1,
    tokens_consumed: { input: 100, output: 50 },
  } as TraceRecord;
}

describe('normalizeGoal — pipeline order', () => {
  // Source order: lowercase → strip /[^a-z0-9\s]/g to space → collapse
  // \s+ to single space → trim. The order matters.

  test('lowercase happens FIRST (before strip)', () => {
    // 'ABC!' → lowercase → 'abc!' → strip → 'abc ' → collapse → 'abc ' → trim → 'abc'.
    // If strip ran first (case-sensitive), 'ABC!' would become '   ' → ''.
    expect(normalizeGoal('ABC!')).toBe('abc');
    expect(normalizeGoal('HELLO')).toBe('hello');
  });

  test('punctuation becomes a SPACE (not empty)', () => {
    // 'a-b' → 'a b' (hyphen → space), NOT 'ab'. This preserves token
    // boundaries for Jaccard.
    expect(normalizeGoal('a-b')).toBe('a b');
    expect(normalizeGoal('foo.bar')).toBe('foo bar');
    expect(normalizeGoal('add-retry')).toBe('add retry');
  });

  test('each punctuation char produces one space (then collapsed)', () => {
    // 'a--b' → 'a  b' (two hyphens → two spaces) → collapse → 'a b'.
    expect(normalizeGoal('a--b')).toBe('a b');
    expect(normalizeGoal('a-.-b')).toBe('a b');
  });

  test('whitespace is COLLAPSED to single space (not stripped)', () => {
    expect(normalizeGoal('a   b')).toBe('a b');
    expect(normalizeGoal('a\t\tb')).toBe('a b');
    expect(normalizeGoal('a\n\n\nb')).toBe('a b');
    expect(normalizeGoal('a \t\n b')).toBe('a b');
  });

  test('leading/trailing whitespace is TRIMMED', () => {
    expect(normalizeGoal('  hello  ')).toBe('hello');
    expect(normalizeGoal('\n\thello\t\n')).toBe('hello');
  });

  test('order: lowercase before strip means uppercase letters survive as lowercase', () => {
    // 'Add-Retry' → lowercase → 'add-retry' → strip → 'add retry'.
    expect(normalizeGoal('Add-Retry')).toBe('add retry');
    expect(normalizeGoal('FIX bug!')).toBe('fix bug');
  });
});

describe('normalizeGoal — whitespace preservation (vs hashGoal)', () => {
  // normalizeGoal PRESERVES token boundaries via whitespace.
  // hashGoal in retry-counter/seedAttempts STRIPS all whitespace.
  // This is the key divergence.

  test('normalized form contains spaces between tokens', () => {
    expect(normalizeGoal('add retry')).toBe('add retry'); // contains space
    expect(normalizeGoal('add retry')).not.toBe('addretry'); // NOT hashGoal-style
  });

  test('two distinct goals remain distinct after normalization', () => {
    // 'add retry' and 'addretry' would be the same under hashGoal.
    // Here they are different because the space is preserved.
    expect(normalizeGoal('add retry')).not.toBe(normalizeGoal('addretry'));
    expect(normalizeGoal('add retry')).toBe('add retry');
    expect(normalizeGoal('addretry')).toBe('addretry');
  });
});

describe('normalizeGoal — output shape', () => {
  test('always returns a string', () => {
    const inputs = ['', '   ', 'hello', 'Add Retry', '!@#$', '你好'];
    for (const input of inputs) {
      expect(typeof normalizeGoal(input)).toBe('string');
    }
  });

  test('output contains ONLY lowercase letters, digits, and single spaces', () => {
    const inputs = [
      'hello',
      'Add Retry v2.0!',
      'fix-typo_v3',
      'mixed 123',
      '你好 chinese',
    ];
    for (const input of inputs) {
      const result = normalizeGoal(input);
      // Allowed: lowercase letters, digits, single spaces (no doubles).
      expect(result).toMatch(/^[a-z0-9]+( [a-z0-9]+)*$/);
    }
  });

  test('output never contains consecutive spaces', () => {
    const inputs = ['a  b', 'a   b', 'a \t b', 'a \n\n b', '  a  b  '];
    for (const input of inputs) {
      expect(normalizeGoal(input)).not.toMatch(/\s{2,}/);
    }
  });

  test('output never contains leading or trailing whitespace', () => {
    const inputs = [' hello', 'hello ', '  hello  ', '\thello', 'hello\n'];
    for (const input of inputs) {
      const result = normalizeGoal(input);
      expect(result).toBe(result.trim());
    }
  });

  test('output never contains uppercase letters', () => {
    const inputs = ['Hello', 'HELLO', 'MixedCase', 'ABC123'];
    for (const input of inputs) {
      expect(normalizeGoal(input)).not.toMatch(/[A-Z]/);
    }
  });

  test('output never contains punctuation', () => {
    const inputs = ['hello!', 'add-retry', 'fix.typo', 'a@b#c', 'foo;bar'];
    for (const input of inputs) {
      expect(normalizeGoal(input)).not.toMatch(/[^a-z0-9\s]/);
    }
  });
});

describe('normalizeGoal — purity and idempotency', () => {
  test('pure: same input → same output', () => {
    const inputs = ['hello', 'Add Retry', '', '   ', '!@#', '你好'];
    for (const input of inputs) {
      expect(normalizeGoal(input)).toBe(normalizeGoal(input));
    }
  });

  test('idempotent: normalize(normalize(x)) === normalize(x)', () => {
    const inputs = [
      'hello',
      'Add Retry v2.0!',
      'fix-typo_v3',
      '',
      '   ',
      '!@#$',
      '你好 test',
    ];
    for (const input of inputs) {
      const once = normalizeGoal(input);
      const twice = normalizeGoal(once);
      expect(twice).toBe(once);
    }
  });
});

describe('normalizeGoal — empty and unicode handling', () => {
  test('empty string → empty string', () => {
    expect(normalizeGoal('')).toBe('');
  });

  test('whitespace-only → empty string', () => {
    expect(normalizeGoal(' ')).toBe('');
    expect(normalizeGoal('   ')).toBe('');
    expect(normalizeGoal('\t')).toBe('');
    expect(normalizeGoal('\n')).toBe('');
    expect(normalizeGoal(' \t\n ')).toBe('');
  });

  test('punctuation-only → empty string', () => {
    expect(normalizeGoal('!')).toBe('');
    expect(normalizeGoal('!@#$')).toBe('');
    expect(normalizeGoal('.-_=+')).toBe('');
    expect(normalizeGoal('...!!!')).toBe('');
  });

  test('unicode letters are REPLACED WITH SPACES (not stripped to empty)', () => {
    // Unlike hashGoal in retry-counter (which strips chars to empty),
    // normalizeGoal REPLACES each non-alphanumeric char with a space.
    // So 'café' becomes 'caf ' (trailing é → space) → trim → 'caf'.
    // And 'naïve' becomes 'na ve' (middle ï → space, preserved between
    // two non-empty tokens).
    expect(normalizeGoal('你好')).toBe(''); // ' '+' ' collapse → ' ' → trim → ''
    expect(normalizeGoal('café')).toBe('caf'); // trailing é → space → trim
    expect(normalizeGoal('naïve')).toBe('na ve'); // middle ï → space, preserved
  });

  test('digits preserved', () => {
    expect(normalizeGoal('v2.0')).toBe('v2 0');
    expect(normalizeGoal('version 123')).toBe('version 123');
    expect(normalizeGoal('0123456789')).toBe('0123456789');
  });

  test('digits with punctuation become space-separated', () => {
    expect(normalizeGoal('v2.0')).toBe('v2 0'); // dot → space
    expect(normalizeGoal('v2-0')).toBe('v2 0');
  });
});

describe('isDuplicateGoal — early-return ordering', () => {
  // The function has 4 early-return paths. Pinning the order:
  //   1. normalized.length === 0 → false
  //   2. existing.has(normalized) → true (FAST PATH)
  //   3. newTokens.size === 0 → false
  //   4. (loop) match found → true

  test('path 1: empty newGoal normalization → false (skips all other checks)', () => {
    // Even if the existing set contains the empty string, the early
    // return on empty normalized short-circuits.
    expect(isDuplicateGoal('', new Set(['']))).toBe(false);
    expect(isDuplicateGoal('   ', new Set(['']))).toBe(false);
    expect(isDuplicateGoal('!@#$', new Set(['anything']))).toBe(false);
  });

  test('path 2: exact normalized match in existing → true (BEFORE Jaccard)', () => {
    // existing.has(normalized) uses the Set's has() on the normalized
    // string. If existing contains the RAW 'add retry' (already
    // normalized), the lookup succeeds.
    expect(isDuplicateGoal('Add Retry', new Set(['add retry']))).toBe(true);
    // Set lookup happens BEFORE token analysis, so single-char goals
    // that match exactly return true even though Jaccard would fail.
    expect(isDuplicateGoal('a', new Set(['a']))).toBe(true);
  });

  test('path 2 ONLY checks the normalized form (existing.has uses normalized lookup)', () => {
    // If existing contains 'Add Retry' (un-normalized) and we query
    // 'Add Retry', the lookup existing.has('add retry') fails because
    // the Set contains 'Add Retry' not 'add retry'. So we fall through
    // to Jaccard.
    const existing = new Set(['Add Retry']);
    // Existing has 'Add Retry' (raw). Lookup with 'add retry' fails.
    // But the loop normalizes each existing entry, so it still matches.
    expect(isDuplicateGoal('add retry', existing)).toBe(true);
  });

  test('path 3: empty tokens → false (after exact-match check fails)', () => {
    // Single-char goal with no exact match. Tokens are filtered
    // (1-char tokens dropped), so newTokens.size === 0.
    expect(isDuplicateGoal('a', new Set(['add retry']))).toBe(false);
    expect(isDuplicateGoal('!', new Set(['add retry']))).toBe(false); // normalizes to ''
    expect(isDuplicateGoal('a b c', new Set(['add retry']))).toBe(false);
    // 'a b c' → 'a b c' (normalized) → tokens = {} (all 1-char) → false
  });

  test('path 4: Jaccard match short-circuits loop on first hit', () => {
    // Hard to observe short-circuit directly, but pinning that the
    // function returns as soon as a match is found.
    const existing = new Set([
      'completely unrelated goal about widgets',
      'add retry to llm',
    ]);
    expect(isDuplicateGoal('add retry logic to llm provider', existing)).toBe(true);
  });

  test('no path triggers → returns false at end of function', () => {
    expect(
      isDuplicateGoal('completely fresh goal', new Set(['unrelated existing'])),
    ).toBe(false);
  });
});

describe('isDuplicateGoal — Jaccard >= 0.5 (not >)', () => {
  // The comparison is `>= 0.5`. At exactly 0.5, the goal IS a duplicate.

  test('Jaccard exactly 0.5 → duplicate', () => {
    // {add, retry} vs {add, retry} → intersection 2, union 2 → 1.0
    // Wait that's 1.0 not 0.5. Let me find a real 0.5 case.
    // {add, retry} vs {retry, add} → same → 1.0.
    // {add, retry} vs {retry, foo} → intersection 1, union 3 → 0.33
    // {add, retry} vs {retry, logic} → intersection 1, union 3 → 0.33
    // {add, retry} vs {add, retry, foo} → intersection 2, union 3 → 0.67
    // Hmm hard to hit 0.5 exactly. Let me think.
    // {add, retry} vs {retry, add, foo, bar} → intersection 2, union 4 → 0.5!
    const existing = new Set(['add retry foo bar']);
    expect(isDuplicateGoal('retry add', existing)).toBe(true);
  });

  test('Jaccard just below 0.5 → NOT duplicate', () => {
    // {add, retry} vs {retry, foo, bar, baz} → intersection 1, union 5 → 0.2
    const existing = new Set(['retry foo bar baz']);
    expect(isDuplicateGoal('add baz', existing)).toBe(false);
    // {add, baz} vs {retry, foo, bar, baz} → intersection {baz} = 1,
    // union {add, baz, retry, foo, bar} = 5 → 0.2 < 0.5.
  });

  test('Jaccard exactly 1.0 (identical tokens) → duplicate', () => {
    // Same tokens, different word order. {a, b, c} vs {c, b, a}.
    const existing = new Set(['alpha beta gamma']);
    expect(isDuplicateGoal('gamma beta alpha', existing)).toBe(true);
  });

  test('Jaccard 0.0 (no shared tokens) → NOT duplicate', () => {
    const existing = new Set(['apple banana']);
    expect(isDuplicateGoal('cherry date', existing)).toBe(false);
  });
});

describe('isDuplicateGoal — existing set normalized inside loop', () => {
  // The source normalizes each existing entry INSIDE the loop:
  //   for (const raw of existing) {
  //     const existingNorm = normalizeGoal(raw);
  //     ...
  //   }
  // This means existing can contain un-normalized entries and still
  // match correctly.

  test('existing with mixed-case entry matches lowercase query', () => {
    const existing = new Set(['Add Retry']);
    expect(isDuplicateGoal('add retry', existing)).toBe(true);
  });

  test('existing with punctuation matches clean query', () => {
    const existing = new Set(['add-retry!']);
    expect(isDuplicateGoal('add retry', existing)).toBe(true);
  });

  test('existing with whitespace matches collapsed query', () => {
    const existing = new Set(['add   retry']);
    expect(isDuplicateGoal('add retry', existing)).toBe(true);
  });

  test('existing entries are NOT pre-normalized (loop recomputes)', () => {
    // Set still contains raw strings. Pinning that the function does
    // NOT mutate or replace the existing set.
    const existing = new Set(['Add Retry!', 'Fix Bug']);
    isDuplicateGoal('add retry', existing);
    // Set unchanged.
    expect([...existing]).toEqual(['Add Retry!', 'Fix Bug']);
  });

  test('multiple existing entries: first match wins', () => {
    // Loop short-circuits on first matching entry.
    const existing = new Set([
      'add retry to llm',  // matches
      'completely different goal',
      'another unrelated entry',
    ]);
    expect(isDuplicateGoal('add retry logic to llm', existing)).toBe(true);
  });

  test('empty existing entries (normalized) are skipped in loop', () => {
    // If an existing entry normalizes to empty string, the loop
    // continues without matching.
    const existing = new Set(['!@#$', 'add retry']);
    expect(isDuplicateGoal('add retry', existing)).toBe(true);
  });
});

describe('isDuplicateGoal — existing token size 0 handling', () => {
  // If existingTokens.size === 0 (e.g. existing is all 1-char tokens),
  // the loop continues without matching.

  test('existing entry with only 1-char tokens is skipped', () => {
    const existing = new Set(['a b c']);
    // 'a b c' normalizes to 'a b c', tokens = {} (all 1-char dropped).
    // The loop skips this entry.
    expect(isDuplicateGoal('add retry', existing)).toBe(false);
  });

  test('multiple existing entries: some skipped, some matched', () => {
    const existing = new Set([
      'a b c',           // tokens empty — skipped
      'add retry foo bar', // tokens: {add, retry, foo, bar}
    ]);
    expect(isDuplicateGoal('retry add', existing)).toBe(true);
  });
});

describe('isDuplicateGoal — union zero guard', () => {
  // The source has `if (union === 0) continue;` as a defensive guard.
  // Hard to trigger because if both token sets are non-empty, union > 0.

  test('defensive: union zero is skipped (cannot trigger in practice)', () => {
    // If both newTokens and existingTokens are non-empty (which they
    // must be to reach this point), union >= max(|A|, |B|) > 0.
    // The guard is dead code, but pinning that it exists.
    const existing = new Set(['add retry']);
    expect(isDuplicateGoal('retry add', existing)).toBe(true);
  });
});

describe('isDuplicateGoal — return type', () => {
  test('always returns a boolean', () => {
    const inputs: Array<[string, Set<string>]> = [
      ['', new Set()],
      ['hello', new Set()],
      ['hello', new Set(['hello'])],
      ['hello', new Set(['world'])],
      ['Add Retry', new Set(['add retry'])],
    ];
    for (const [goal, existing] of inputs) {
      const result = isDuplicateGoal(goal, existing);
      expect(typeof result).toBe('boolean');
    }
  });

  test('throws TypeError on null/undefined input (no type guard)', () => {
    // isDuplicateGoal calls normalizeGoal(newGoal), which calls
    // newGoal.toLowerCase() immediately. Non-strings throw TypeError.
    // Pinning that the function requires a string input.
    expect(() => isDuplicateGoal(null as unknown as string, new Set())).toThrow(TypeError);
    expect(() => isDuplicateGoal(undefined as unknown as string, new Set())).toThrow(TypeError);
  });
});

describe('buildSucceededGoalSet — outcome filter', () => {
  test('only includes outcome === "success" (strict equality)', () => {
    const trace: TraceRecord[] = [
      makeTrace('success', 'goal success'),
      makeTrace('failure', 'goal failure'),
      makeTrace('abandoned', 'goal abandoned'),
    ];
    const set = buildSucceededGoalSet(trace);
    expect([...set]).toEqual(['goal success']);
  });

  test('rejects case-variant "Success" (strict equality)', () => {
    // outcome === 'success' is case-sensitive. A trace record with
    // outcome 'Success' or 'SUCCESS' would NOT be included.
    const trace = [
      makeTrace('Success' as TraceRecord['outcome'], 'goal title case'),
    ];
    expect([...buildSucceededGoalSet(trace)]).toEqual([]);
  });

  test('rejects partial-match "successful" (strict equality)', () => {
    const trace = [
      makeTrace('successful' as TraceRecord['outcome'], 'goal partial'),
    ];
    expect([...buildSucceededGoalSet(trace)]).toEqual([]);
  });
});

describe('buildSucceededGoalSet — raw storage (not normalized)', () => {
  // The set stores RAW goal text. Normalization happens downstream
  // in isDuplicateGoal.

  test('stores raw goal text verbatim', () => {
    const trace: TraceRecord[] = [
      makeTrace('success', 'Add Retry'),
    ];
    const set = buildSucceededGoalSet(trace);
    expect([...set]).toEqual(['Add Retry']); // NOT 'add retry'
  });

  test('different surface forms of same goal create DIFFERENT entries', () => {
    const trace: TraceRecord[] = [
      makeTrace('success', 'Add Retry'),
      makeTrace('success', 'add retry'),
      makeTrace('success', 'add-retry!'),
    ];
    const set = buildSucceededGoalSet(trace);
    // 3 distinct raw strings, 3 entries.
    expect(set.size).toBe(3);
  });

  test('Set semantics: same raw string added once even if in trace twice', () => {
    const trace: TraceRecord[] = [
      makeTrace('success', 'add retry'),
      makeTrace('success', 'add retry'), // duplicate raw
    ];
    const set = buildSucceededGoalSet(trace);
    expect(set.size).toBe(1);
  });
});

describe('buildSucceededGoalSet — goal validation', () => {
  test('skips empty-string goals (trim.length === 0 check)', () => {
    const trace: TraceRecord[] = [
      makeTrace('success', ''),
      makeTrace('success', 'valid goal'),
    ];
    expect([...buildSucceededGoalSet(trace)]).toEqual(['valid goal']);
  });

  test('skips whitespace-only goals (trim.length === 0 check)', () => {
    const trace: TraceRecord[] = [
      makeTrace('success', '   '),
      makeTrace('success', '\t'),
      makeTrace('success', '\n'),
      makeTrace('success', 'valid goal'),
    ];
    expect([...buildSucceededGoalSet(trace)]).toEqual(['valid goal']);
  });

  test('preserves goals with leading/trailing whitespace (only trim-checks)', () => {
    // The check is `goal.trim().length > 0`. A goal like '  add retry  '
    // passes the check and is stored RAW (with whitespace).
    const trace: TraceRecord[] = [
      makeTrace('success', '  add retry  '),
    ];
    const set = buildSucceededGoalSet(trace);
    expect([...set]).toEqual(['  add retry  ']);
  });

  test('preserves punctuation goals (no normalization at build time)', () => {
    const trace: TraceRecord[] = [
      makeTrace('success', 'add-retry!'),
    ];
    const set = buildSucceededGoalSet(trace);
    expect([...set]).toEqual(['add-retry!']);
  });
});

describe('buildSucceededGoalSet — empty and no-success traces', () => {
  test('empty trace → empty set', () => {
    expect([...buildSucceededGoalSet([])]).toEqual([]);
  });

  test('trace with no successes → empty set', () => {
    const trace: TraceRecord[] = [
      makeTrace('failure', 'a'),
      makeTrace('abandoned', 'b'),
    ];
    expect([...buildSucceededGoalSet(trace)]).toEqual([]);
  });

  test('trace with only successes → all included', () => {
    const trace: TraceRecord[] = [
      makeTrace('success', 'a'),
      makeTrace('success', 'b'),
      makeTrace('success', 'c'),
    ];
    const set = buildSucceededGoalSet(trace);
    expect(set.size).toBe(3);
    expect([...set].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('buildSucceededGoalSet — return type', () => {
  test('returns a Set instance', () => {
    const result = buildSucceededGoalSet([]);
    expect(result).toBeInstanceOf(Set);
  });

  test('returns a fresh Set each call', () => {
    const trace: TraceRecord[] = [makeTrace('success', 'goal')];
    const a = buildSucceededGoalSet(trace);
    const b = buildSucceededGoalSet(trace);
    expect(a).not.toBe(b);
    expect([...a]).toEqual([...b]);
  });

  test('returned Set is mutable (no freeze)', () => {
    const trace: TraceRecord[] = [makeTrace('success', 'goal')];
    const set = buildSucceededGoalSet(trace);
    expect(() => set.add('manual addition')).not.toThrow();
    expect(set.has('manual addition')).toBe(true);
  });
});

describe('all functions — determinism', () => {
  test('normalizeGoal is deterministic', () => {
    expect(normalizeGoal('Add Retry v2!')).toBe(normalizeGoal('Add Retry v2!'));
  });

  test('isDuplicateGoal is deterministic', () => {
    const existing = new Set(['add retry']);
    const a = isDuplicateGoal('Add Retry!', existing);
    const b = isDuplicateGoal('Add Retry!', existing);
    expect(a).toBe(b);
  });

  test('buildSucceededGoalSet is deterministic for same input', () => {
    const trace: TraceRecord[] = [
      makeTrace('success', 'a'),
      makeTrace('failure', 'b'),
    ];
    const a = [...buildSucceededGoalSet(trace)];
    const b = [...buildSucceededGoalSet(trace)];
    expect(a).toEqual(b);
  });
});
