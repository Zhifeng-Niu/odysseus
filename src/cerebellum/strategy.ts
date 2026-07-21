import type { Strategy } from './waypoint.js';
import { buildEngineerSystemPrompt } from './strategy-prompt.js';

// Re-export moved symbols (Iteration 51 extraction) so existing importers
// (orchestrator, tests, prompts.ts audit) do not need to know about the
// internal split. Same pattern as planner.ts re-exporting planner-policy.js
// (Iter 42), curiosity.ts re-exporting curiosity-prompt.js (Iter 44),
// dreamer.ts re-exporting dreamer-prompt.js (Iter 47), and self-monitor.ts
// re-exporting self-monitor-patterns.js (Iter 48).
export {
  loadSelfModel,
  loadLongTermMemoryMarkdown,
  buildEngineerSystemPrompt,
} from './strategy-prompt.js';

/**
 * The literal token the agent appends to a conversational reply to signal
 * "this was a conversational turn, no code task to verify". Symmetric
 * counterpart of DONE: DONE = "task finished, please verify";
 * [CONVERSATIONAL-DONE] = "no task here, just a reply".
 *
 * Defined as a constant so the orchestrator and the strategy prompt cannot
 * drift on the exact spelling.
 */
export const CONVERSATIONAL_DONE_MARKER = '[CONVERSATIONAL-DONE]';

/**
 * Detection result for the conversational-done marker in an assistant reply.
 * `cleanContent` is the reply with the marker stripped (and surrounding
 * whitespace trimmed), so downstream consumers (events, history, failReason
 * truncation) never see the protocol token mixed into the prose.
 */
export interface ConversationalDoneDetection {
  found: boolean;
  cleanContent: string;
}

/**
 * Detect the [CONVERSATIONAL-DONE] marker in an assistant reply. The marker
 * MUST appear on its own line (case-insensitive) — `foo [CONVERSATIONAL-DONE]`
 * mid-sentence does NOT count, to avoid false positives from an LLM that
 * merely mentions the token in a meta-discussion. Acceptable positions:
 *   - alone on a line, anywhere in the reply
 *   - at the very start or end of the reply
 *
 * Returns `cleanContent` with the marker line removed and surrounding blank
 * lines collapsed. When the marker is absent, `cleanContent` equals the input
 * (trimmed) and `found` is false.
 */
export function detectConversationalDone(
  raw: string,
): ConversationalDoneDetection {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { found: false, cleanContent: '' };

  // Match the marker on its own line. Anchored with (^|\n) and (\n|$) so
  // inline occurrences inside a sentence are ignored. Case-insensitive.
  const pattern = /(^|\n)\s*\[CONVERSATIONAL-DONE\]\s*(?=\n|$)/i;
  if (!pattern.test(trimmed)) {
    return { found: false, cleanContent: trimmed };
  }
  const clean = trimmed.replace(pattern, '').replace(/\n{3,}/g, '\n\n').trim();
  return { found: true, cleanContent: clean };
}

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
