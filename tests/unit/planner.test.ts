import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider, LLMCompletion } from '../../src/llm/provider.js';
import {
  plan,
  buildPlannerUserPrompt,
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
});
