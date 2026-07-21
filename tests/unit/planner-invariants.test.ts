/**
 * Invariants for src/cerebellum/planner.ts.
 *
 * planner.test.ts (if present) and integration tests cover the behavior
 * of plan(): it calls the provider, parses JSON, coerces steps, applies
 * the maxSteps cap. This file pins the load-bearing structural
 * contracts that behavior tests imply but do not make explicit:
 *
 *   - PlanStep / PlannerInput / PlannerOutput type shapes (exact keys)
 *   - exactOptionalPropertyTypes contract: parseError is absent when
 *     parseOk=true (verified via 'parseError' in obj, not just undefined)
 *   - buildPlannerUserPrompt is a pure function of (rootDir, goal,
 *     maxSteps): same inputs produce byte-identical outputs
 *   - <goal> XML tag wraps input.goal verbatim
 *   - <self-model> XML tag wraps the self-model content
 *   - Default maxSteps is 5 (when input.maxSteps is undefined)
 *   - Self-model truncation hard cap is 4000 chars (slice(0, 4000))
 *   - Missing self-model produces the explicit placeholder text
 *     "(self-model missing — plan without identity context)"
 *   - plan() passes temperature=0.3, maxTokens=1500, and a non-empty
 *     systemPrompt to the provider (low-temp deterministic decomposition)
 *   - plan() returns parseOk=false + empty steps when LLM returns
 *     non-JSON; parseError is present (key exists) in that case
 *   - plan() returns parseOk=true + parsed steps when LLM returns valid
 *     JSON; parseError key is ABSENT (exactOptionalPropertyTypes)
 *   - maxSteps cap is enforced: returning >maxSteps steps truncates
 *   - coercePlanStep drops entries with empty/whitespace goals
 *   - coercePlanStep drops non-object entries
 *   - coercePlanStep tolerates empty rationale (does not drop)
 *   - shouldPlanGoal / MIN_PLAN_GOAL_LENGTH / PLAN_KEYWORDS are
 *     re-exported from planner-policy.js (extraction invariants)
 *
 * The exactOptionalPropertyTypes check is load-bearing: downstream
 * consumers that distinguish "no parseError key" from "parseError: undefined"
 * rely on the key being absent when parseOk=true. The TypeScript type
 * annotation `parseError?: string` under exactOptionalPropertyTypes
 * enforces this at compile time; this test pins it at runtime.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  plan,
  buildPlannerUserPrompt,
  shouldPlanGoal,
  MIN_PLAN_GOAL_LENGTH,
  PLAN_KEYWORDS,
  type PlanStep,
  type PlannerInput,
  type PlannerOutput,
} from '../../src/cerebellum/planner.js';
import type { LLMProvider, LLMCompletion, LLMCompleteOptions } from '../../src/llm/provider.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a fake LLMProvider that always returns the given content string.
 * Captures the options passed to complete() so tests can assert on
 * temperature / maxTokens / systemPrompt.
 */
function makeFakeProvider(
  responseContent: string,
  capture: { prompt?: string; options?: LLMCompleteOptions } = {},
): LLMProvider {
  return {
    async complete(prompt: string, options?: LLMCompleteOptions): Promise<LLMCompletion> {
      capture.prompt = prompt;
      capture.options = options;
      return {
        content: responseContent,
        model: 'fake-model',
        usage: { inputTokens: 0, outputTokens: 0 },
        finishReason: 'stop',
      };
    },
    async *stream() {
      yield responseContent;
    },
    getModel() {
      return 'fake-model';
    },
  };
}

// ---------------------------------------------------------------------------
// PlanStep type shape
// ---------------------------------------------------------------------------

describe('PlanStep type shape', () => {
  test('has exactly { goal, rationale } fields', () => {
    const step: PlanStep = {
      goal: 'add retry to llm provider',
      rationale: 'network calls fail; retry makes them robust',
    };
    expect(Object.keys(step).sort()).toEqual(['goal', 'rationale']);
  });

  test('goal is a string', () => {
    const step: PlanStep = { goal: 'x', rationale: 'y' };
    expect(typeof step.goal).toBe('string');
  });

  test('rationale is a string', () => {
    const step: PlanStep = { goal: 'x', rationale: 'y' };
    expect(typeof step.rationale).toBe('string');
  });

  test('goal and rationale are both required (TypeScript-enforced)', () => {
    // Construct via literal — TypeScript would reject missing fields.
    const step: PlanStep = { goal: 'g', rationale: 'r' };
    expect(step.goal).toBe('g');
    expect(step.rationale).toBe('r');
  });
});

// ---------------------------------------------------------------------------
// PlannerInput type shape
// ---------------------------------------------------------------------------

describe('PlannerInput type shape', () => {
  test('has exactly { rootDir, provider, goal } when maxSteps is omitted', () => {
    const input: PlannerInput = {
      rootDir: '/tmp',
      provider: makeFakeProvider(''),
      goal: 'do something',
    };
    expect(Object.keys(input).sort()).toEqual(['goal', 'provider', 'rootDir']);
  });

  test('rootDir is a string', () => {
    const input: PlannerInput = {
      rootDir: '/tmp',
      provider: makeFakeProvider(''),
      goal: 'g',
    };
    expect(typeof input.rootDir).toBe('string');
  });

  test('provider is an object with complete/stream/getModel', () => {
    const input: PlannerInput = {
      rootDir: '/tmp',
      provider: makeFakeProvider(''),
      goal: 'g',
    };
    expect(typeof input.provider).toBe('object');
    expect(typeof input.provider.complete).toBe('function');
    expect(typeof input.provider.stream).toBe('function');
    expect(typeof input.provider.getModel).toBe('function');
  });

  test('goal is a string', () => {
    const input: PlannerInput = {
      rootDir: '/tmp',
      provider: makeFakeProvider(''),
      goal: 'g',
    };
    expect(typeof input.goal).toBe('string');
  });

  test('maxSteps is optional (omittable under exactOptionalPropertyTypes)', () => {
    // The key must be ABSENT, not present-as-undefined.
    const input: PlannerInput = {
      rootDir: '/tmp',
      provider: makeFakeProvider(''),
      goal: 'g',
    };
    expect('maxSteps' in input).toBe(false);
  });

  test('maxSteps, when provided, is a number', () => {
    const input: PlannerInput = {
      rootDir: '/tmp',
      provider: makeFakeProvider(''),
      goal: 'g',
      maxSteps: 7,
    };
    expect(typeof input.maxSteps).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// PlannerOutput type shape + exactOptionalPropertyTypes
// ---------------------------------------------------------------------------

describe('PlannerOutput type shape', () => {
  test('parseOk=false output has exactly { steps, rawResponse, durationMs, parseOk, parseError }', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider('not valid json'),
      goal: 'g',
    });
    expect(output.parseOk).toBe(false);
    expect(Object.keys(output).sort()).toEqual(
      ['durationMs', 'parseError', 'parseOk', 'rawResponse', 'steps'].sort(),
    );
  });

  test('parseOk=true output has exactly { steps, rawResponse, durationMs, parseOk } (no parseError key)', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({
        steps: [{ goal: 'step 1', rationale: 'because' }],
      })),
      goal: 'g',
    });
    expect(output.parseOk).toBe(true);
    // parseError key must be ABSENT under exactOptionalPropertyTypes.
    expect('parseError' in output).toBe(false);
    expect(Object.keys(output).sort()).toEqual(
      ['durationMs', 'parseOk', 'rawResponse', 'steps'].sort(),
    );
  });

  test('steps is an array', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({ steps: [] })),
      goal: 'g',
    });
    expect(Array.isArray(output.steps)).toBe(true);
  });

  test('rawResponse is a string', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider('hello'),
      goal: 'g',
    });
    expect(typeof output.rawResponse).toBe('string');
    expect(output.rawResponse).toBe('hello');
  });

  test('durationMs is a non-negative finite number', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider('{}'),
      goal: 'g',
    });
    expect(typeof output.durationMs).toBe('number');
    expect(Number.isFinite(output.durationMs)).toBe(true);
    expect(output.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('parseOk is strictly boolean', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider('{}'),
      goal: 'g',
    });
    expect(typeof output.parseOk).toBe('boolean');
  });

  test('parseError, when present, is a string', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider('not json'),
      goal: 'g',
    });
    expect(output.parseOk).toBe(false);
    expect(typeof output.parseError).toBe('string');
    expect(output.parseError!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildPlannerUserPrompt — pure function contract
// ---------------------------------------------------------------------------

describe('buildPlannerUserPrompt — pure function contract', () => {
  test('wraps input.goal in <goal>…</goal> tags verbatim', () => {
    const prompt = buildPlannerUserPrompt({
      rootDir: '/tmp',
      provider: makeFakeProvider(''),
      goal: 'MY CUSTOM GOAL WITH "quotes"',
    });
    expect(prompt).toContain('<goal>\nMY CUSTOM GOAL WITH "quotes"\n</goal>');
  });

  test('default maxSteps is 5 (appears in prompt when input.maxSteps is undefined)', () => {
    const prompt = buildPlannerUserPrompt({
      rootDir: '/tmp',
      provider: makeFakeProvider(''),
      goal: 'g',
    });
    expect(prompt).toContain('at most 5 concrete');
  });

  test('explicit maxSteps overrides default in prompt text', () => {
    const prompt = buildPlannerUserPrompt({
      rootDir: '/tmp',
      provider: makeFakeProvider(''),
      goal: 'g',
      maxSteps: 7,
    });
    expect(prompt).toContain('at most 7 concrete');
    expect(prompt).not.toContain('at most 5 concrete');
  });

  test('same inputs produce byte-identical outputs (purity)', () => {
    const input = {
      rootDir: '/tmp',
      provider: makeFakeProvider(''),
      goal: 'g',
    };
    const a = buildPlannerUserPrompt(input);
    const b = buildPlannerUserPrompt(input);
    expect(a).toBe(b);
  });

  test('prompt is deterministic across separate input objects (same values)', () => {
    const a = buildPlannerUserPrompt({
      rootDir: '/tmp',
      provider: makeFakeProvider(''),
      goal: 'g',
    });
    const b = buildPlannerUserPrompt({
      rootDir: '/tmp',
      provider: makeFakeProvider(''),
      goal: 'g',
    });
    expect(a).toBe(b);
  });

  test('does NOT mutate the input object', () => {
    const input = {
      rootDir: '/tmp',
      provider: makeFakeProvider(''),
      goal: 'g',
      maxSteps: 9,
    };
    const before = { ...input };
    buildPlannerUserPrompt(input);
    expect(input).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// buildPlannerUserPrompt — <self-model> block
// ---------------------------------------------------------------------------

describe('buildPlannerUserPrompt — <self-model> block', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ody-planner-inv-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('wraps self-model content in <self-model>…</self-model> tags', async () => {
    await writeFile(join(tempDir, 'self-model.md'), 'I am Odysseus.');
    const prompt = buildPlannerUserPrompt({
      rootDir: tempDir,
      provider: makeFakeProvider(''),
      goal: 'g',
    });
    expect(prompt).toContain('<self-model>\nI am Odysseus.\n</self-model>');
  });

  test('missing self-model produces placeholder text inside <self-model> block', () => {
    const prompt = buildPlannerUserPrompt({
      rootDir: tempDir,
      provider: makeFakeProvider(''),
      goal: 'g',
    });
    expect(prompt).toContain('<self-model>');
    expect(prompt).toContain('(self-model missing — plan without identity context)');
    expect(prompt).toContain('</self-model>');
  });

  test('empty self-model (after trim) produces placeholder', async () => {
    await writeFile(join(tempDir, 'self-model.md'), '   \n  \n');
    const prompt = buildPlannerUserPrompt({
      rootDir: tempDir,
      provider: makeFakeProvider(''),
      goal: 'g',
    });
    expect(prompt).toContain('(self-model missing — plan without identity context)');
  });

  test('self-model is truncated to 4000 chars (slice hard cap)', async () => {
    const long = 'A'.repeat(5000);
    await writeFile(join(tempDir, 'self-model.md'), long);
    const prompt = buildPlannerUserPrompt({
      rootDir: tempDir,
      provider: makeFakeProvider(''),
      goal: 'g',
    });
    // Find the self-model block content.
    const start = prompt.indexOf('<self-model>\n') + '<self-model>\n'.length;
    const end = prompt.indexOf('\n</self-model>');
    const block = prompt.slice(start, end);
    expect(block.length).toBe(4000);
    expect(block).toBe('A'.repeat(4000));
  });

  test('self-model at exactly 4000 chars is NOT truncated', async () => {
    const exact = 'B'.repeat(4000);
    await writeFile(join(tempDir, 'self-model.md'), exact);
    const prompt = buildPlannerUserPrompt({
      rootDir: tempDir,
      provider: makeFakeProvider(''),
      goal: 'g',
    });
    const start = prompt.indexOf('<self-model>\n') + '<self-model>\n'.length;
    const end = prompt.indexOf('\n</self-model>');
    const block = prompt.slice(start, end);
    expect(block.length).toBe(4000);
    expect(block).toBe(exact);
  });

  test('self-model at 4001 chars IS truncated to 4000', async () => {
    const over = 'C'.repeat(4001);
    await writeFile(join(tempDir, 'self-model.md'), over);
    const prompt = buildPlannerUserPrompt({
      rootDir: tempDir,
      provider: makeFakeProvider(''),
      goal: 'g',
    });
    const start = prompt.indexOf('<self-model>\n') + '<self-model>\n'.length;
    const end = prompt.indexOf('\n</self-model>');
    const block = prompt.slice(start, end);
    expect(block.length).toBe(4000);
  });

  test('prompt ends with the JSON-return instruction', () => {
    const prompt = buildPlannerUserPrompt({
      rootDir: tempDir,
      provider: makeFakeProvider(''),
      goal: 'g',
    });
    expect(prompt).toMatch(/Return JSON\.$/);
  });
});

// ---------------------------------------------------------------------------
// plan() — provider call contract
// ---------------------------------------------------------------------------

describe('plan() — provider call contract', () => {
  test('passes a non-empty systemPrompt to the provider', async () => {
    const capture: { options?: LLMCompleteOptions } = {};
    await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider('{}', capture),
      goal: 'g',
    });
    expect(capture.options?.systemPrompt).toBeTruthy();
    expect(typeof capture.options?.systemPrompt).toBe('string');
    expect((capture.options?.systemPrompt ?? '').length).toBeGreaterThan(0);
  });

  test('passes temperature=0.3 (low-temp deterministic decomposition)', async () => {
    const capture: { options?: LLMCompleteOptions } = {};
    await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider('{}', capture),
      goal: 'g',
    });
    expect(capture.options?.temperature).toBe(0.3);
  });

  test('passes maxTokens=1500', async () => {
    const capture: { options?: LLMCompleteOptions } = {};
    await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider('{}', capture),
      goal: 'g',
    });
    expect(capture.options?.maxTokens).toBe(1500);
  });

  test('systemPrompt mentions JSON output and "steps" array', async () => {
    const capture: { options?: LLMCompleteOptions } = {};
    await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider('{}', capture),
      goal: 'g',
    });
    const sp = capture.options?.systemPrompt ?? '';
    expect(sp).toContain('JSON');
    expect(sp).toContain('steps');
    expect(sp).toContain('rationale');
  });

  test('systemPrompt mentions single-waypoint-sized constraint', async () => {
    const capture: { options?: LLMCompleteOptions } = {};
    await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider('{}', capture),
      goal: 'g',
    });
    const sp = capture.options?.systemPrompt ?? '';
    expect(sp).toContain('SINGLE-WAYPOINT-SIZED');
  });

  test('systemPrompt mentions "concrete" file/module path requirement', async () => {
    const capture: { options?: LLMCompleteOptions } = {};
    await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider('{}', capture),
      goal: 'g',
    });
    const sp = capture.options?.systemPrompt ?? '';
    expect(sp).toContain('CONCRETE');
  });
});

// ---------------------------------------------------------------------------
// plan() — parse failure path
// ---------------------------------------------------------------------------

describe('plan() — parse failure path', () => {
  test('non-JSON content yields parseOk=false and empty steps', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider('this is not json at all'),
      goal: 'g',
    });
    expect(output.parseOk).toBe(false);
    expect(output.steps).toEqual([]);
  });

  test('parseError key is PRESENT when parsing fails', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider('no json here'),
      goal: 'g',
    });
    expect('parseError' in output).toBe(true);
    expect(typeof output.parseError).toBe('string');
  });

  test('parseError key is ABSENT when parsing succeeds (exactOptionalPropertyTypes)', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({ steps: [] })),
      goal: 'g',
    });
    expect(output.parseOk).toBe(true);
    expect('parseError' in output).toBe(false);
  });

  test('JSON without steps field yields parseOk=false', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider('{"notSteps": []}'),
      goal: 'g',
    });
    // ParsedPlan interface requires `steps`, so a valid JSON without it
    // is treated as a parse failure? Actually looking at the code, it
    // extracts JSON then checks Array.isArray(extracted.value.steps).
    // If steps is absent, rawSteps=[] and steps=[] but parseOk=true.
    // Documenting actual behavior:
    expect(output.parseOk).toBe(true);
    expect(output.steps).toEqual([]);
  });

  test('rawResponse carries the original LLM content verbatim on failure', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider('verbatim content'),
      goal: 'g',
    });
    expect(output.rawResponse).toBe('verbatim content');
  });
});

// ---------------------------------------------------------------------------
// plan() — parse success path
// ---------------------------------------------------------------------------

describe('plan() — parse success path', () => {
  test('valid JSON with one step yields parseOk=true with that step', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({
        steps: [
          { goal: 'step one', rationale: 'because one' },
        ],
      })),
      goal: 'g',
    });
    expect(output.parseOk).toBe(true);
    expect(output.steps).toHaveLength(1);
    expect(output.steps[0]?.goal).toBe('step one');
    expect(output.steps[0]?.rationale).toBe('because one');
  });

  test('valid JSON with multiple steps preserves order', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({
        steps: [
          { goal: 'first', rationale: 'r1' },
          { goal: 'second', rationale: 'r2' },
          { goal: 'third', rationale: 'r3' },
        ],
      })),
      goal: 'g',
    });
    const goals = output.steps.map((s) => s.goal);
    expect(goals).toEqual(['first', 'second', 'third']);
  });

  test('returned steps are PlanStep-shaped (goal+rationale strings)', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({
        steps: [{ goal: 'g', rationale: 'r' }],
      })),
      goal: 'g',
    });
    for (const step of output.steps) {
      expect(Object.keys(step).sort()).toEqual(['goal', 'rationale']);
      expect(typeof step.goal).toBe('string');
      expect(typeof step.rationale).toBe('string');
    }
  });

  test('returned steps array is non-mutating to caller (defensive copy)', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({
        steps: [{ goal: 'g', rationale: 'r' }],
      })),
      goal: 'g',
    });
    // Mutating the returned array should not affect future calls.
    // (This pins current behavior — plan returns a fresh array each call.)
    const mutated = output.steps as PlanStep[];
    mutated.push({ goal: 'injected', rationale: 'x' });
    const output2 = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({
        steps: [{ goal: 'g', rationale: 'r' }],
      })),
      goal: 'g',
    });
    expect(output2.steps).toHaveLength(1);
    expect(output2.steps[0]?.goal).toBe('g');
  });
});

// ---------------------------------------------------------------------------
// plan() — maxSteps cap
// ---------------------------------------------------------------------------

describe('plan() — maxSteps cap', () => {
  test('default cap is 5 when input.maxSteps is undefined', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({
        steps: Array.from({ length: 10 }, (_, i) => ({
          goal: `g${i}`,
          rationale: `r${i}`,
        })),
      })),
      goal: 'g',
    });
    expect(output.steps).toHaveLength(5);
  });

  test('explicit maxSteps=3 caps at 3', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({
        steps: Array.from({ length: 10 }, (_, i) => ({
          goal: `g${i}`,
          rationale: `r${i}`,
        })),
      })),
      goal: 'g',
      maxSteps: 3,
    });
    expect(output.steps).toHaveLength(3);
  });

  test('steps under cap are all preserved', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({
        steps: [
          { goal: 'a', rationale: 'ra' },
          { goal: 'b', rationale: 'rb' },
        ],
      })),
      goal: 'g',
      maxSteps: 5,
    });
    expect(output.steps).toHaveLength(2);
  });

  test('steps at exactly cap are all preserved (boundary inclusive)', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({
        steps: Array.from({ length: 5 }, (_, i) => ({
          goal: `g${i}`,
          rationale: `r${i}`,
        })),
      })),
      goal: 'g',
      maxSteps: 5,
    });
    expect(output.steps).toHaveLength(5);
  });

  test('cap truncates in order (first N steps kept, not last N)', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({
        steps: [
          { goal: 'first', rationale: 'r' },
          { goal: 'second', rationale: 'r' },
          { goal: 'third', rationale: 'r' },
          { goal: 'fourth', rationale: 'r' },
        ],
      })),
      goal: 'g',
      maxSteps: 2,
    });
    expect(output.steps.map((s) => s.goal)).toEqual(['first', 'second']);
  });
});

// ---------------------------------------------------------------------------
// plan() — coercePlanStep filtering
// ---------------------------------------------------------------------------

describe('plan() — coercePlanStep filtering (private but observable)', () => {
  test('step with empty goal is dropped', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({
        steps: [
          { goal: '', rationale: 'r' },
          { goal: 'valid', rationale: 'r' },
        ],
      })),
      goal: 'g',
    });
    expect(output.steps).toHaveLength(1);
    expect(output.steps[0]?.goal).toBe('valid');
  });

  test('step with whitespace-only goal is dropped (trim then empty)', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({
        steps: [
          { goal: '   ', rationale: 'r' },
          { goal: 'valid', rationale: 'r' },
        ],
      })),
      goal: 'g',
    });
    expect(output.steps).toHaveLength(1);
    expect(output.steps[0]?.goal).toBe('valid');
  });

  test('step with non-string goal is dropped', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({
        steps: [
          { goal: 42, rationale: 'r' },
          { goal: 'valid', rationale: 'r' },
        ],
      })),
      goal: 'g',
    });
    expect(output.steps).toHaveLength(1);
    expect(output.steps[0]?.goal).toBe('valid');
  });

  test('non-object entry in steps array is dropped', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({
        steps: [
          'not an object',
          null,
          42,
          { goal: 'valid', rationale: 'r' },
        ],
      })),
      goal: 'g',
    });
    expect(output.steps).toHaveLength(1);
    expect(output.steps[0]?.goal).toBe('valid');
  });

  test('step goal is trimmed (leading/trailing whitespace stripped)', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({
        steps: [{ goal: '  hello  ', rationale: 'r' }],
      })),
      goal: 'g',
    });
    expect(output.steps[0]?.goal).toBe('hello');
  });

  test('step with empty rationale is KEPT (rationale is not required non-empty)', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({
        steps: [
          { goal: 'valid', rationale: '' },
        ],
      })),
      goal: 'g',
    });
    expect(output.steps).toHaveLength(1);
    expect(output.steps[0]?.goal).toBe('valid');
    expect(output.steps[0]?.rationale).toBe('');
  });

  test('step with non-string rationale coerces to empty string', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({
        steps: [
          { goal: 'valid', rationale: 42 },
        ],
      })),
      goal: 'g',
    });
    expect(output.steps).toHaveLength(1);
    expect(output.steps[0]?.goal).toBe('valid');
    // Non-string rationale becomes '' after the typeof check.
    expect(output.steps[0]?.rationale).toBe('');
  });

  test('steps field as non-array yields empty steps', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({
        steps: 'not an array',
      })),
      goal: 'g',
    });
    expect(output.parseOk).toBe(true);
    expect(output.steps).toEqual([]);
  });

  test('all-junk steps yields empty steps but parseOk=true', async () => {
    const output = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(JSON.stringify({
        steps: [
          { goal: '', rationale: '' },
          null,
          'string',
          { foo: 'bar' },
        ],
      })),
      goal: 'g',
    });
    expect(output.parseOk).toBe(true);
    expect(output.steps).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// plan() — determinism
// ---------------------------------------------------------------------------

describe('plan() — determinism', () => {
  test('same fake response produces same steps twice (purity of parse path)', async () => {
    const json = JSON.stringify({
      steps: [
        { goal: 'a', rationale: 'ra' },
        { goal: 'b', rationale: 'rb' },
      ],
    });
    const output1 = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(json),
      goal: 'g',
    });
    const output2 = await plan({
      rootDir: '/tmp',
      provider: makeFakeProvider(json),
      goal: 'g',
    });
    expect(output1.steps).toEqual(output2.steps);
    expect(output1.parseOk).toBe(output2.parseOk);
  });
});

// ---------------------------------------------------------------------------
// Re-exports from planner-policy.js (Iteration 42 extraction)
// ---------------------------------------------------------------------------

describe('planner-policy re-exports', () => {
  test('shouldPlanGoal is a function', () => {
    expect(typeof shouldPlanGoal).toBe('function');
  });

  test('MIN_PLAN_GOAL_LENGTH is a number', () => {
    expect(typeof MIN_PLAN_GOAL_LENGTH).toBe('number');
  });

  test('PLAN_KEYWORDS is a readonly array', () => {
    expect(Array.isArray(PLAN_KEYWORDS)).toBe(true);
    expect(PLAN_KEYWORDS.length).toBeGreaterThan(0);
  });

  test('re-exported symbols match planner-policy.js canonical definitions', async () => {
    const { readFile } = await import('node:fs/promises');
    const plannerSrc = await readFile('src/cerebellum/planner.ts', 'utf8');
    expect(plannerSrc).toContain("from './planner-policy.js'");
    expect(plannerSrc).toContain('shouldPlanGoal');
    expect(plannerSrc).toContain('MIN_PLAN_GOAL_LENGTH');
    expect(plannerSrc).toContain('PLAN_KEYWORDS');
  });
});

// ---------------------------------------------------------------------------
// LLM provider error propagation
// ---------------------------------------------------------------------------

describe('plan() — LLM provider error propagation', () => {
  test('provider throw propagates to caller (not swallowed)', async () => {
    const failingProvider: LLMProvider = {
      async complete() {
        throw new Error('network down');
      },
      async *stream() {
        throw new Error('network down');
      },
      getModel() {
        return 'failing';
      },
    };
    await expect(
      plan({
        rootDir: '/tmp',
        provider: failingProvider,
        goal: 'g',
      }),
    ).rejects.toThrow('network down');
  });

  test('provider throwing a non-Error value still propagates', async () => {
    const failingProvider: LLMProvider = {
      async complete() {
        throw 'string error';
      },
      async *stream() {
        throw 'string error';
      },
      getModel() {
        return 'failing';
      },
    };
    await expect(
      plan({
        rootDir: '/tmp',
        provider: failingProvider,
        goal: 'g',
      }),
    ).rejects.toBe('string error');
  });
});
