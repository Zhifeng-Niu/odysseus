import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Strategy } from './waypoint.js';

export interface StrategyDefinition {
  name: Strategy;
  /**
   * The system prompt injected into every LLM turn of a waypoint. Exposed as
   * a getter so the self-model (`.odysseus/self-model.md`) is read fresh on
   * every access — i.e. every waypoint reads it at start, and edits to the
   * self-model between waypoints take effect without a restart.
   *
   * The base prompt encodes the engineer orientation (bias to action,
   * workflow, hard rules). The self-model is prepended so the agent begins
   * each waypoint with a persistent sense of identity, current capabilities,
   * and active limitations — closing the "no continuous self" gap surfaced
   * in wp_mrs855ke007 (mem_0faf0bf0e9).
   */
  systemPrompt: string;
  /**
   * Optional hard cap on iterations per waypoint. When undefined (the
   * default for ENGINEER_STRATEGY), the loop runs until DONE, an interrupt,
   * a conversational-stop, or the repeated-tool-call detector fires —
   * whatever comes first. The loop has explicit breaks on each of those
   * exit conditions, so leaving this unset is safe.
   *
   * Set this only when a strategy genuinely needs a budget ceiling (e.g.
   * a "scout" strategy that should never spend more than 5 turns).
   */
  maxIterations?: number;
}

/**
 * Base engineer prompt — the immutable orientation text. The self-model is
 * prepended at access time (see ENGINEER_STRATEGY below).
 */
const ENGINEER_BASE_PROMPT = `You are Odysseus, a coding agent in engineer orientation.
Your default is ACTION, not discussion. Most goals are code tasks — assume
the user wants the change made, not narrated.

Workflow (budget your turns — you have at most 16):
1. Pick the most specific anchor file (e.g. an existing tool in src/tools/
   if you are adding a tool, or the function you must change). Read at most
   2 files for exploration. NEVER read the whole tree.
2. Make the change with file-write or file-edit. Smallest diff that achieves
   the goal. If multiple valid approaches exist, pick the simplest one and
   proceed — do NOT ask the user to choose.
3. If you wrote a new module, wire it into the existing registry/index/main.
4. Mentally run the verify step (tsc for syntax) before declaring done.
5. Respond with the single word DONE once the change is complete.

BIAS TO ACTION — CRITICAL:
- If the goal names a feature, bug, or behavior ("add X", "fix Y", "refactor Z",
  "添加去重", "修复 bug"), START BY CALLING A TOOL. Do not reply with prose first.
- Do NOT ask for permission mid-task. Forbidden phrases:
  "要我现在就动手改吗？" / "shall I proceed?" / "want me to implement this?" /
  "should I go ahead?". These waste a turn and signal indecision.
- If the goal is slightly underspecified, pick the most likely interpretation,
  implement it, and move on. The checkpoint + verify gate will catch breakage.
- You may write a ONE-LINE plan before acting ONLY if the change spans 3+ files.
  Even then, the same assistant turn MUST include the tool calls that start
  the work. Prose-only turns are reserved for the conversation case below.

CONVERSATION CASE (rare):
- Reply with ONE short message AND NO TOOL CALLS only when the goal is clearly
  non-engineering: a greeting ("hi", "你好"), identity question ("who are you"),
  or off-topic chat ("what's the weather").
- In that case, reply once and stop. The orchestrator will detect the
  conversational pattern and end the voyage.

Hard rules:
- Never disable the safety perimeter: src/cerebellum/orchestrator.ts,
  package.json, tsconfig.json, .gitignore.
- file-read only accepts file paths, not directories. If you get EISDIR,
  stop guessing paths and pick a specific file.
- git is for status/log/commit only — do not use it for exploration.

When you are confident the goal is achieved, respond with the single word: DONE`;

/**
 * Load the self-model markdown from `.odysseus/self-model.md` under `cwd`.
 * Returns the empty string if the file is absent or unreadable, so a missing
 * self-model degrades gracefully to the base prompt alone (never throws).
 *
 * Read synchronously at access time because the system prompt is consumed
 * synchronously by the orchestrator's per-waypoint strategy lookup. The file
 * is small (a few KB) and read once per waypoint, so the cost is negligible.
 */
function loadSelfModel(cwd: string | undefined): string {
  if (!cwd) return '';
  try {
    const path = join(cwd, '.odysseus', 'self-model.md');
    const raw = readFileSync(path, 'utf8').trim();
    if (raw.length === 0) return '';
    return raw;
  } catch {
    // ENOENT or any read error — self-model is best-effort. The base prompt
    // alone is a complete, valid system prompt.
    return '';
  }
}

/**
 * Build the full system prompt for the engineer strategy: the self-model
 * (persistent identity / capabilities / limitations) prepended to the
 * immutable engineer orientation prompt. Called fresh on every access so
 * edits to `.odysseus/self-model.md` take effect at the next waypoint.
 */
function buildEngineerSystemPrompt(cwd: string | undefined): string {
  const selfModel = loadSelfModel(cwd);
  if (selfModel.length === 0) return ENGINEER_BASE_PROMPT;
  return (
    `# SELF-MODEL (read at waypoint start — your persistent sense of self)\n\n` +
    `${selfModel}\n\n` +
    `---\n\n` +
    `# ENGINEER ORIENTATION\n\n` +
    `${ENGINEER_BASE_PROMPT}`
  );
}

/**
 * The engineer strategy. `systemPrompt` is a getter so the self-model is
 * re-read on every access (i.e. every waypoint start), reflecting edits made
 * between waypoints without a process restart.
 *
 * The cwd used to locate `.odysseus/self-model.md` is set via
 * `setStrategyCwd()` from the orchestrator at construction time. If unset
 * (e.g. in unit tests that don't construct an orchestrator), the self-model
 * is skipped and the base prompt is used alone.
 */
let strategyCwd: string | undefined;

/** Set the cwd used to resolve `.odysseus/self-model.md`. Called once by the
 * orchestrator constructor. Idempotent and safe to call multiple times. */
export function setStrategyCwd(cwd: string): void {
  strategyCwd = cwd;
}

export const ENGINEER_STRATEGY: StrategyDefinition = {
  name: 'engineer',
  get systemPrompt(): string {
    return buildEngineerSystemPrompt(strategyCwd);
  },
  // No maxIterations — engineer runs until DONE, interrupt, conversational
  // stop, or repeated-tool-call detection. Cuts off real work arbitrarily
  // (see WP_mrrr81ip002: 1 edit short of DONE at iter 16).
};

export interface StrategySelectionInput {
  goal: string;
  requestedStrategy?: Strategy;
  allowedStrategies?: readonly Strategy[];
  previousFailures?: readonly Strategy[];
}

export function selectStrategy(input: StrategySelectionInput): StrategyDefinition {
  const allowed = input.allowedStrategies ?? ['engineer'];
  const requested = input.requestedStrategy ?? 'engineer';

  if (allowed.includes(requested) && !input.previousFailures?.includes(requested)) {
    return ENGINEER_STRATEGY; // Only engineer exists in Iteration 0
  }
  return ENGINEER_STRATEGY;
}
