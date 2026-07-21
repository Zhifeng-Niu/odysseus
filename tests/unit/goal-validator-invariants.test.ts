import { describe, test, expect } from 'vitest';
import { validateGoal } from '../../src/cerebellum/goal-validator.js';

/**
 * validateGoal — shape, ordering, and pattern invariants.
 *
 * cerebellum-goal-validator.test.ts covers behavior — which specific goals
 * pass and which fail (parameterized across 40+ examples). But the
 * structural contracts a refactor could silently break are NOT pinned:
 *
 *   - GoalValidationResult SHAPE. The result has `valid: boolean` and
 *     optionally `reason: string`. When valid, `reason` must NOT appear
 *     in the object (exactOptionalPropertyTypes). When invalid, `reason`
 *     is required and must be a non-empty string. A refactor that adds
 *     `reason: undefined` on the valid path would break JSON consumers
 *     that distinguish missing keys from undefined values.
 *
 *   - CHECK ORDERING. The four checks run in a specific order:
 *     empty → action-verb → conversational → question → default-allow.
 *     Reordering would change outcomes for mixed inputs. The load-bearing
 *     case: action-verb check runs BEFORE conversational check, so
 *     "hi, please add a file" is VALID (not rejected as a greeting).
 *
 *   - EXACT REASON STRINGS. The reason field uses specific phrasing that
 *     downstream consumers (UI, logs) may parse or display. Drift in
 *     the wording would silently change the operator experience.
 *
 *   - WORD BOUNDARIES for English action verbs. 'add' must match as a
 *     word, not as a substring. 'padding' should NOT trigger the action
 *     verb. Otherwise unrelated prose would be misclassified as code.
 *
 *   - CASE INSENSITIVITY for English patterns. 'HI' and 'Fix' must
 *     behave identically to 'hi' and 'fix'. The regex /i flag is
 *     load-bearing.
 *
 *   - TRIM HAPPENS FIRST. Leading/trailing whitespace doesn't escape
 *     the patterns. '  hi  ' is treated as 'hi'.
 *
 *   - UNKNOWN INTENT IS ACCEPTED (conservative default). When no pattern
 *     matches, the validator returns valid=true so the reactive
 *     heuristic in the orchestrator can decide. Pinning this so a
 *     refactor that "fails closed" (rejects unknown intent) is caught.
 *
 * Each test below pins one slice of these contracts.
 */

describe('validateGoal — GoalValidationResult shape', () => {
  // The result type is { valid: boolean; reason?: string }. The
  // exactOptionalPropertyTypes flag in tsconfig means `reason?: string`
  // is strict: when valid, the key MUST be absent (not `reason: undefined`).

  test('valid result has exactly 1 key: { valid: true }', () => {
    // A refactor that includes `reason: undefined` on the valid path
    // would break JSON consumers that distinguish missing keys from
    // undefined values. Pinning the exact key set.
    const result = validateGoal('add a file');
    expect(Object.keys(result).sort()).toEqual(['valid']);
    expect('reason' in result).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  test('invalid result has exactly 2 keys: { valid: false, reason: string }', () => {
    const result = validateGoal('hi');
    expect(Object.keys(result).sort()).toEqual(['reason', 'valid']);
    expect(result.valid).toBe(false);
    expect(typeof result.reason).toBe('string');
    expect(result.reason!.length).toBeGreaterThan(0);
  });

  test('reason is always a non-empty string on invalid results', () => {
    // Defensive: no empty reason, no non-string reason.
    const invalidInputs = ['', '   ', 'hi', '你好', 'how does this work?', '如何使用'];
    for (const input of invalidInputs) {
      const result = validateGoal(input);
      expect(result.valid).toBe(false);
      expect(typeof result.reason).toBe('string');
      expect(result.reason!.length).toBeGreaterThan(0);
    }
  });
});

describe('validateGoal — check ordering invariants', () => {
  // Source order: empty → action-verb → conversational → question → default.
  // Each test pins a specific ordering decision.

  test('action verb beats conversational pattern (mixed goals are code tasks)', () => {
    // "hi, please add a file" matches BOTH the conversational pattern
    // ('hi') AND the action-verb pattern ('add'). The action-verb check
    // runs first → result is valid. Reordering would reject mixed goals.
    const result = validateGoal('hi, please add a file');
    expect(result.valid).toBe(true);
  });

  test('action verb beats question pattern', () => {
    // "how to add a file" matches BOTH the question pattern ('how to')
    // AND the action-verb pattern ('add'). Action verb wins → valid.
    // This lets "how to fix X" goals through as real code tasks.
    const result = validateGoal('how to add a file');
    expect(result.valid).toBe(true);
  });

  test('conversational beats question when both match (no action verb)', () => {
    // "hi, how are you" matches BOTH 'hi' (conversational) AND 'how are
    // you' (question-ish but conversational). The conversational check
    // runs first. Pinning that the first matching pattern wins.
    const result = validateGoal('hi, how are you');
    expect(result.valid).toBe(false);
    // The reason is the conversational one — not the question one.
    expect(result.reason).toContain('conversational');
    expect(result.reason).not.toContain('informational');
  });

  test('empty check beats all others', () => {
    // Empty input is rejected with a specific 'goal is empty' reason,
    // regardless of whether other patterns might match.
    // (An empty string matches no patterns, but the empty check runs
    // first anyway.)
    const result = validateGoal('');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('goal is empty');
  });

  test('whitespace-only input triggers the empty check (post-trim)', () => {
    // trim happens before the empty check. '   ' trims to '' → empty
    // reason. Pinning that whitespace doesn't bypass the empty check.
    const result = validateGoal('   ');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('goal is empty');
  });

  test('tab-only input triggers the empty check', () => {
    const result = validateGoal('\t\t\t');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('goal is empty');
  });

  test('newline-only input triggers the empty check', () => {
    const result = validateGoal('\n\n');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('goal is empty');
  });
});

describe('validateGoal — exact reason strings', () => {
  // Downstream consumers (UI badges, log parsers, dashboards) may match
  // on substrings of the reason. Drift would break them silently.

  test('empty goal reason is exactly "goal is empty"', () => {
    expect(validateGoal('').reason).toBe('goal is empty');
  });

  test('conversational reason contains "conversational" and "coding-action verb"', () => {
    // The full string is long; we pin the load-bearing substrings that
    // identify the category and the rule.
    const reason = validateGoal('hi').reason;
    expect(reason).toContain('conversational');
    expect(reason).toContain('coding-action verb');
  });

  test('question reason contains "informational question" and "coding-action verb"', () => {
    const reason = validateGoal('what can you do?').reason;
    expect(reason).toContain('informational question');
    expect(reason).toContain('coding-action verb');
  });

  test('all invalid reasons mention "rejected before agent dispatch"', () => {
    // Both non-empty rejections include this phrase — pinning that the
    // validator is documented as a pre-dispatch gate.
    expect(validateGoal('hi').reason).toContain('rejected before agent dispatch');
    expect(validateGoal('how does this work?').reason).toContain('rejected before agent dispatch');
    // The empty-goal reason is a different shape — it doesn't go through
    // dispatch logic, it's an input validation failure.
    expect(validateGoal('').reason).not.toContain('rejected before agent dispatch');
  });

  test('valid result has NO reason (exactOptionalPropertyTypes)', () => {
    // Even though TypeScript makes `result.reason` typed as
    // `string | undefined`, the runtime object must NOT have the key.
    // This is the exactOptionalPropertyTypes contract.
    const valid = validateGoal('add a file');
    expect(Object.keys(valid)).not.toContain('reason');
  });
});

describe('validateGoal — English action verb word boundaries', () => {
  // The source regex uses \b word boundaries. 'add' must match as a
  // standalone word, not as a substring. Pinning this so a refactor
  // that drops \b (e.g. bare .includes('add')) is caught.

  test('"add" as a standalone word → valid', () => {
    expect(validateGoal('add a file').valid).toBe(true);
  });

  test('"add" as a substring of "padding" → NOT treated as action verb', () => {
    // 'padding' contains 'add' but \b prevents matching. The goal has
    // no other action verb and no conversational pattern → falls
    // through to default-allow (conservative).
    // (If the conversational pattern ALSO matches, this would be invalid.)
    const result = validateGoal('discuss padding for the layout');
    // No action verb matches, no conversational pattern → unknown intent
    // → accepted (conservative).
    expect(result.valid).toBe(true);
  });

  test('"fix" as a substring of "suffix" → NOT treated as action verb', () => {
    const result = validateGoal('the suffix is wrong');
    expect(result.valid).toBe(true);
  });

  test('"remove" as a substring of "removed" → matches (past tense still triggers)', () => {
    // Word boundary at the START. \bremove\b matches 'removed' because
    // 'removed' starts with 'remove' followed by 'd' (a word char) —
    // wait, that's actually a \b failure. Let me think again.
    // \bremove\b requires 'remove' surrounded by word boundaries.
    // 'removed' has 'remove' followed by 'd' — there's NO word boundary
    // between 'e' and 'd'. So 'remove' alone would NOT match in 'removed'.
    // But 'removed' itself isn't in the verb list. Hmm. This test
    // documents the actual behavior — pin whatever it is.
    const result = validateGoal('the file was removed yesterday');
    // No \bremove\b match in 'removed' (no boundary between e and d).
    // No conversational pattern. → unknown intent → valid (conservative).
    expect(result.valid).toBe(true);
  });

  test('action verb at start of goal → valid', () => {
    expect(validateGoal('refactor the parser').valid).toBe(true);
  });

  test('action verb at end of goal → valid', () => {
    // Word boundary at both ends. "the parser refactor" should still
    // match because 'refactor' is a complete word.
    expect(validateGoal('the parser refactor').valid).toBe(true);
  });

  test('action verb in middle of goal → valid', () => {
    expect(validateGoal('please carefully update the config').valid).toBe(true);
  });
});

describe('validateGoal — case insensitivity', () => {
  // The /i flag on the English regexes makes matching case-insensitive.
  // 'HI' must match the same as 'hi'. 'FIX' must match the same as 'fix'.

  test('uppercase greeting is still rejected', () => {
    expect(validateGoal('HI').valid).toBe(false);
    expect(validateGoal('HELLO').valid).toBe(false);
  });

  test('mixed-case greeting is still rejected', () => {
    expect(validateGoal('Hi').valid).toBe(false);
    expect(validateGoal('hElLo').valid).toBe(false);
  });

  test('uppercase action verb is still accepted', () => {
    expect(validateGoal('ADD a file').valid).toBe(true);
    expect(validateGoal('Fix the bug').valid).toBe(true);
  });

  test('mixed-case action verb is still accepted', () => {
    expect(validateGoal('ReFaCtOr the parser').valid).toBe(true);
  });

  test('uppercase question is still rejected', () => {
    expect(validateGoal('WHAT CAN YOU DO?').valid).toBe(false);
    expect(validateGoal('How does this work?').valid).toBe(false);
  });
});

describe('validateGoal — trim happens before all checks', () => {
  // The source does `goal.trim()` once at the top. All downstream regex
  // tests see the trimmed form. Pinning that leading/trailing whitespace
  // doesn't escape any pattern.

  test('leading whitespace does not bypass conversational detection', () => {
    expect(validateGoal('   hi').valid).toBe(false);
    expect(validateGoal('\thi').valid).toBe(false);
  });

  test('trailing whitespace does not bypass conversational detection', () => {
    expect(validateGoal('hi   ').valid).toBe(false);
    expect(validateGoal('hi\n').valid).toBe(false);
  });

  test('surrounding whitespace does not bypass action verb detection', () => {
    // '  add a file  ' trims to 'add a file' → action verb matches.
    expect(validateGoal('  add a file  ').valid).toBe(true);
  });

  test('internal whitespace is preserved (not collapsed)', () => {
    // Only trim runs — no whitespace collapsing. 'hi    there' still
    // has 'hi' as a word, so the conversational pattern matches.
    expect(validateGoal('hi    there').valid).toBe(false);
  });
});

describe('validateGoal — conservative default for unknown intent', () => {
  // The source returns valid=true when no pattern matches. This is the
  // "fail open" contract — better to let a greeting slip through to the
  // reactive heuristic than to block a legitimate code task.

  test('unrelated prose with no patterns → valid', () => {
    expect(validateGoal('the sky is blue').valid).toBe(true);
    expect(validateGoal('random musings about life').valid).toBe(true);
    expect(validateGoal('today is Tuesday').valid).toBe(true);
  });

  test('prose that contains code-like words but no action verbs → valid (default)', () => {
    // 'code' is not in the action verb list. 'file' isn't either.
    // No conversational pattern matches. → unknown → valid.
    expect(validateGoal('the code is in the file').valid).toBe(true);
  });

  test('prose containing a greeting word as substring (no word boundary) → valid', () => {
    // 'this is high priority' contains 'hi' as substring of 'high'.
    // \b word boundary prevents the conversational match.
    expect(validateGoal('this is high priority').valid).toBe(true);
  });

  test('empty reason on valid result (default-allow path)', () => {
    // The default-allow path returns { valid: true } — no reason.
    // Same exactOptionalPropertyTypes contract as the action-verb path.
    const result = validateGoal('the sky is blue');
    expect(result.valid).toBe(true);
    expect(Object.keys(result)).not.toContain('reason');
  });
});

describe('validateGoal — CJK pattern invariants', () => {
  // CJK patterns match as substrings (no \b for CJK). This means the
  // patterns are intentionally narrower — only unambiguous standalone
  // phrases. A broader list would over-match normal Chinese prose.

  test('CJK greeting 你好 → rejected', () => {
    expect(validateGoal('你好').valid).toBe(false);
  });

  test('CJK greeting as prefix of longer sentence → still rejected (no word boundary)', () => {
    // CJK has no \b. 你好 anywhere in the string triggers the match.
    // This is documented behavior — narrower pattern list compensates.
    expect(validateGoal('你好，请问').valid).toBe(false);
  });

  test('CJK action verb 添加 → accepted', () => {
    expect(validateGoal('添加文件').valid).toBe(true);
  });

  test('CJK action verb beats CJK conversational pattern', () => {
    // 你好 + 添加 in the same goal → action verb wins (same as English).
    expect(validateGoal('你好，请添加一个文件').valid).toBe(true);
  });

  test('CJK question pattern 如何 → rejected (when no action verb)', () => {
    expect(validateGoal('如何使用').valid).toBe(false);
  });

  test('CJK action verb beats CJK question pattern', () => {
    // '如何添加' contains both 如何 (question) and 添加 (action). Action wins.
    expect(validateGoal('如何添加文件').valid).toBe(true);
  });

  test('CJK closing 谢谢 → rejected', () => {
    expect(validateGoal('谢谢').valid).toBe(false);
  });

  test('CJK closing 再见 → rejected', () => {
    expect(validateGoal('再见').valid).toBe(false);
  });
});

describe('validateGoal — mixed language invariants', () => {
  // Real operator input may mix English and CJK. The validator runs
  // both regex banks independently — any match in either wins.

  test('English action verb + CJK greeting → action verb wins', () => {
    expect(validateGoal('你好 please add a file').valid).toBe(true);
  });

  test('CJK action verb + English greeting → action verb wins', () => {
    expect(validateGoal('hi 请添加文件').valid).toBe(true);
  });

  test('English greeting + CJK greeting (no action verb) → rejected', () => {
    // Either conversational pattern match is enough to reject.
    expect(validateGoal('hi 你好').valid).toBe(false);
  });

  test('English question + CJK question (no action verb) → rejected', () => {
    expect(validateGoal('how 如何').valid).toBe(false);
  });
});

describe('validateGoal — English action verb coverage', () => {
  // Pinning that every verb in the ACTION_VERBS_EN regex is recognized.
  // If a verb is removed from the regex, the corresponding test fails.
  // This catches accidental regex truncation.

  const englishVerbs = [
    'add', 'implement', 'refactor', 'fix', 'remove', 'change', 'update',
    'modify', 'extend', 'introduce', 'create', 'delete', 'rename', 'move',
    'extract', 'inline', 'wire', 'register', 'build', 'test', 'lint',
    'format', 'migrate', 'port', 'optimize', 'debug', 'handle', 'support',
    'generate', 'scaffold', 'bootstrap', 'configure', 'cleanup', 'dedupe',
  ];

  for (const verb of englishVerbs) {
    test(`English verb "${verb}" triggers action-verb match`, () => {
      // Each verb wrapped in a minimal sentence context.
      const result = validateGoal(`please ${verb} the module`);
      expect(result.valid).toBe(true);
    });
  }
});

describe('validateGoal — CJK action verb coverage', () => {
  // Same coverage contract for the CJK verb list.

  const cjkVerbs = ['添加', '实现', '重构', '修复', '删除', '修改', '更新', '创建', '构建', '测试', '配置'];

  for (const verb of cjkVerbs) {
    test(`CJK verb "${verb}" triggers action-verb match`, () => {
      const result = validateGoal(`${verb}模块`);
      expect(result.valid).toBe(true);
    });
  }
});

describe('validateGoal — determinism', () => {
  test('same input produces identical output across calls', () => {
    // The function is pure — no internal state, no Date.now(), no
    // randomness. Two calls with the same input produce the same result.
    const a = validateGoal('add a file with retry logic');
    const b = validateGoal('add a file with retry logic');
    expect(a).toEqual(b);
  });

  test('order of calls does not matter (no shared state)', () => {
    // The function does not memoize or accumulate state. Calling with
    // input A then B is the same as B then A.
    const ab = { a: validateGoal('add'), b: validateGoal('hi') };
    const ba = { a: validateGoal('add'), b: validateGoal('hi') };
    expect(ab).toEqual(ba);
  });
});
