import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadRecentVoyageSummariesSync,
  formatVoyageSummariesMarkdown,
} from './voyage-log.js';
import { ENGINEER_BASE_PROMPT } from './prompts.js';

/**
 * Engineer strategy system-prompt builder — extracted from strategy.ts
 * (Iteration 51).
 *
 * Four layers are prepended in order of persistence:
 *
 *   1. **SELF-MODEL** — persistent identity / capabilities / limitations /
 *      aspirations. Read fresh on every waypoint from
 *      `.odysseus/self-model.md`.
 *   2. **LONG-TERM MEMORY** — patterns and lessons accumulated across
 *      voyages. Read fresh on every waypoint from `.odysseus/memory/*.md`.
 *      This is the cross-voyage learning signal: the agent must see past
 *      patterns at every waypoint start to avoid repeating mistakes and
 *      to repeat validated approaches.
 *   3. **VOYAGE LOG** — outline of the most recent voyages (goal + outcome
 *      per waypoint). Cross-voyage working memory. Read fresh on every
 *      waypoint from `.odysseus/trace.jsonl`.
 *   4. **ENGINEER ORIENTATION** — the immutable action-bias prompt.
 *
 * Each layer degrades gracefully: missing files are silently skipped, so
 * a fresh agent with no self-model and no memory gets the bare engineer
 * orientation prompt.
 *
 * Mirrors Iter 42 (planner-policy), Iter 44 (curiosity-prompt), Iter 47
 * (dreamer-prompt): extract a cohesive concern (prompt construction) to a
 * sibling so strategy.ts shrinks toward strategy definitions + selection.
 */

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
 * Build the full system prompt for the engineer strategy. See the module
 * docstring above for the four-layer composition and degradation rules.
 */
export function buildEngineerSystemPrompt(cwd: string | undefined): string {
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
