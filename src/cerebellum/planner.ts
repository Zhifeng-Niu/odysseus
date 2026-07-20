/**
 * Planner phase — decompose a complex goal into an ordered list of
 * single-waypoint-sized sub-tasks.
 *
 * Where curiosity and dreamer *generate* goals from internal state,
 * the planner *structures* a goal the user (or another origin) already
 * provided. It is the symmetric counterpart of the engineer's "pick the
 * most specific anchor" heuristic: instead of trusting the agent to
 * discover the right anchor mid-iteration, the planner surfaces the
 * full sequence up front so each waypoint starts with a clear, bounded
 * target.
 *
 * Planner is a PURE function (Iteration 15a): it accepts a goal and
 * returns steps. It does NOT enqueue the steps into the backlog — that
 * decision belongs to the orchestrator (Iteration 15b, pending). This
 * separation keeps the planner trivially testable and lets the
 * orchestrator decide policy (when to plan, where to insert the steps
 * in priority order, how to handle the original goal after planning).
 *
 * Failure modes mirror curiosity()/dream():
 *   - LLM throws  → rethrown (caller decides whether to abort voyage).
 *   - LLM returns malformed JSON → { parseOk: false, parseError }, empty steps.
 *   - LLM returns junk steps → silently dropped.
 *   - LLM returns > maxSteps → truncated to maxSteps.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LLMProvider } from '../llm/provider.js';

/**
 * One step in a multi-step plan. `goal` is a single-waypoint-sized
 * objective (the agent can pick an anchor file and ship a diff in one
 * wakeful execution); `rationale` explains why this step is necessary
 * in the larger plan. Both fields are required — a step without a
 * rationale is a TODO, not a plan.
 */
export interface PlanStep {
  readonly goal: string;
  readonly rationale: string;
}

/**
 * Input to the planner. `rootDir` is the memory root (self-model is
 * loaded from `{rootDir}/self-model.md`). `goal` is the objective to
 * decompose. `maxSteps` caps the plan size; the default of 5 keeps
 * plans bounded — if a goal needs more than 5 sequential waypoints,
 * it should be split at a higher level, not flattened into a 10-step
 * list the agent will lose track of.
 */
export interface PlannerInput {
  readonly rootDir: string;
  readonly provider: LLMProvider;
  readonly goal: string;
  readonly maxSteps?: number;
}

/**
 * Result of a planning pass. `parseOk` is false when the LLM returned
 * non-JSON or JSON missing the `steps` field; in that case `steps` is
 * empty and `parseError` carries the diagnosis. The caller decides
 * whether to fall back to executing the original goal directly or to
 * surface the failure.
 */
export interface PlannerOutput {
  readonly steps: readonly PlanStep[];
  readonly rawResponse: string;
  readonly durationMs: number;
  readonly parseOk: boolean;
  readonly parseError?: string;
}

interface ParsedPlan {
  steps?: unknown;
}

const PLANNER_SYSTEM_PROMPT = `You are Odysseus in a planning state.

Your job: take a goal and break it into an ordered list of sub-tasks that the engineer can execute one at a time, each in a single waypoint.

You will receive:
- <goal>: the objective to decompose.
- <self-model>: your persistent identity, current capabilities, and active limitations. Use these to ground the plan in what already exists — don't propose steps that conflict with stated capabilities.

Your output must be strict JSON:

\`\`\`json
{
  "steps": [
    {
      "goal": "<verb + specific change + file/module path>",
      "rationale": "<1 sentence — why this step is necessary and how it connects to the next>"
    }
  ]
}
\`\`\`

Rules:
- Each step must be CONCRETE: name a specific file or module. The engineer
  must be able to pick an anchor without further clarification.
- Each step must be SINGLE-WAYPOINT-SIZED: one focused change, verifiable
  via tests or typecheck. If a step would touch 5+ files, split it.
- Order matters: step N+1 must be doable after step N ships. The plan is a
  sequence, not a brainstorm.
- Maximum step count is given in the input (default 5). Never exceed it.
- If the original goal is already single-waypoint-sized, return exactly 1
  step that restates the goal with a concrete file target. Do not pad.
- If you genuinely cannot decompose (insufficient context, ambiguous goal),
  return an empty steps array. An honest "I can't plan this" is better
  than a fabricated plan the engineer will stumble over.
- Goals must follow the same shape as curiosity/waypoint goals:
    GOOD: "add timing instrumentation to dream() in src/cerebellum/dreamer.ts"
    GOOD: "extract extractJson() into src/cerebellum/extract-json.ts"
    BAD:  "explore the dreamer"            (no file, no change)
    BAD:  "improve self-monitoring"        (which file? which signal?)
- Return ONLY the JSON object. No prose before or after.`;

/**
 * Read the self-model markdown from `{rootDir}/self-model.md`. Mirrors
 * curiosity.ts:loadSelfModelForCuriosity — duplicated intentionally so
 * planner.ts stays self-contained (no cross-import for a one-liner).
 * Returns the empty string when the file is missing or unreadable so
 * the planner degrades gracefully (no self-model → plan without that
 * context, which is still useful for goals that don't need it).
 */
function loadSelfModelForPlanner(rootDir: string): string {
  try {
    const path = join(rootDir, 'self-model.md');
    const raw = readFileSync(path, 'utf8').trim();
    if (raw.length === 0) return '';
    return raw;
  } catch {
    return '';
  }
}

/**
 * Build the user prompt for a planning pass. The prompt carries the
 * goal, the self-model (truncated to keep token budget bounded — the
 * planner doesn't need the full aspirations section to decompose a
 * single goal), and the max-step cap.
 *
 * The self-model truncation is intentionally generous (first 4000 chars)
 * — enough to carry current capabilities + active limitations, not
 * enough to blow the budget when self-model grows. If the file is
 * longer, the planner sees the most important sections (which are at
 * the top by convention).
 */
export function buildPlannerUserPrompt(input: PlannerInput): string {
  const selfModel = loadSelfModelForPlanner(input.rootDir);
  const selfModelBlock =
    selfModel.length === 0
      ? '(self-model missing — plan without identity context)'
      : selfModel.slice(0, 4000);

  const maxSteps = input.maxSteps ?? 5;

  return `<goal>
${input.goal}
</goal>

<self-model>
${selfModelBlock}
</self-model>

Break this goal into at most ${maxSteps} concrete, ordered sub-tasks. Return JSON.`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Coerce an unknown LLM output into a PlanStep, or null if the shape is
 * wrong. Mirrors curiosity.ts:coerceBacklogItem — strict validation at
 * the boundary so downstream code can trust the type. Drops steps with
 * empty/whitespace goals (LLM sometimes outputs placeholder objects).
 */
function coercePlanStep(raw: unknown): PlanStep | null {
  if (!isObject(raw)) return null;
  const goal = typeof raw.goal === 'string' ? raw.goal.trim() : '';
  if (goal.length === 0) return null;
  const rationale = typeof raw.rationale === 'string' ? raw.rationale.trim() : '';
  // rationale is required per the system prompt, but we tolerate empty
  // rationale rather than dropping the step — a step with no rationale
  // is still actionable, just less well-explained. The orchestrator can
  // decide whether to surface this in telemetry.
  return { goal, rationale };
}

/**
 * Extract a JSON object from an LLM response. Mirror of
 * curiosity.ts:extractJson and dreamer.ts:extractJson — duplicated
 * intentionally so planner.ts stays self-contained. Handles raw JSON,
 * markdown-fenced JSON, and JSON embedded in prose.
 */
function extractJson(
  content: string,
): { ok: true; value: ParsedPlan } | { ok: false; error: string } {
  const trimmed = content.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch?.groups?.[0] ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return { ok: false, error: 'no JSON object found in response' };
  }
  const slice = candidate.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as ParsedPlan;
    return { ok: true, value: parsed };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'JSON.parse failed',
    };
  }
}

/**
 * Run a single planning pass: LLM call + parse + coerce.
 *
 * Throws when the provider itself throws (network, auth, rate-limit) —
 * the caller can distinguish "LLM broken" from "LLM returned junk" by
 * catching the throw vs. reading parseOk.
 *
 * Returns parseOk=false when the LLM returned non-JSON or JSON without
 * a steps array. In that case steps is empty; the caller can fall back
 * to executing the original goal directly.
 */
export async function plan(input: PlannerInput): Promise<PlannerOutput> {
  const start = Date.now();
  const completion = await input.provider.complete(buildPlannerUserPrompt(input), {
    systemPrompt: PLANNER_SYSTEM_PROMPT,
    temperature: 0.3, // low temp for focused, deterministic decomposition
    maxTokens: 1500,
  });

  const extracted = extractJson(completion.content);
  if (!extracted.ok) {
    return {
      steps: [],
      rawResponse: completion.content,
      durationMs: Date.now() - start,
      parseOk: false,
      ...(extracted.error !== undefined ? { parseError: extracted.error } : {}),
    };
  }

  const rawSteps = Array.isArray(extracted.value.steps) ? extracted.value.steps : [];
  const maxSteps = input.maxSteps ?? 5;
  const steps: PlanStep[] = [];
  for (const raw of rawSteps) {
    if (steps.length >= maxSteps) break;
    const step = coercePlanStep(raw);
    if (step) steps.push(step);
  }

  return {
    steps,
    rawResponse: completion.content,
    durationMs: Date.now() - start,
    parseOk: true,
  };
}
