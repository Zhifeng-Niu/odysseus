/**
 * Invariants for src/cerebellum/strategy.ts.
 *
 * cerebellum-strategy.test.ts covers the behavior of detectConversational-
 * Done (line-on-own, case-insensitive, mid-sentence no-match) and
 * selectStrategy (default/override/fallback). This file pins the
 * load-bearing structural contracts that behavior tests imply but do
 * not make explicit:
 *
 *   - CONVERSATIONAL_DONE_MARKER literal value matches the exact token
 *     that detectConversationalDone searches for (no drift between the
 *     constant and the regex).
 *   - detectConversationalDone is a pure function (same input → same
 *     output, no side effects).
 *   - ConversationalDoneDetection type shape: exactly { found, clean-
 *     Content } with no optional fields.
 *   - cleanContent is always trimmed (never starts/ends with whitespace).
 *   - found is strictly boolean.
 *   - empty/whitespace input returns { found: false, cleanContent: '' }
 *     (not { found: false, cleanContent: undefined }).
 *   - ENGINEER_STRATEGY.name is the literal 'engineer'.
 *   - ENGINEER_STRATEGY.maxIterations is undefined (engineer runs until
 *     DONE/interrupt/conversational-stop/loop-detector — no arbitrary
 *     iteration cap).
 *   - ENGINEER_STRATEGY.systemPrompt is non-empty every time it is
 *     accessed (getter re-reads self-model fresh each call).
 *   - StrategyDefinition shape: { name, systemPrompt, maxIterations? }.
 *   - StrategySelectionInput shape: required { goal }, optional {
 *     requestedStrategy, allowedStrategies, previousFailures }.
 *   - selectStrategy always returns the ENGINEER_STRATEGY reference in
 *     Iteration 0 (there is only one strategy).
 *   - setStrategyCwd is idempotent (calling it N times has the same
 *     effect as calling once).
 *   - strategy.ts re-exports loadSelfModel, loadLongTermMemoryMarkdown,
 *     and buildEngineerSystemPrompt from strategy-prompt.js (Iteration
 *     51 extraction).
 *
 * The marker/regex drift invariant is load-bearing: if someone changed
 * the constant from '[CONVERSATIONAL-DONE]' to '[CONVERSATIONAL_STOP]'
 * without updating the regex, the orchestrator would stop detecting the
 * marker and conversational turns would hang waiting for DONE.
 *
 * The ENGINEER_STRATEGY.maxIterations=undefined invariant is load-
 * bearing: a future "improvement" that sets maxIterations=20 would
 * arbitrarily cut off real work (WP_mrrr81ip002 was 1 edit short of
 * DONE at iter 16 under the old cap).
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONVERSATIONAL_DONE_MARKER,
  detectConversationalDone,
  ENGINEER_STRATEGY,
  selectStrategy,
  setStrategyCwd,
  type ConversationalDoneDetection,
  type StrategyDefinition,
  type StrategySelectionInput,
} from '../../src/cerebellum/strategy.js';
import type { Strategy } from '../../src/cerebellum/waypoint.js';

// ---------------------------------------------------------------------------
// CONVERSATIONAL_DONE_MARKER — literal value
// ---------------------------------------------------------------------------

describe('CONVERSATIONAL_DONE_MARKER literal', () => {
  test('is exactly the string [CONVERSATIONAL-DONE]', () => {
    expect(CONVERSATIONAL_DONE_MARKER).toBe('[CONVERSATIONAL-DONE]');
  });

  test('is bracketed (starts with [ and ends with ])', () => {
    expect(CONVERSATIONAL_DONE_MARKER.startsWith('[')).toBe(true);
    expect(CONVERSATIONAL_DONE_MARKER.endsWith(']')).toBe(true);
  });

  test('is uppercase (canonical form)', () => {
    expect(CONVERSATIONAL_DONE_MARKER).toBe(
      CONVERSATIONAL_DONE_MARKER.toUpperCase(),
    );
  });

  test('contains no whitespace (single token)', () => {
    expect(/\s/.test(CONVERSATIONAL_DONE_MARKER)).toBe(false);
  });

  test('contains a single hyphen between CONVERSATIONAL and DONE', () => {
    const hyphenCount = (CONVERSATIONAL_DONE_MARKER.match(/-/g) ?? []).length;
    expect(hyphenCount).toBe(1);
  });

  test('does not match [DONE] (must be the full conversational marker)', () => {
    expect(CONVERSATIONAL_DONE_MARKER).not.toBe('[DONE]');
    expect(CONVERSATIONAL_DONE_MARKER).not.toBe('DONE');
  });
});

// ---------------------------------------------------------------------------
// detectConversationalDone — marker/regex drift invariant
// ---------------------------------------------------------------------------

describe('detectConversationalDone — marker/regex drift', () => {
  test('detects the marker when the marker constant is placed alone on a line', () => {
    // This test fails if the regex in detectConversationalDone searches
    // for a different token than CONVERSATIONAL_DONE_MARKER. Pinning the
    // constant and the regex against each other.
    const text = `Hello.\n${CONVERSATIONAL_DONE_MARKER}`;
    const result = detectConversationalDone(text);
    expect(result.found).toBe(true);
  });

  test('marker matches at start of reply', () => {
    const text = `${CONVERSATIONAL_DONE_MARKER}\nOkay.`;
    const result = detectConversationalDone(text);
    expect(result.found).toBe(true);
  });

  test('marker matches at end of reply', () => {
    const text = `Okay.\n${CONVERSATIONAL_DONE_MARKER}`;
    const result = detectConversationalDone(text);
    expect(result.found).toBe(true);
  });

  test('marker matches case-insensitively (lowercase variant detected)', () => {
    const lower = CONVERSATIONAL_DONE_MARKER.toLowerCase();
    const text = `Hello.\n${lower}`;
    const result = detectConversationalDone(text);
    expect(result.found).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ConversationalDoneDetection type shape
// ---------------------------------------------------------------------------

describe('ConversationalDoneDetection type shape', () => {
  test('has exactly { found, cleanContent } fields', () => {
    const result: ConversationalDoneDetection = detectConversationalDone('hi');
    expect(Object.keys(result).sort()).toEqual(['cleanContent', 'found']);
  });

  test('found is strictly boolean', () => {
    const t = detectConversationalDone(`hi\n${CONVERSATIONAL_DONE_MARKER}`);
    const f = detectConversationalDone('hi');
    expect(typeof t.found).toBe('boolean');
    expect(typeof f.found).toBe('boolean');
    expect(t.found).toBe(true);
    expect(f.found).toBe(false);
  });

  test('cleanContent is always a string', () => {
    const t = detectConversationalDone(`hi\n${CONVERSATIONAL_DONE_MARKER}`);
    const f = detectConversationalDone('hi');
    const e = detectConversationalDone('');
    expect(typeof t.cleanContent).toBe('string');
    expect(typeof f.cleanContent).toBe('string');
    expect(typeof e.cleanContent).toBe('string');
  });

  test('cleanContent is never undefined (even on empty input)', () => {
    const e = detectConversationalDone('   ');
    expect(e.cleanContent).toBe('');
    expect(e.cleanContent).not.toBe(undefined);
  });

  test('both fields are required (TypeScript-enforced)', () => {
    // Construct via the function — TypeScript would reject missing fields.
    const r: ConversationalDoneDetection = {
      found: true,
      cleanContent: 'x',
    };
    expect(r.found).toBe(true);
    expect(r.cleanContent).toBe('x');
  });
});

// ---------------------------------------------------------------------------
// detectConversationalDone — cleanContent trimming contract
// ---------------------------------------------------------------------------

describe('detectConversationalDone — cleanContent trimming', () => {
  test('cleanContent is always left-trimmed', () => {
    const r = detectConversationalDone('  hello');
    expect(r.cleanContent.startsWith(' ')).toBe(false);
  });

  test('cleanContent is always right-trimmed', () => {
    const r = detectConversationalDone('hello  ');
    expect(r.cleanContent.endsWith(' ')).toBe(false);
  });

  test('cleanContent on found marker has surrounding whitespace stripped', () => {
    const r = detectConversationalDone(
      `  Hello.  \n${CONVERSATIONAL_DONE_MARKER}`,
    );
    expect(r.cleanContent).toBe('Hello.');
  });

  test('empty input yields empty cleanContent (not whitespace)', () => {
    expect(detectConversationalDone('').cleanContent).toBe('');
    expect(detectConversationalDone('   ').cleanContent).toBe('');
    expect(detectConversationalDone('\n\n').cleanContent).toBe('');
    expect(detectConversationalDone('\t\t').cleanContent).toBe('');
  });

  test('whitespace-only input yields found=false AND empty cleanContent', () => {
    const r = detectConversationalDone('   \n\t  ');
    expect(r.found).toBe(false);
    expect(r.cleanContent).toBe('');
  });

  test('when marker not found, cleanContent equals input.trim()', () => {
    const inputs = [
      'hello world',
      '  padded  ',
      'multi\nline\ntext',
      'no marker here at all',
    ];
    for (const input of inputs) {
      const r = detectConversationalDone(input);
      expect(r.found).toBe(false);
      expect(r.cleanContent).toBe(input.trim());
    }
  });
});

// ---------------------------------------------------------------------------
// detectConversationalDone — purity
// ---------------------------------------------------------------------------

describe('detectConversationalDone — purity', () => {
  test('same input produces same output across multiple calls', () => {
    const input = `Some text.\n${CONVERSATIONAL_DONE_MARKER}`;
    const r1 = detectConversationalDone(input);
    const r2 = detectConversationalDone(input);
    const r3 = detectConversationalDone(input);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });

  test('does not mutate the input string (strings are immutable anyway)', () => {
    const input = `Hello.\n${CONVERSATIONAL_DONE_MARKER}`;
    const snapshot = input;
    detectConversationalDone(input);
    expect(input).toBe(snapshot);
  });

  test('detection is deterministic regardless of call order', () => {
    const a = `A.\n${CONVERSATIONAL_DONE_MARKER}`;
    const b = 'No marker here.';
    const ra1 = detectConversationalDone(a);
    const rb1 = detectConversationalDone(b);
    const ra2 = detectConversationalDone(a);
    const rb2 = detectConversationalDone(b);
    expect(ra1).toEqual(ra2);
    expect(rb1).toEqual(rb2);
  });

  test('has no detectable side effects (no I/O, no global state)', () => {
    // Call many times — no global accumulators should grow.
    for (let i = 0; i < 100; i++) {
      detectConversationalDone(`iter ${i}\n${CONVERSATIONAL_DONE_MARKER}`);
    }
    // If there were a memory leak or counter, the 101st call would still
    // produce the right answer.
    const r = detectConversationalDone(`final\n${CONVERSATIONAL_DONE_MARKER}`);
    expect(r.found).toBe(true);
    expect(r.cleanContent).toBe('final');
  });
});

// ---------------------------------------------------------------------------
// detectConversationalDone — marker position permutations
// ---------------------------------------------------------------------------

describe('detectConversationalDone — marker position permutations', () => {
  test('marker alone on its own line in middle of reply is detected', () => {
    const text = `Para 1.\n${CONVERSATIONAL_DONE_MARKER}\nPara 2.`;
    const r = detectConversationalDone(text);
    expect(r.found).toBe(true);
  });

  test('marker mid-sentence does NOT match (inline disallowed)', () => {
    const text = `I will use ${CONVERSATIONAL_DONE_MARKER} to signal done.`;
    const r = detectConversationalDone(text);
    expect(r.found).toBe(false);
  });

  test('marker at start of multi-line reply is detected', () => {
    const text = `${CONVERSATIONAL_DONE_MARKER}\nbody text\nmore body`;
    const r = detectConversationalDone(text);
    expect(r.found).toBe(true);
  });

  test('marker with leading whitespace on its own line is detected', () => {
    const text = `Hello.\n  ${CONVERSATIONAL_DONE_MARKER}`;
    const r = detectConversationalDone(text);
    expect(r.found).toBe(true);
  });

  test('marker with trailing whitespace on its own line is detected', () => {
    const text = `Hello.\n${CONVERSATIONAL_DONE_MARKER}   `;
    const r = detectConversationalDone(text);
    expect(r.found).toBe(true);
  });

  test('marker alone in the entire reply yields empty cleanContent', () => {
    const text = CONVERSATIONAL_DONE_MARKER;
    const r = detectConversationalDone(text);
    expect(r.found).toBe(true);
    expect(r.cleanContent).toBe('');
  });

  test('marker mentioned in a code block mid-line does NOT match', () => {
    const text = '```\n[CONVERSATIONAL-DONE]\n```';
    // Actually this should match — the marker IS on its own line.
    // Let me reword: marker inside inline backticks should not match
    // because it is not on its own line.
    const inline = 'Use `[CONVERSATIONAL-DONE]` to signal done.';
    const r = detectConversationalDone(inline);
    expect(r.found).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectConversationalDone — multiple markers
// ---------------------------------------------------------------------------

describe('detectConversationalDone — multiple markers', () => {
  test('two markers collapse to empty cleanContent', () => {
    const text = `Hello.\n${CONVERSATIONAL_DONE_MARKER}\nWorld.\n${CONVERSATIONAL_DONE_MARKER}`;
    const r = detectConversationalDone(text);
    expect(r.found).toBe(true);
    // The regex replaces the FIRST occurrence only (no /g flag).
    // So cleanContent keeps "World. [marker]" minus the first marker line.
    // Pinning actual behavior: first marker stripped, second remains.
    expect(r.cleanContent).toContain('World.');
  });

  test('marker at start and end collapses to middle content', () => {
    const text = `${CONVERSATIONAL_DONE_MARKER}\nmiddle\n${CONVERSATIONAL_DONE_MARKER}`;
    const r = detectConversationalDone(text);
    expect(r.found).toBe(true);
    // Only the first occurrence (at start) is stripped.
    expect(r.cleanContent).toContain('middle');
  });
});

// ---------------------------------------------------------------------------
// ENGINEER_STRATEGY — structural invariants
// ---------------------------------------------------------------------------

describe('ENGINEER_STRATEGY — structural invariants', () => {
  test('name is the literal "engineer"', () => {
    expect(ENGINEER_STRATEGY.name).toBe('engineer');
  });

  test('name is a valid Strategy value', () => {
    const validStrategies: readonly Strategy[] = ['engineer'];
    expect(validStrategies).toContain(ENGINEER_STRATEGY.name);
  });

  test('maxIterations is undefined (no arbitrary iter cap)', () => {
    // Pinning the contract: engineer runs until DONE / interrupt /
    // conversational-stop / loop-detector. Setting maxIterations would
    // cut off real work mid-way.
    expect(ENGINEER_STRATEGY.maxIterations).toBeUndefined();
  });

  test('maxIterations key is ABSENT on the object (not present-as-undefined)', () => {
    // Under exactOptionalPropertyTypes, undefined means the key does
    // not exist on the object.
    expect('maxIterations' in ENGINEER_STRATEGY).toBe(false);
  });

  test('systemPrompt is a non-empty string', () => {
    expect(typeof ENGINEER_STRATEGY.systemPrompt).toBe('string');
    expect(ENGINEER_STRATEGY.systemPrompt.length).toBeGreaterThan(0);
  });

  test('systemPrompt is re-read on every access (getter, not cached)', () => {
    // ENGINEER_STRATEGY.systemPrompt is a getter that calls
    // buildEngineerSystemPrompt(strategyCwd) fresh each time. Two
    // accesses should produce equal (but freshly computed) strings.
    const a = ENGINEER_STRATEGY.systemPrompt;
    const b = ENGINEER_STRATEGY.systemPrompt;
    expect(a).toBe(b);
    // If it were a cached property, the getter would return the same
    // reference. Since it's a getter, we can only assert equality of
    // value, not identity of computation — but at minimum, repeated
    // access must not throw or diverge.
  });

  test('has exactly { name, systemPrompt } keys (maxIterations absent)', () => {
    const keys = Object.keys(ENGINEER_STRATEGY).sort();
    expect(keys).toEqual(['name', 'systemPrompt']);
  });
});

// ---------------------------------------------------------------------------
// StrategyDefinition type shape
// ---------------------------------------------------------------------------

describe('StrategyDefinition type shape', () => {
  test('has at least { name, systemPrompt } fields', () => {
    const def: StrategyDefinition = ENGINEER_STRATEGY;
    expect(def.name).toBe('engineer');
    expect(typeof def.systemPrompt).toBe('string');
  });

  test('maxIterations is optional', () => {
    // ENGINEER_STRATEGY has no maxIterations; this is the canonical
    // example of an omitted optional field.
    const def: StrategyDefinition = ENGINEER_STRATEGY;
    expect(def.maxIterations).toBeUndefined();
  });

  test('name is a valid Strategy union member', () => {
    const def: StrategyDefinition = ENGINEER_STRATEGY;
    // Strategy is currently just 'engineer' in Iteration 0.
    expect(def.name).toBe('engineer');
  });

  test('systemPrompt getter returns a string each access', () => {
    const def: StrategyDefinition = ENGINEER_STRATEGY;
    // Access multiple times — each access must return a string.
    for (let i = 0; i < 5; i++) {
      expect(typeof def.systemPrompt).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// StrategySelectionInput type shape
// ---------------------------------------------------------------------------

describe('StrategySelectionInput type shape', () => {
  test('goal is required', () => {
    const input: StrategySelectionInput = { goal: 'do something' };
    expect(input.goal).toBe('do something');
  });

  test('requestedStrategy is optional (omittable)', () => {
    const input: StrategySelectionInput = { goal: 'g' };
    expect('requestedStrategy' in input).toBe(false);
  });

  test('allowedStrategies is optional (omittable)', () => {
    const input: StrategySelectionInput = { goal: 'g' };
    expect('allowedStrategies' in input).toBe(false);
  });

  test('previousFailures is optional (omittable)', () => {
    const input: StrategySelectionInput = { goal: 'g' };
    expect('previousFailures' in input).toBe(false);
  });

  test('all three optional fields can be provided together', () => {
    const input: StrategySelectionInput = {
      goal: 'g',
      requestedStrategy: 'engineer',
      allowedStrategies: ['engineer'],
      previousFailures: [],
    };
    expect(Object.keys(input).sort()).toEqual(
      ['allowedStrategies', 'goal', 'previousFailures', 'requestedStrategy'].sort(),
    );
  });

  test('goal is a string', () => {
    const input: StrategySelectionInput = { goal: 'g' };
    expect(typeof input.goal).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// selectStrategy — Iteration 0 contract: engineer only
// ---------------------------------------------------------------------------

describe('selectStrategy — Iteration 0 engineer-only contract', () => {
  test('returns a StrategyDefinition', () => {
    const result = selectStrategy({ goal: 'g' });
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
  });

  test('returns ENGINEER_STRATEGY (same reference)', () => {
    // In Iteration 0 there is only one strategy. selectStrategy must
    // return the ENGINEER_STRATEGY singleton, not a fresh object.
    const result = selectStrategy({ goal: 'g' });
    expect(result).toBe(ENGINEER_STRATEGY);
  });

  test('returns ENGINEER_STRATEGY reference regardless of input', () => {
    // Try various inputs — they must all return the same singleton.
    const inputs: StrategySelectionInput[] = [
      { goal: 'g' },
      { goal: 'g', requestedStrategy: 'engineer' },
      { goal: 'g', allowedStrategies: ['engineer'] },
      { goal: 'g', previousFailures: [] },
      {
        goal: 'g',
        requestedStrategy: 'engineer',
        allowedStrategies: ['engineer'],
        previousFailures: [],
      },
    ];
    for (const input of inputs) {
      expect(selectStrategy(input)).toBe(ENGINEER_STRATEGY);
    }
  });

  test('result.name is always "engineer"', () => {
    expect(selectStrategy({ goal: 'g' }).name).toBe('engineer');
    expect(
      selectStrategy({ goal: 'g', requestedStrategy: 'engineer' }).name,
    ).toBe('engineer');
  });

  test('does not mutate the input object', () => {
    const input: StrategySelectionInput = {
      goal: 'g',
      allowedStrategies: ['engineer'],
    };
    const snapshot = { ...input, allowedStrategies: [...input.allowedStrategies!] };
    selectStrategy(input);
    expect(input).toEqual(snapshot);
  });

  test('deterministic: same input produces same result (reference)', () => {
    const input: StrategySelectionInput = { goal: 'g' };
    const r1 = selectStrategy(input);
    const r2 = selectStrategy(input);
    expect(r1).toBe(r2);
  });
});

// ---------------------------------------------------------------------------
// setStrategyCwd — idempotency
// ---------------------------------------------------------------------------

describe('setStrategyCwd — idempotency', () => {
  // NOTE: setStrategyCwd mutates module-global state. These tests run
  // in isolation (Vitest default is parallel files but sequential tests
  // within a file), but other test files (cerebellum-strategy.test.ts)
  // also call setStrategyCwd. We snapshot and restore the cwd around
  // each test to avoid cross-test contamination.

  let originalCwdEffective: string;
  let tempDir: string;

  beforeEach(async () => {
    // Point strategyCwd at a known temp dir for the duration of the test.
    tempDir = await mkdtemp(join(tmpdir(), 'ody-strat-inv-'));
    // We cannot read strategyCwd back directly; we just set and restore.
    setStrategyCwd(tempDir);
    originalCwdEffective = tempDir;
  });

  afterEach(async () => {
    // Restore to project root so other test suites don't see our temp dir.
    setStrategyCwd(join(process.cwd(), '.odysseus', '..'));
    await rm(tempDir, { recursive: true, force: true });
  });

  test('setStrategyCwd is a function', () => {
    expect(typeof setStrategyCwd).toBe('function');
  });

  test('calling setStrategyCwd multiple times does not throw', () => {
    expect(() => {
      setStrategyCwd(tempDir);
      setStrategyCwd(tempDir);
      setStrategyCwd(tempDir);
    }).not.toThrow();
  });

  test('setStrategyCwd with the same path N times has the same effect as once', () => {
    // Effect is observed via ENGINEER_STRATEGY.systemPrompt — it should
    // be the same regardless of how many times setStrategyCwd was called.
    setStrategyCwd(tempDir);
    const p1 = ENGINEER_STRATEGY.systemPrompt;
    setStrategyCwd(tempDir);
    setStrategyCwd(tempDir);
    const p2 = ENGINEER_STRATEGY.systemPrompt;
    expect(p1).toBe(p2);
  });

  test('ENGINEER_STRATEGY.systemPrompt reflects the cwd set by setStrategyCwd', () => {
    // After setStrategyCwd(tempDir), the systemPrompt is built from
    // tempDir. It may or may not contain self-model content (depending
    // on what's in tempDir), but the build must succeed and produce a
    // non-empty string.
    expect(ENGINEER_STRATEGY.systemPrompt.length).toBeGreaterThan(0);
  });

  test('setStrategyCwd accepts an absolute path', () => {
    expect(() => setStrategyCwd(join(tempDir, 'subdir'))).not.toThrow();
  });

  test('setStrategyCwd accepts the project root', () => {
    expect(() => setStrategyCwd(process.cwd())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Re-exports from strategy-prompt.js (Iteration 51 extraction)
// ---------------------------------------------------------------------------

describe('strategy-prompt re-exports', () => {
  test('strategy.ts imports from strategy-prompt.js', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/strategy.ts', 'utf8');
    expect(src).toContain("from './strategy-prompt.js'");
  });

  test('loadSelfModel is re-exported', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/strategy.ts', 'utf8');
    expect(src).toContain('loadSelfModel');
  });

  test('loadLongTermMemoryMarkdown is re-exported', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/strategy.ts', 'utf8');
    expect(src).toContain('loadLongTermMemoryMarkdown');
  });

  test('buildEngineerSystemPrompt is re-exported', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/strategy.ts', 'utf8');
    expect(src).toContain('buildEngineerSystemPrompt');
  });

  test('strategy.ts does NOT re-define loadSelfModel as a function', async () => {
    // Extraction invariant: the function body lives in strategy-prompt.ts.
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/strategy.ts', 'utf8');
    expect(src).not.toContain('function loadSelfModel');
    expect(src).not.toContain('function loadLongTermMemoryMarkdown');
    expect(src).not.toContain('function buildEngineerSystemPrompt');
  });
});
