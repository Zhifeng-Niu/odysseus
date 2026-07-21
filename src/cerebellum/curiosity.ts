import { join } from 'node:path';
import { type EnqueueOptions } from './backlog.js';
import {
  enqueuePendingReview,
  autoApproveAllPendingReview,
  shouldAutoApprove,
} from './pending-review.js';
import { writeMemory as writeMemoryEntry } from './memory.js';
import { CURIOSITY_SYSTEM_PROMPT } from './prompts.js';
import {
  isDuplicateGoal,
  buildSucceededGoalSet,
} from './dreamer-dedup.js';
import { appendExploration } from './exploration-log.js';
import { extractJsonObject } from './extract-json.js';
import {
  type LlmBacklogItem,
  type LlmMemoryEntry,
  type LlmAddedBacklogItem,
  type LlmAddedMemoryEntry,
  coerceBacklogItem,
  coerceMemoryEntry,
} from './llm-result.js';
import {
  buildCuriosityUserPrompt,
  loadSelfModelForCuriosity,
  type CuriosityInput,
} from './curiosity-prompt.js';

// Re-export moved symbols (Iteration 44 extraction) so existing importers
// (tests, probe-curiosity.ts) do not need to know about the internal
// split. Same pattern as planner.ts re-exporting planner-policy.js.
export {
  buildCuriosityUserPrompt,
  loadSelfModelForCuriosity,
  type CuriosityInput,
} from './curiosity-prompt.js';

/**
 * Curiosity phase — forward-looking exploration of self-model aspirations.
 *
 * Where the dreamer is the agent's "default mode network" ruminating on past
 * failures, curiosity is the agent's "what's next" impulse. It reads its own
 * aspirations (the gaps between current and desired capability) and proposes
 * the smallest concrete step toward closing one of them.
 *
 * Symmetries with the dreamer:
 *   - Same JSON output shape (backlogItems + memoryEntries).
 *   - Same pending-review → auto-approve pipeline.
 *   - Same dedup against the succeeded-goal set + same-pass items.
 *
 * Asymmetries:
 *   - Different system prompt (exploration, not fix-minded). The prompt lives
 *     in ./prompts.ts alongside the engineer and dream prompts (Iteration 42
 *     extraction) so cross-phase rule audits are easy.
 *   - Different seed: self-model aspirations + recent trace + memory titles.
 *     The dreamer is seeded by recent failures; curiosity is seeded by the
 *     self-model's aspiration section.
 *   - Different origin tag: 'curiosity' instead of 'dream'. Priority 90
 *     (between reflect 75 and dream 100) — curiosity preempts idle dreaming
 *     but yields to failure-driven reflections.
 *   - Lower item cap (2 vs 5) — curiosity is focused, not brainstorming.
 *
 * Closes the "no autonomous goal generation" limitation in self-model.md.
 * Closes aspiration #3 ("Curiosity goal source").
 */

export type CuriosityBacklogItem = LlmBacklogItem;
export type CuriosityMemoryEntry = LlmMemoryEntry;
export type CuriosityAddedBacklogItem = LlmAddedBacklogItem;
export type CuriosityAddedMemoryEntry = LlmAddedMemoryEntry;

export interface CuriosityOutput {
  readonly backlogItemsAdded: number;
  readonly backlogItemsSkipped: number;
  readonly memoryEntriesAdded: number;
  readonly addedBacklogItems: readonly CuriosityAddedBacklogItem[];
  readonly addedMemoryEntries: readonly CuriosityAddedMemoryEntry[];
  readonly rawResponse: string;
  readonly durationMs: number;
  readonly parseOk: boolean;
  readonly parseError?: string;
}

interface ParsedCuriosity {
  backlogItems?: unknown;
  memoryEntries?: unknown;
}

/**
 * Returns true when the curiosity phase should fire. Defaults to ON as of
 * 2026-07-21 (Iteration 9) — a truly autonomous agent generates its own
 * exploration goals without operator opt-in. Curiosity has been validated
 * by two live GLM-5.2 probes (Iterations 7 and 8) and is gated by three
 * independent safety layers before producing any backlog item:
 *
 *   1. `didRealWork` — only fires after a voyage produced real side-effects
 *      (not after pure-conversational "hi" waypoints).
 *   2. `backlog-empty` — only fires when the dreamer produced no new items
 *      this voyage; curiosity does not preempt reflective work.
 *   3. `pending-review` queue — proposals go to `pending-review.json` first.
 *      With `ODYSSEUS_AUTO_APPROVE=0` (operator opt-out), they wait there
 *      for review. With the default `ODYSSEUS_AUTO_APPROVE=1`, they flow
 *      to the backlog like dream proposals.
 *
 * Operators who want to disable curiosity entirely (e.g. for deterministic
 * CI runs) set `ODYSSEUS_CURIOSITY=0` (or `false` / `no`).
 */
export function shouldRunCuriosity(): boolean {
  const v = process.env.ODYSSEUS_CURIOSITY;
  if (v === undefined || v === '') return true;
  return v !== '0' && v !== 'false' && v !== 'no';
}

/**
 * Run a single curiosity pass: LLM call + persist backlog/memory items.
 *
 * Failure modes mirror dream()'s:
 * - LLM throws → rethrown (caller decides whether to abort voyage).
 * - LLM returns malformed JSON → returns { parseOk: false, parseError },
 *   nothing persisted.
 * - LLM returns junk items → silently dropped.
 * - LLM returns items duplicating past successes → skipped, counted.
 *
 * Items route through pending-review first (for audit trail), then
 * auto-approve to backlog if ODYSSEUS_AUTO_APPROVE is enabled.
 */
export async function curiosity(input: CuriosityInput): Promise<CuriosityOutput> {
  const start = Date.now();
  const completion = await input.provider.complete(buildCuriosityUserPrompt(input), {
    systemPrompt: CURIOSITY_SYSTEM_PROMPT,
    temperature: 0.8, // high temp for divergent exploration, slightly lower than dreamer (0.9) — curiosity is more focused
    maxTokens: 1800, // cap reflects current self-model + memory title footprint; bump if truncated JSON reappears
  });

  const extracted = extractJsonObject<ParsedCuriosity>(completion.content);
  if (!extracted.ok) {
    return {
      backlogItemsAdded: 0,
      backlogItemsSkipped: 0,
      memoryEntriesAdded: 0,
      addedBacklogItems: [],
      addedMemoryEntries: [],
      rawResponse: completion.content,
      durationMs: Date.now() - start,
      parseOk: false,
      ...(extracted.error !== undefined ? { parseError: extracted.error } : {}),
    };
  }

  const parsed = extracted.value;
  const maxBacklog = input.maxBacklogItems ?? 2;
  const maxMemory = input.maxMemoryEntries ?? 2;

  const rawBacklog = Array.isArray(parsed.backlogItems) ? parsed.backlogItems : [];
  const rawMemory = Array.isArray(parsed.memoryEntries) ? parsed.memoryEntries : [];

  const backlogItems: CuriosityBacklogItem[] = [];
  for (const raw of rawBacklog) {
    if (backlogItems.length >= maxBacklog) break;
    const item = coerceBacklogItem(raw);
    if (item) backlogItems.push(item);
  }

  const memoryEntries: CuriosityMemoryEntry[] = [];
  for (const raw of rawMemory) {
    if (memoryEntries.length >= maxMemory) break;
    const entry = coerceMemoryEntry(raw);
    if (entry) memoryEntries.push(entry);
  }

  // Dedup against succeeded goals AND same-pass items, same as dreamer.
  // Reuses the dreamer's helpers so the dedup definition stays in one place
  // (curiosity and dreamer must agree on what counts as a duplicate).
  const seenGoals = buildSucceededGoalSet(input.recentTrace);
  const addedBacklogItems: CuriosityAddedBacklogItem[] = [];
  let backlogItemsSkipped = 0;
  const explorationsPath = join(input.rootDir, 'explorations.jsonl');
  for (const item of backlogItems) {
    if (isDuplicateGoal(item.goal, seenGoals)) {
      backlogItemsSkipped += 1;
      continue;
    }
    const options: EnqueueOptions =
      item.priority !== undefined ? { priority: item.priority } : {};
    try {
      const enqueued = await enqueuePendingReview(
        input.rootDir,
        item.goal,
        'curiosity',
        options
      );
      addedBacklogItems.push({
        id: enqueued.id,
        goal: item.goal,
        priority: enqueued.priority,
      });
      seenGoals.add(item.goal);
      // Cross-voyage curiosity memory: record this proposal so the next
      // curiosity pass can see it (with its eventual trace outcome) and
      // avoid re-proposing the same exploration. Best-effort — write
      // failure must not roll back the enqueue.
      try {
        await appendExploration(explorationsPath, {
          goal: item.goal,
          origin: 'curiosity',
          priority: enqueued.priority,
          ...(input.voyageId !== undefined ? { voyage_id: input.voyageId } : {}),
        });
      } catch {
        // Exploration log is best-effort; enqueue already succeeded.
      }
    } catch {
      // empty-goal validation etc — skip silently
    }
  }

  // Auto-approve moves this pass's proposals to the backlog so the next
  // voyage iteration can execute them. Reuses the dreamer's pipeline —
  // pending-review + auto-approve are origin-agnostic.
  if (shouldAutoApprove() && addedBacklogItems.length > 0) {
    try {
      const approved = await autoApproveAllPendingReview(input.rootDir);
      if (approved.length > 0) {
        addedBacklogItems.length = 0;
        for (const bl of approved) {
          addedBacklogItems.push({
            id: bl.id,
            goal: bl.goal,
            priority: bl.priority,
          });
        }
      }
    } catch {
      // Auto-approve failure is non-fatal — items stay in pending-review.
    }
  }

  // Curiosity memories use source='dream' (not a new MemorySource) — they're
  // autonomous thoughts about exploration strategy, structurally identical
  // to dream memories. Adding a 'curiosity' source would cascade through
  // MemorySource consumers for no behavioral gain.
  const addedMemoryEntries: CuriosityAddedMemoryEntry[] = [];
  for (const entry of memoryEntries) {
    try {
      const written = await writeMemoryEntry(input.rootDir, {
        category: entry.category,
        title: entry.title,
        source: 'dream',
        body: entry.body,
      });
      addedMemoryEntries.push({
        id: written.id,
        category: entry.category,
        title: entry.title,
      });
    } catch {
      // skip silently
    }
  }

  return {
    backlogItemsAdded: addedBacklogItems.length,
    backlogItemsSkipped,
    memoryEntriesAdded: addedMemoryEntries.length,
    addedBacklogItems,
    addedMemoryEntries,
    rawResponse: completion.content,
    durationMs: Date.now() - start,
    parseOk: true,
  };
}
