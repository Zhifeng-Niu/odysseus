import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Strategy } from './waypoint.js';
import {
  loadRecentVoyageSummariesSync,
  formatVoyageSummariesMarkdown,
} from './voyage-log.js';
import { ENGINEER_BASE_PROMPT } from './prompts.js';

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
 * Base engineer prompt — see prompts.ts. Extracted to its own module in
 * Iteration 33 to keep this file under the 300-line CLAUDE.md cap. The
 * prompt is imported verbatim (no runtime transformation) so tests can
 * assert on its literal content.
 */

/**
 * Load the self-model markdown from `.odysseus/self-model.md` under `cwd`.
 * Returns the empty string if the file is absent or unreadable, so a missing
 * self-model degrades gracefully to the base prompt alone (never throws).
 *
 * Read synchronously at access time because the system prompt is consumed
 * synchronously by the orchestrator's per-waypoint strategy lookup. The file
 * is small (a few KB) and read once per waypoint, so the cost is negligible.
 */
export function loadSelfModel(cwd: string | undefined): string {
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
 * Categories injected into every waypoint's system prompt as long-term
 * memory context. `patterns` and `lessons` are the cross-voyage learning
 * signals — the agent must see them at every waypoint start to avoid
 * repeating past mistakes and to repeat validated approaches.
 *
 * `preferences` and `dreams` are excluded:
 *   - `preferences` is operator-set config, not learning — it belongs in
 *     self-model or explicit config, not duplicated here.
 *   - `dreams` is reflect-source content already surfaced to the dreamer
 *     via the dreamer's own `<reflection>` block; injecting it into every
 *     wakeful waypoint would double-count and bloat the prompt.
 */
const INJECTED_MEMORY_CATEGORIES = ['patterns', 'lessons'] as const;

/**
 * Load the agent's long-term memory (patterns + lessons) as a single
 * markdown blob, suitable for direct injection into the system prompt.
 * Returns the empty string if both files are missing or empty.
 *
 * Like `loadSelfModel`, this is synchronous because the system prompt is
 * consumed synchronously. Files are read once per waypoint; total cost is
 * bounded by the size of the memory files (typically a few KB).
 *
 * Why raw markdown instead of structured entries: the memory files are
 * already structured as `## sections` with metadata. The agent can parse
 * this format natively. Re-serializing through `readMemory` +
 * `readMemoryAsPromptContext` would be lossy (no benefit) and async
 * (requires restructuring the strategy API).
 */
export function loadLongTermMemoryMarkdown(cwd: string | undefined): string {
  if (!cwd) return '';
  const parts: string[] = [];
  for (const category of INJECTED_MEMORY_CATEGORIES) {
    try {
      const path = join(cwd, '.odysseus', 'memory', `${category}.md`);
      const raw = readFileSync(path, 'utf8').trim();
      if (raw.length === 0) continue;
      parts.push(`## ${category}\n\n${raw}`);
    } catch {
      // Missing file = no entries for this category; skip silently.
    }
  }
  if (parts.length === 0) return '';
  return parts.join('\n\n---\n\n');
}

/**
 * Load the recent voyage summaries as a markdown block. Returns '' when
 * trace.jsonl is missing or empty — fresh agents start with no voyage
 * history, the same way they start with no patterns/lessons.
 *
 * Read synchronously because the systemPrompt getter must stay sync.
 * Trace is append-only and small (one line per waypoint), so blocking
 * cost is negligible.
 */
function loadVoyageLogMarkdown(cwd: string | undefined): string {
  if (!cwd) return '';
  const tracePath = join(cwd, '.odysseus', 'trace.jsonl');
  const summaries = loadRecentVoyageSummariesSync(tracePath);
  return formatVoyageSummariesMarkdown(summaries);
}

/**
 * Build the full system prompt for the engineer strategy. Four layers,
 * prepended in order of persistence:
 *
 *   1. **SELF-MODEL** — persistent identity / capabilities / limitations /
 *      aspirations. Read fresh on every waypoint from `.odysseus/self-model.md`.
 *   2. **LONG-TERM MEMORY** — patterns and lessons accumulated across
 *      voyages. Read fresh on every waypoint from `.odysseus/memory/*.md`.
 *      This is the cross-voyage learning signal: the agent must see past
 *      patterns at every waypoint start to avoid repeating mistakes and
 *      to repeat validated approaches.
 *   3. **VOYAGE LOG** — outline of the most recent voyages (goal + outcome
 *      per waypoint). Cross-voyage working memory: the agent knows what it
 *      already tried, what failed, and what succeeded, even after a fresh
 *      voyage starts. Read fresh on every waypoint from
 *      `.odysseus/trace.jsonl`.
 *   4. **ENGINEER ORIENTATION** — the immutable action-bias prompt.
 *
 * Each layer degrades gracefully: missing files are silently skipped, so
 * a fresh agent with no self-model and no memory gets the bare engineer
 * orientation prompt.
 */
function buildEngineerSystemPrompt(cwd: string | undefined): string {
  const selfModel = loadSelfModel(cwd);
  const longTermMemory = loadLongTermMemoryMarkdown(cwd);
  const voyageLog = loadVoyageLogMarkdown(cwd);

  const parts: string[] = [];
  if (selfModel.length > 0) {
    parts.push(
      `# SELF-MODEL (read at waypoint start — your persistent sense of self)\n\n${selfModel}`
    );
  }
  if (longTermMemory.length > 0) {
    parts.push(
      `# LONG-TERM MEMORY (patterns and lessons from past voyages — apply these actively)\n\n${longTermMemory}`
    );
  }
  if (voyageLog.length > 0) {
    parts.push(
      `# VOYAGE LOG (recent voyages — what you already tried; do not repeat failed approaches)\n\n${voyageLog}`
    );
  }
  parts.push(`# ENGINEER ORIENTATION\n\n${ENGINEER_BASE_PROMPT}`);
  return parts.join('\n\n---\n\n');
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
