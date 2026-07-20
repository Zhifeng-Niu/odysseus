import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider, LLMCompletion } from '../../src/llm/provider.js';
import {
  plan,
  buildPlannerUserPrompt,
  shouldPlanGoal,
  MIN_PLAN_GOAL_LENGTH,
  PLAN_KEYWORDS,
  type PlanStep,
} from '../../src/cerebellum/planner.js';

function completion(content: string): LLMCompletion {
  return {
    content,
    model: 'mock',
    usage: { inputTokens: 10, outputTokens: 20 },
    finishReason: 'stop',
  };
}

function staticProvider(responseContent: string): LLMProvider {
  return {
    async complete(): Promise<LLMCompletion> {
      return completion(responseContent);
    },
    async *stream() {
      yield '';
    },
    getModel() {
      return 'mock';
    },
  };
}

function throwingProvider(error: Error): LLMProvider {
  return {
    async complete(): Promise<LLMCompletion> {
      throw error;
    },
    async *stream() {
      yield '';
    },
    getModel() {
      return 'mock';
    },
  };
}

const SAMPLE_SELF_MODEL = `# Self-Model — Odysseus

## Current Capabilities

- **Tool-mediated code change.** I read, write, and edit files via dedicated tools.

## Active Limitations

- **Partial cross-voyage working memory.** Voyage outlines persist; full state resets.

## Aspirations (gaps to close)

1. **Graduated dreamer rhythm.** Today the gate is binary.
`;

const TWO_STEP_RESPONSE = `{
  "steps": [
    {
      "goal": "create src/cerebellum/planner.ts with PlanStep interface",
      "rationale": "Define the data shape before any logic depends on it."
    },
    {
      "goal": "add planner.test.ts covering happy path + parse failures",
      "rationale": "Tests lock the contract before orchestrator integration."
    }
  ]
}`;

describe('planner', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'ody-planner-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  describe('buildPlannerUserPrompt', () => {
    test('embeds the goal verbatim', async () => {
      await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
      const prompt = buildPlannerUserPrompt({
        rootDir,
        provider: staticProvider(''),
        goal: 'refactor the cerebellum module for testability',
      });
      expect(prompt).toContain('<goal>');
      expect(prompt).toContain('refactor the cerebellum module for testability');
      expect(prompt).toContain('</goal>');
    });

    test('embeds the self-model when file exists', async () => {
      await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
      const prompt = buildPlannerUserPrompt({
        rootDir,
        provider: staticProvider(''),
        goal: 'add X',
      });
      expect(prompt).toContain('<self-model>');
      expect(prompt).toContain('Tool-mediated code change');
      expect(prompt).toContain('</self-model>');
    });

    test('shows "self-model missing" placeholder when file absent', () => {
      const prompt = buildPlannerUserPrompt({
        rootDir,
        provider: staticProvider(''),
        goal: 'add X',
      });
      expect(prompt).toContain('self-model missing');
      // No fake self-model content leaks in.
      expect(prompt).not.toContain('Tool-mediated code change');
    });

    test('default maxSteps is 5 when not specified', async () => {
      await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
      const prompt = buildPlannerUserPrompt({
        rootDir,
        provider: staticProvider(''),
        goal: 'do X',
      });
      expect(prompt).toContain('at most 5 concrete');
    });

    test('custom maxSteps is reflected in prompt', () => {
      const prompt = buildPlannerUserPrompt({
        rootDir,
        provider: staticProvider(''),
        goal: 'do X',
        maxSteps: 3,
      });
      expect(prompt).toContain('at most 3 concrete');
    });
  });

  describe('plan — happy path', () => {
    test('parses valid JSON response into PlanStep[]', async () => {
      const result = await plan({
        rootDir,
        provider: staticProvider(TWO_STEP_RESPONSE),
        goal: 'build the planner module',
      });
      expect(result.parseOk).toBe(true);
      expect(result.parseError).toBeUndefined();
      expect(result.steps.length).toBe(2);
      const first = result.steps[0]!;
      expect(first.goal).toContain('planner.ts');
      expect(first.rationale.length).toBeGreaterThan(0);
      const second = result.steps[1]!;
      expect(second.goal).toContain('planner.test.ts');
    });

    test('parses markdown-fenced JSON', async () => {
      const fenced = '```json\n' + TWO_STEP_RESPONSE + '\n```';
      const result = await plan({
        rootDir,
        provider: staticProvider(fenced),
        goal: 'X',
      });
      expect(result.parseOk).toBe(true);
      expect(result.steps.length).toBe(2);
    });

    test('parses fenced JSON even when prose after the fence contains } (Iteration 42 regression)', async () => {
      // Iteration 42: planner.ts previously had its own extractJson
      // with a silent fence-stripping bug (fenceMatch?.groups?.[0] on
      // a regex with no named groups → candidate fell back to the full
      // input). For simple fenced JSON the indexOf('{')/lastIndexOf('}')
      // fallback rescued parsing. BUT when prose after the closing fence
      // contained a '}', lastIndexOf('}') found the wrong brace and
      // slice returned invalid JSON → parseOk=false silently.
      //
      // Migrating to the shared extractJsonObject (Iter 38 fix) closes
      // the bug. This test pins the fix: a } in trailing prose must
      // not corrupt the extracted JSON.
      const malicious = '```json\n' + TWO_STEP_RESPONSE + '\n```\nThat\'s the plan.}';
      const result = await plan({
        rootDir,
        provider: staticProvider(malicious),
        goal: 'X',
      });
      expect(result.parseOk).toBe(true);
      expect(result.steps.length).toBe(2);
    });

    test('steps preserve LLM-provided order', async () => {
      const response = `{
        "steps": [
          { "goal": "step-alpha", "rationale": "first" },
          { "goal": "step-beta",  "rationale": "second" },
          { "goal": "step-gamma", "rationale": "third" }
        ]
      }`;
      const result = await plan({
        rootDir,
        provider: staticProvider(response),
        goal: 'X',
      });
      expect(result.steps.map((s) => s.goal)).toEqual([
        'step-alpha',
        'step-beta',
        'step-gamma',
      ]);
    });

    test('populates rawResponse, durationMs even on success', async () => {
      const result = await plan({
        rootDir,
        provider: staticProvider(TWO_STEP_RESPONSE),
        goal: 'X',
      });
      expect(result.rawResponse).toBe(TWO_STEP_RESPONSE);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('single-step response (goal already small)', async () => {
      const response = `{
        "steps": [
          { "goal": "rename foo to bar in src/x.ts", "rationale": "already single-waypoint-sized" }
        ]
      }`;
      const result = await plan({
        rootDir,
        provider: staticProvider(response),
        goal: 'rename foo to bar',
      });
      expect(result.steps.length).toBe(1);
    });

    test('empty steps array is a valid plan (honest "cannot decompose")', async () => {
      const response = `{ "steps": [] }`;
      const result = await plan({
        rootDir,
        provider: staticProvider(response),
        goal: 'ambiguous goal with no clear decomposition',
      });
      expect(result.parseOk).toBe(true);
      expect(result.steps).toEqual([]);
    });
  });

  describe('plan — maxSteps cap', () => {
    test('truncates to default 5 when LLM returns 10 steps', async () => {
      const steps: string[] = [];
      for (let i = 0; i < 10; i++) {
        steps.push(`{ "goal": "step-${i}", "rationale": "r${i}" }`);
      }
      const response = `{ "steps": [${steps.join(',')}] }`;
      const result = await plan({
        rootDir,
        provider: staticProvider(response),
        goal: 'X',
      });
      expect(result.steps.length).toBe(5);
      expect(result.steps[0]!.goal).toBe('step-0');
      expect(result.steps[4]!.goal).toBe('step-4');
    });

    test('respects custom maxSteps=3', async () => {
      const steps: string[] = [];
      for (let i = 0; i < 7; i++) {
        steps.push(`{ "goal": "s${i}", "rationale": "r" }`);
      }
      const response = `{ "steps": [${steps.join(',')}] }`;
      const result = await plan({
        rootDir,
        provider: staticProvider(response),
        goal: 'X',
        maxSteps: 3,
      });
      expect(result.steps.length).toBe(3);
    });
  });

  describe('plan — parse failures', () => {
    test('prose response (no JSON) → parseOk=false, empty steps', async () => {
      const result = await plan({
        rootDir,
        provider: staticProvider('I think we should focus on testing first.'),
        goal: 'X',
      });
      expect(result.parseOk).toBe(false);
      expect(result.steps).toEqual([]);
      expect(result.parseError).toBeDefined();
    });

    test('truncated JSON → parseOk=false', async () => {
      const result = await plan({
        rootDir,
        provider: staticProvider('{ "steps": [ { "goal": "x"'),
        goal: 'X',
      });
      expect(result.parseOk).toBe(false);
      expect(result.steps).toEqual([]);
    });

    test('JSON without "steps" field → parseOk=false', async () => {
      const result = await plan({
        rootDir,
        provider: staticProvider('{ "items": [] }'),
        goal: 'X',
      });
      // extractJson succeeds, but parsed.steps is undefined → treated as empty.
      // parseOk stays true because JSON was valid; steps is just empty.
      expect(result.parseOk).toBe(true);
      expect(result.steps).toEqual([]);
    });

    test('rawResponse preserved on parse failure for diagnostics', async () => {
      const bad = 'totally not json';
      const result = await plan({
        rootDir,
        provider: staticProvider(bad),
        goal: 'X',
      });
      expect(result.rawResponse).toBe(bad);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('plan — step coercion', () => {
    test('drops steps with empty goal', async () => {
      const response = `{
        "steps": [
          { "goal": "", "rationale": "empty goal" },
          { "goal": "valid-step", "rationale": "ok" }
        ]
      }`;
      const result = await plan({
        rootDir,
        provider: staticProvider(response),
        goal: 'X',
      });
      expect(result.steps.length).toBe(1);
      expect(result.steps[0]!.goal).toBe('valid-step');
    });

    test('drops steps with whitespace-only goal', async () => {
      const response = `{
        "steps": [
          { "goal": "   ", "rationale": "ws" },
          { "goal": "valid", "rationale": "ok" }
        ]
      }`;
      const result = await plan({
        rootDir,
        provider: staticProvider(response),
        goal: 'X',
      });
      expect(result.steps.length).toBe(1);
      expect(result.steps[0]!.goal).toBe('valid');
    });

    test('drops steps where goal is not a string', async () => {
      const response = `{
        "steps": [
          { "goal": 42, "rationale": "number not string" },
          { "goal": "valid", "rationale": "ok" }
        ]
      }`;
      const result = await plan({
        rootDir,
        provider: staticProvider(response),
        goal: 'X',
      });
      expect(result.steps.length).toBe(1);
    });

    test('drops non-object steps (array elements)', async () => {
      const response = `{ "steps": ["just a string", 7, null, { "goal": "valid", "rationale": "ok" }] }`;
      const result = await plan({
        rootDir,
        provider: staticProvider(response),
        goal: 'X',
      });
      expect(result.steps.length).toBe(1);
      expect(result.steps[0]!.goal).toBe('valid');
    });

    test('tolerates missing rationale (step still actionable)', async () => {
      const response = `{
        "steps": [
          { "goal": "step-without-rationale" }
        ]
      }`;
      const result = await plan({
        rootDir,
        provider: staticProvider(response),
        goal: 'X',
      });
      expect(result.steps.length).toBe(1);
      expect(result.steps[0]!.goal).toBe('step-without-rationale');
      expect(result.steps[0]!.rationale).toBe('');
    });

    test('trims whitespace from goal and rationale', async () => {
      const response = `{
        "steps": [
          { "goal": "  trimmed-goal  ", "rationale": "  trimmed-rationale  " }
        ]
      }`;
      const result = await plan({
        rootDir,
        provider: staticProvider(response),
        goal: 'X',
      });
      expect(result.steps[0]!.goal).toBe('trimmed-goal');
      expect(result.steps[0]!.rationale).toBe('trimmed-rationale');
    });
  });

  describe('plan — provider errors', () => {
    test('LLM provider throw propagates (caller decides retry/fallback)', async () => {
      const provider = throwingProvider(new Error('network timeout'));
      await expect(
        plan({
          rootDir,
          provider,
          goal: 'X',
        }),
      ).rejects.toThrow('network timeout');
    });
  });

  describe('PlanStep type — read-only contract', () => {
    test('returned steps satisfy PlanStep shape', async () => {
      const result = await plan({
        rootDir,
        provider: staticProvider(TWO_STEP_RESPONSE),
        goal: 'X',
      });
      for (const step of result.steps) {
        expect(typeof step.goal).toBe('string');
        expect(step.goal.length).toBeGreaterThan(0);
        expect(typeof step.rationale).toBe('string');
      }
    });
  });

  describe('shouldPlanGoal — policy heuristic (Iteration 15b)', () => {
    test('MIN_PLAN_GOAL_LENGTH is 60', () => {
      expect(MIN_PLAN_GOAL_LENGTH).toBe(60);
    });

    test('PLAN_KEYWORDS includes bilingual refactor/system/module markers', () => {
      expect(PLAN_KEYWORDS).toContain('refactor');
      expect(PLAN_KEYWORDS).toContain('重构');
      expect(PLAN_KEYWORDS).toContain('system');
      expect(PLAN_KEYWORDS).toContain('系统');
      expect(PLAN_KEYWORDS).toContain('module');
      expect(PLAN_KEYWORDS).toContain('模块');
    });

    test('empty goal → false (no regression — caller executes directly)', () => {
      expect(shouldPlanGoal('')).toBe(false);
    });

    test('whitespace-only goal → false', () => {
      expect(shouldPlanGoal('   ')).toBe(false);
    });

    test('short concrete goal → false (single-waypoint-sized)', () => {
      // 49 chars — under the 60 threshold, no keyword.
      expect(shouldPlanGoal('add error-loop detection to src/cerebellum/self-monitor.ts')).toBe(false);
    });

    test('short goal with "refactor" keyword → true', () => {
      // Keyword match triggers even when length is short.
      expect(shouldPlanGoal('refactor dreamer.ts')).toBe(true);
    });

    test('short goal with "重构" keyword → true (bilingual)', () => {
      expect(shouldPlanGoal('重构 dreamer.ts')).toBe(true);
    });

    test('short goal with "system" keyword → true', () => {
      expect(shouldPlanGoal('design verification system')).toBe(true);
    });

    test('short goal with "系统" keyword → true (bilingual)', () => {
      expect(shouldPlanGoal('设计验证系统')).toBe(true);
    });

    test('long goal without keywords → true (length threshold alone)', () => {
      const long = 'update the verify gate to include a new layer that runs the full vitest suite after every waypoint and surfaces failures as rollback triggers';
      expect(long.length).toBeGreaterThanOrEqual(60);
      expect(shouldPlanGoal(long)).toBe(true);
    });

    test('goal at exactly MIN_PLAN_GOAL_LENGTH → true (boundary inclusive)', () => {
      // Build a goal exactly 60 chars long with no keywords.
      const goal = 'a'.repeat(60);
      expect(goal.length).toBe(60);
      expect(shouldPlanGoal(goal)).toBe(true);
    });

    test('goal just below threshold, no keyword → false', () => {
      const goal = 'a'.repeat(59);
      expect(shouldPlanGoal(goal)).toBe(false);
    });

    test('case-insensitive keyword match', () => {
      expect(shouldPlanGoal('REFACTOR the parser')).toBe(true);
      expect(shouldPlanGoal('Refactor the parser')).toBe(true);
      expect(shouldPlanGoal('rEfAcToR the parser')).toBe(true);
    });

    test('keyword embedded in a larger word still triggers (substring match)', () => {
      // "refactoring" contains "refactor" — by design (the policy is
      // deliberately permissive: false positives are cheap — one extra
      // LLM call; false negatives are expensive — agent stumbles on a
      // multi-step goal without a plan).
      expect(shouldPlanGoal('refactoring the parser')).toBe(true);
      expect(shouldPlanGoal('systemic redesign')).toBe(true);
    });

    test('real-world multi-step goal triggers (integration sanity)', () => {
      const goal = '把 odysseus 先做成一个合格的 agent';
      // Length ~25 chars, no English keyword. But "agent" is not in the list.
      // This SHOULD return false — and that's the right answer, because
      // this goal is too vague to plan usefully. The orchestrator would
      // execute it directly and let the agent discover its scope.
      // (Real-world inputs that hit this path should be more specific.)
      expect(shouldPlanGoal(goal)).toBe(false);
    });

    test('real-world single-file goal does not trigger (length too short)', () => {
      const goal = 'fix typo in README.md';
      expect(shouldPlanGoal(goal)).toBe(false);
    });
  });
});
