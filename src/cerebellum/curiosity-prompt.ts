import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LLMProvider } from '../llm/provider.js';
import type { TraceRecord } from '../trace/jsonl.js';
import type { MemoryCategory } from '../orchestrator/events.js';
import type { MemoryEntry } from './memory.js';
import {
  loadRecentExplorationsSync,
  joinWithTraceOutcomes,
  formatExplorationsMarkdown,
} from './exploration-log.js';

/**
 * Curiosity prompt builder + its input shape and self-model loader.
 *
 * Iteration 44 (2026-07-21) extracted these from curiosity.ts (435 → 325
 * lines) as the next step in the incremental debt paydown documented in
 * tests/unit/cerebellum-size.test.ts. Pure functions, no side effects on
 * the backlog/memory — only reads files and formats strings.
 *
 * Kept together because:
 *   - CuriosityInput is the parameter type of buildCuriosityUserPrompt
 *     AND the public curiosity() entry point. Splitting it out adds a
 *     third file with no behavioral benefit.
 *   - loadSelfModelForCuriosity is called only by buildCuriosityUserPrompt.
 *     Inlining would lose its standalone test coverage
 *     (tests/unit/curiosity.test.ts:360-369).
 *
 * The curiosity() function itself stays in curiosity.ts — it owns the
 * LLM call + persistence side effects (enqueue pending-review, write
 * memory, append exploration log) and those concerns should not be
 * co-located with a pure prompt builder.
 */

export interface CuriosityInput {
  /** Root dir for memory + backlog writes + self-model read. */
  readonly rootDir: string;
  readonly provider: LLMProvider;
  /** Recent trace records — used for dedup + exploration-outcome join. */
  readonly recentTrace: readonly TraceRecord[];
  /** Current memory snapshot per category (titles only — dedup reference). */
  readonly memorySnapshot: ReadonlyArray<{
    readonly category: MemoryCategory;
    readonly entries: readonly MemoryEntry[];
  }>;
  /** Cap on items persisted — extra items are dropped. */
  readonly maxBacklogItems?: number;
  readonly maxMemoryEntries?: number;
  /**
   * Voyage that owns this curiosity pass. Forwarded into exploration
   * records so the audit trail links proposals back to the voyage that
   * produced them. Optional — probes and tests can omit it.
   */
  readonly voyageId?: string;
}

/**
 * Read the self-model markdown from `{rootDir}/self-model.md`. This is the
 * primary seed for curiosity — aspirations live there. Returns the empty
 * string if the file is missing so curiosity degrades gracefully (no
 * aspirations → no proposals).
 *
 * Read synchronously to keep the curiosity function's signature simple.
 */
export function loadSelfModelForCuriosity(rootDir: string): string {
  try {
    const path = join(rootDir, 'self-model.md');
    const raw = readFileSync(path, 'utf8').trim();
    if (raw.length === 0) return '';
    return raw;
  } catch {
    // ENOENT or any read error — self-model is best-effort. Curiosity with
    // no self-model produces no proposals (the aspirations are the seed).
    return '';
  }
}

export function buildCuriosityUserPrompt(input: CuriosityInput): string {
  const selfModel = loadSelfModelForCuriosity(input.rootDir);

  const selfModelBlock =
    selfModel.length === 0
      ? '(self-model missing — no aspirations to explore. Return empty arrays.)'
      : selfModel;

  const recent = input.recentTrace.length === 0
    ? '(no recent waypoints)'
    : input.recentTrace
        .slice(-10)
        .map(
          (r) =>
            `- [${r.outcome}] ${r.goal}${r.fail_reason ? ` — FAIL: ${r.fail_reason.slice(0, 200)}` : ''}`
        )
        .join('\n');

  const hasMemory = input.memorySnapshot.some((s) => s.entries.length > 0);
  const memoryBlock = !hasMemory
    ? '(memory empty — fresh agent)'
    : input.memorySnapshot
        .map((snap) => {
          if (snap.entries.length === 0) return '';
          const titles = snap.entries.map((e) => `  - ${e.title}`).join('\n');
          return `### ${snap.category} (${snap.entries.length})\n${titles}`;
        })
        .filter(Boolean)
        .join('\n\n');

  // Cross-voyage curiosity memory: surface recent proposals joined with
  // their latest trace outcome so the LLM sees what it already tried.
  // Path mirrors trace.jsonl location (sibling under .odysseus/). Reading
  // sync because the prompt builder is sync (called once per curiosity
  // pass; cost is negligible — explorations.jsonl grows linearly with
  // curiosity invocations, bounded by DEFAULT_EXPLORATION_LIMIT).
  const explorationsPath = join(input.rootDir, 'explorations.jsonl');
  const recentExplorations = loadRecentExplorationsSync(explorationsPath);
  const outcomes = joinWithTraceOutcomes(recentExplorations, input.recentTrace);
  const explorationsMd = formatExplorationsMarkdown(outcomes);
  const explorationsBlock =
    explorationsMd.length === 0
      ? '(no prior explorations — fresh curiosity memory)'
      : explorationsMd;

  return `<self-model>
${selfModelBlock}
</self-model>

<recent>
${recent}
</recent>

<memory>
${memoryBlock}
</memory>

<explorations>
${explorationsBlock}
</explorations>

What is the smallest concrete step toward one of your aspirations? Return JSON.`;
}
