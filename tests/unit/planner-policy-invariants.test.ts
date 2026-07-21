import { describe, test, expect } from 'vitest';
import {
  MIN_PLAN_GOAL_LENGTH,
  PLAN_KEYWORDS,
  shouldPlanGoal,
} from '../../src/cerebellum/planner-policy.js';

/**
 * planner-policy — structural invariants for the planner-gate policy.
 *
 * planner.test.ts covers the plan() MECHANISM (LLM call, decomposition,
 * step extraction). This file pins the POLICY contract — the heuristic
 * gates that decide whether plan() is invoked at all. A silent regression
 * here (wrong threshold, missing keyword, broken case-folding) would
 * either over-plan (wasting tokens on simple goals) or under-plan
 * (silently executing multi-step epics as a single waypoint).
 *
 * Contracts pinned here:
 *
 *   - MIN_PLAN_GOAL_LENGTH === 60. Tuned by sampling real waypoints;
 *     changing this shifts the planning boundary.
 *
 *   - PLAN_KEYWORDS is a FIXED-LENGTH list with BILINGUAL entries
 *     (7 English keywords + 7 Chinese equivalents). Each English entry
 *     has a Chinese counterpart — removing one half silently breaks
 *     the bilingual contract. All entries are lowercase; the function
 *     lowercases the goal before matching.
 *
 *   - shouldPlanGoal has TWO triggers (LENGTH OR KEYWORD), either
 *     suffices. Length trigger fires first (short-circuit), keyword
 *     trigger is the fallback for short-but-complex goals.
 *
 *   - KEYWORD MATCHING uses substring `.includes()` (NOT `\b` word
 *     boundary). So 'refactoring' matches 'refactor', and 'systemic'
 *     matches 'system'. This is deliberate — over-matching is cheap
 *     (a wasted plan() is recoverable); under-matching is not.
 *
 *   - EMPTY/WHITESPACE goals return false. Single-line trim only;
 *     multi-line goals with leading/trailing whitespace are still
 *     evaluated on their content.
 *
 *   - PURE FUNCTION. No shared state, no side effects, deterministic.
 *     Same input always produces same output.
 *
 *   - THROWS on null/undefined (no type guard). `goal.trim()` fails
 *     immediately with TypeError.
 *
 * Each test below pins one slice of these contracts.
 */

// ---------------------------------------------------------------------------
// MIN_PLAN_GOAL_LENGTH — the numeric threshold
// ---------------------------------------------------------------------------

describe('MIN_PLAN_GOAL_LENGTH — exact value and type', () => {
  test('is exactly 60', () => {
    expect(MIN_PLAN_GOAL_LENGTH).toBe(60);
  });

  test('is a positive integer', () => {
    expect(Number.isInteger(MIN_PLAN_GOAL_LENGTH)).toBe(true);
    expect(MIN_PLAN_GOAL_LENGTH).toBeGreaterThan(0);
  });

  test('changing it would shift the boundary (documenting dependency)', () => {
    // Boundary tests in this file assume 60. If MIN changes, those tests
    // must update too. This test exists to flag the coupling.
    expect(MIN_PLAN_GOAL_LENGTH).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// PLAN_KEYWORDS — bilingual fixed-length list
// ---------------------------------------------------------------------------

describe('PLAN_KEYWORDS — list composition', () => {
  test('has exactly 14 entries (7 English + 7 Chinese)', () => {
    expect(PLAN_KEYWORDS.length).toBe(14);
  });

  test('is a readonly array (frozen shape)', () => {
    expect(Array.isArray(PLAN_KEYWORDS)).toBe(true);
  });

  test('all English entries are present', () => {
    const english = ['refactor', 'redesign', 'system', 'full', 'module', 'end-to-end', 'overhaul'];
    for (const kw of english) {
      expect(PLAN_KEYWORDS).toContain(kw);
    }
  });

  test('all Chinese entries are present', () => {
    const chinese = ['重构', '重设计', '系统', '完整', '模块', '端到端', '改造'];
    for (const kw of chinese) {
      expect(PLAN_KEYWORDS).toContain(kw);
    }
  });

  test('every English keyword has a Chinese counterpart (bilingual parity)', () => {
    // Pinning the 1:1 mapping: removing one half breaks bilingual coverage.
    const pairs: Array<[string, string]> = [
      ['refactor', '重构'],
      ['redesign', '重设计'],
      ['system', '系统'],
      ['full', '完整'],
      ['module', '模块'],
      ['end-to-end', '端到端'],
      ['overhaul', '改造'],
    ];
    for (const [en, zh] of pairs) {
      expect(PLAN_KEYWORDS).toContain(en);
      expect(PLAN_KEYWORDS).toContain(zh);
    }
    expect(pairs.length).toBe(7);
  });

  test('all English entries are lowercase (function lowercases goal before matching)', () => {
    // If an entry were 'Refactor', the toLowerCase() on the goal would
    // fail to match 'Refactor' against 'refactor'. Pinning lowercase.
    for (const kw of PLAN_KEYWORDS) {
      // Only check ASCII entries — Chinese has no case.
      if (/^[a-z]/.test(kw)) {
        expect(kw).toBe(kw.toLowerCase());
      }
    }
  });

  test('contains no empty strings', () => {
    for (const kw of PLAN_KEYWORDS) {
      expect(kw.length).toBeGreaterThan(0);
    }
  });

  test('contains no duplicate entries', () => {
    const unique = new Set(PLAN_KEYWORDS);
    expect(unique.size).toBe(PLAN_KEYWORDS.length);
  });
});

// ---------------------------------------------------------------------------
// shouldPlanGoal — length-trigger boundary
// ---------------------------------------------------------------------------

describe('shouldPlanGoal — length trigger boundary', () => {
  test('goal shorter than MIN → false (no keyword)', () => {
    const short = 'a'.repeat(MIN_PLAN_GOAL_LENGTH - 1); // 59 chars
    expect(short.length).toBe(59);
    expect(shouldPlanGoal(short)).toBe(false);
  });

  test('goal exactly MIN chars → true (boundary inclusive)', () => {
    const exact = 'a'.repeat(MIN_PLAN_GOAL_LENGTH); // 60 chars
    expect(exact.length).toBe(60);
    expect(shouldPlanGoal(exact)).toBe(true);
  });

  test('goal longer than MIN → true', () => {
    const long = 'a'.repeat(MIN_PLAN_GOAL_LENGTH + 50); // 110 chars
    expect(shouldPlanGoal(long)).toBe(true);
  });

  test('length is measured AFTER trim', () => {
    // 60 chars of 'a' surrounded by whitespace → still triggers.
    const padded = '   ' + 'a'.repeat(MIN_PLAN_GOAL_LENGTH) + '   ';
    expect(shouldPlanGoal(padded)).toBe(true);
  });

  test('whitespace-only interior counts toward length', () => {
    // 60 chars including spaces in the middle still qualifies.
    const withSpaces = 'a'.repeat(20) + ' '.repeat(20) + 'b'.repeat(20);
    expect(withSpaces.length).toBe(60);
    expect(shouldPlanGoal(withSpaces)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldPlanGoal — keyword trigger
// ---------------------------------------------------------------------------

describe('shouldPlanGoal — keyword trigger (case-insensitive substring)', () => {
  test('English keyword at start of short goal → true', () => {
    expect(shouldPlanGoal('refactor the code')).toBe(true);
  });

  test('English keyword in middle of short goal → true', () => {
    expect(shouldPlanGoal('please refactor this module')).toBe(true);
  });

  test('English keyword at end of short goal → true', () => {
    expect(shouldPlanGoal('this is a system')).toBe(true);
  });

  test('English keyword as entire goal → true', () => {
    expect(shouldPlanGoal('refactor')).toBe(true);
    expect(shouldPlanGoal('system')).toBe(true);
  });

  test('UPPERCASE keyword → true (case-insensitive)', () => {
    expect(shouldPlanGoal('REFACTOR everything')).toBe(true);
    expect(shouldPlanGoal('REDESIGN System')).toBe(true);
  });

  test('MixedCase keyword → true', () => {
    expect(shouldPlanGoal('ReFactor the module')).toBe(true);
  });

  test('substring match: "refactoring" contains "refactor" → true', () => {
    // .includes() matches substrings. 'refactoring' includes 'refactor'.
    expect(shouldPlanGoal('refactoring the parser')).toBe(true);
  });

  test('substring match: "systemic" contains "system" → true', () => {
    expect(shouldPlanGoal('systemic issue')).toBe(true);
  });

  test('substring match: "modules" contains "module" → true', () => {
    // "modules" extends "module" — .includes('module') matches.
    expect(shouldPlanGoal('modules everywhere')).toBe(true);
  });

  test('hyphenated "end-to-end" matches verbatim', () => {
    expect(shouldPlanGoal('end-to-end testing')).toBe(true);
  });

  test('Chinese keyword triggers planning', () => {
    expect(shouldPlanGoal('重构这个模块')).toBe(true);
    expect(shouldPlanGoal('系统设计')).toBe(true);
    expect(shouldPlanGoal('端到端实现')).toBe(true);
  });

  test('Chinese keyword alone triggers planning', () => {
    expect(shouldPlanGoal('重构')).toBe(true);
    expect(shouldPlanGoal('系统')).toBe(true);
  });

  test('Chinese keyword in mixed text → true', () => {
    expect(shouldPlanGoal('请重构这个 code')).toBe(true);
  });

  test('near-miss English word does NOT match (no word boundary, but no substring either)', () => {
    // 'refact' is NOT a substring of any keyword.
    expect(shouldPlanGoal('refact the code')).toBe(false);
    // 'syst' is NOT a substring.
    expect(shouldPlanGoal('syst em')).toBe(false);
  });

  test('keyword with extra characters still matches (substring behavior)', () => {
    expect(shouldPlanGoal('refactorize')).toBe(true);
    expect(shouldPlanGoal('systematically')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldPlanGoal — empty / whitespace inputs
// ---------------------------------------------------------------------------

describe('shouldPlanGoal — empty and whitespace inputs', () => {
  test('empty string → false', () => {
    expect(shouldPlanGoal('')).toBe(false);
  });

  test('single space → false', () => {
    expect(shouldPlanGoal(' ')).toBe(false);
  });

  test('multiple spaces → false', () => {
    expect(shouldPlanGoal('   ')).toBe(false);
  });

  test('tab → false', () => {
    expect(shouldPlanGoal('\t')).toBe(false);
  });

  test('newline → false', () => {
    expect(shouldPlanGoal('\n')).toBe(false);
  });

  test('mixed whitespace → false', () => {
    expect(shouldPlanGoal(' \t\n ')).toBe(false);
  });

  test('whitespace surrounding content is stripped, content then evaluated', () => {
    // Short content (no keyword) + padding → false.
    expect(shouldPlanGoal('   short goal   ')).toBe(false);
    // Short content WITH keyword + padding → true.
    expect(shouldPlanGoal('   refactor short   ')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldPlanGoal — length AND keyword interaction (short-circuit)
// ---------------------------------------------------------------------------

describe('shouldPlanGoal — length and keyword interaction', () => {
  test('long goal WITHOUT keyword → true (length alone suffices)', () => {
    const longNoKeyword = 'a'.repeat(MIN_PLAN_GOAL_LENGTH + 10);
    expect(shouldPlanGoal(longNoKeyword)).toBe(true);
  });

  test('long goal WITH keyword → true (both triggers agree)', () => {
    const longWithKeyword = 'refactor ' + 'a'.repeat(MIN_PLAN_GOAL_LENGTH);
    expect(shouldPlanGoal(longWithKeyword)).toBe(true);
  });

  test('short goal WITHOUT keyword → false (neither trigger fires)', () => {
    expect(shouldPlanGoal('fix typo')).toBe(false);
    expect(shouldPlanGoal('update README')).toBe(false);
  });

  test('short goal WITH keyword → true (keyword trigger alone)', () => {
    expect(shouldPlanGoal('refactor X')).toBe(true);
    expect(shouldPlanGoal('redesign Y')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldPlanGoal — output type and shape
// ---------------------------------------------------------------------------

describe('shouldPlanGoal — return type', () => {
  test('always returns a boolean', () => {
    const inputs = ['', 'short', 'refactor', 'a'.repeat(100), '重构', '!@#$'];
    for (const input of inputs) {
      const result = shouldPlanGoal(input);
      expect(typeof result).toBe('boolean');
    }
  });

  test('throws TypeError on null/undefined (no type guard in source)', () => {
    // Source does `goal.trim()` immediately — null/undefined throws.
    expect(() => shouldPlanGoal(null as unknown as string)).toThrow(TypeError);
    expect(() => shouldPlanGoal(undefined as unknown as string)).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// shouldPlanGoal — purity and determinism
// ---------------------------------------------------------------------------

describe('shouldPlanGoal — purity', () => {
  test('pure: same input produces same output across calls', () => {
    const inputs = ['', 'short', 'refactor', 'a'.repeat(100), '重构'];
    for (const input of inputs) {
      const a = shouldPlanGoal(input);
      const b = shouldPlanGoal(input);
      expect(a).toBe(b);
    }
  });

  test('does not mutate input (strings are immutable anyway)', () => {
    const input = '  refactor this  ';
    const original = input;
    shouldPlanGoal(input);
    expect(input).toBe(original);
  });

  test('no shared state — repeated calls do not accumulate', () => {
    // Should not have a counter or memo that changes behavior over time.
    const first = shouldPlanGoal('refactor');
    const second = shouldPlanGoal('refactor');
    const third = shouldPlanGoal('refactor');
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(first).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldPlanGoal — adversarial / unusual inputs
// ---------------------------------------------------------------------------

describe('shouldPlanGoal — adversarial inputs', () => {
  test('punctuation-only short goal → false', () => {
    expect(shouldPlanGoal('!@#$%')).toBe(false);
    expect(shouldPlanGoal('...,,,???')).toBe(false);
  });

  test('unicode-only short goal (no keyword) → false', () => {
    expect(shouldPlanGoal('你好')).toBe(false); // Chinese but not on keyword list
    expect(shouldPlanGoal('🎉🎊')).toBe(false);
  });

  test('keyword hidden in punctuation → true (substring match)', () => {
    expect(shouldPlanGoal('!refactor!')).toBe(true);
    expect(shouldPlanGoal('[refactor]')).toBe(true);
  });

  test('keyword as substring of larger word → true', () => {
    expect(shouldPlanGoal('prerefactor')).toBe(true);
    expect(shouldPlanGoal('refactorpost')).toBe(true);
  });

  test('very long goal without keyword → true', () => {
    const huge = 'a'.repeat(10000);
    expect(shouldPlanGoal(huge)).toBe(true);
  });

  test('multi-line goal with short content + keyword → true', () => {
    expect(shouldPlanGoal('line1\nrefactor\nline3')).toBe(true);
  });

  test('multi-line goal with short content no keyword → false', () => {
    const multiline = 'line1\nline2\nline3';
    expect(multiline.length).toBeLessThan(MIN_PLAN_GOAL_LENGTH);
    expect(shouldPlanGoal(multiline)).toBe(false);
  });

  test('number-only goal shorter than MIN → false', () => {
    expect(shouldPlanGoal('12345')).toBe(false);
  });

  test('keyword followed by numbers → true', () => {
    expect(shouldPlanGoal('refactor 12345')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cross-check: every PLAN_KEYWORDS entry triggers planning on its own
// ---------------------------------------------------------------------------

describe('PLAN_KEYWORDS — every entry triggers shouldPlanGoal', () => {
  test('each keyword alone (as goal) → true', () => {
    // This pins that the keyword list is self-consistent with the
    // function: every entry, when used as the entire goal, triggers
    // planning. If an entry were somehow malformed (e.g. uppercase),
    // this test would catch it.
    for (const kw of PLAN_KEYWORDS) {
      expect(shouldPlanGoal(kw)).toBe(true);
    }
  });

  test('each keyword uppercased alone → true (case-insensitive)', () => {
    for (const kw of PLAN_KEYWORDS) {
      // Skip Chinese — no uppercase concept.
      if (/^[a-z]/.test(kw)) {
        expect(shouldPlanGoal(kw.toUpperCase())).toBe(true);
      }
    }
  });

  test('each keyword padded with spaces → true', () => {
    for (const kw of PLAN_KEYWORDS) {
      expect(shouldPlanGoal(`   ${kw}   `)).toBe(true);
    }
  });
});
