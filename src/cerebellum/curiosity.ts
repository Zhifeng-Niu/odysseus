import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LLMProvider } from '../llm/provider.js';
import type { TraceRecord } from '../trace/jsonl.js';
import type { MemoryCategory } from '../orchestrator/events.js';
import type { MemoryEntry } from './memory.js';
import { type EnqueueOptions } from './backlog.js';
import {
  enqueuePendingReview,
  autoApproveAllPendingReview,
  shouldAutoApprove,
} from './pending-review.js';
import { writeMemory as writeMemoryEntry } from './memory.js';
import {
  isDuplicateGoal,
  buildSucceededGoalSet,
} from './dreamer.js';
import {
  appendExploration,
  loadRecentExplorationsSync,
  joinWithTraceOutcomes,
  formatExplorationsMarkdown,
} from './exploration-log.js';

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
 *   - Different system prompt (exploration, not fix-minded).
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

const CURIOSITY_SYSTEM_PROMPT = `You are Odysseus in a curiosity state.

Unlike the dreamer which reflects on past failures, curiosity looks FORWARD: you scan your self-model aspirations and propose the smallest concrete step toward closing one of them.

You will receive:
- <self-model>: your persistent identity, current capabilities, active limitations, and aspirations. The aspirations are the primary seed — each one is a gap you've identified between current and desired capability.
- <recent>: recent waypoint outcomes. Use these to skip work that already shipped or that you've tried recently.
- <memory>: existing long-term memory titles. Use these to avoid proposing work you've already captured.
- <explorations>: your recent curiosity proposals, joined with their latest trace outcome. Use these to avoid repeating yourself — if you proposed X last voyage and it ran, pick a different angle or a different aspiration. Re-proposing the same exploration is noise; the log remembers what you already tried.

Your output must be strict JSON:

\`\`\`json
{
  "backlogItems": [
    {
      "goal": "<verb + specific change + file/module path>",
      "priority": <number 0-100, lower=higher priority>",
      "rationale": "<1-2 sentences — which aspiration does this move toward, and what will you learn?>"
    }
  ],
  "memoryEntries": [
    {
      "category": "patterns" | "lessons" | "preferences" | "dreams",
      "title": "<short label, < 80 chars>",
      "body": "<markdown body, 1-5 sentences>"
    }
  ]
}
\`\`\`

Rules:
- For each aspiration in <self-model>, ask: "what is the smallest concrete
  file-scoped change that moves toward this?" If you can name a specific file
  + behavior, output it as a backlogItem.
- Curiosity goals are EXPLORATIONS, not fixes. Good framing includes:
    GOOD: "add timing instrumentation to dream() in src/cerebellum/dreamer.ts; log to .odysseus/profile.jsonl"
    GOOD: "extract extractJson() from dreamer.ts into src/cerebellum/extract-json.ts so curiosity.ts can reuse it"
    GOOD: "add a workWaypointCounter to voyage state in orchestrator.ts; skip dream phase until counter reaches 3"
- FORBIDDEN: vague explorations with no file/module target. Bad examples:
    BAD:  "explore the dreamer"                  (where? what will you change?)
    BAD:  "improve self-monitoring"              (which file? which signal?)
    BAD:  "make the agent more curious"          (not actionable)
- Each backlogItem must be a viable waypoint seed — a wakeful run must be able
  to start, pick an anchor file, and make a diff without further clarification.
- Maximum 2 backlogItems per curiosity pass — curiosity is focused, not
  brainstorming. 1 well-chosen exploration beats 5 generic ones.
- If nothing genuinely surfaces (no aspiration has a concrete next step you
  can name right now), return empty arrays. Do NOT manufacture work to fill
  quota. Curiosity is honest — "nothing to explore today" is a valid output.
- Before proposing an exploration, scan <explorations>. If a near-identical
  goal already appears there:
    - with outcome=succeeded → it shipped, do not re-propose; pick something else
    - with outcome=failure   → only re-propose if you can name a *concrete*
      different angle (different file, different mechanism). Restating the
      same goal verbatim is noise.
    - with outcome=proposed, never executed → it is queued; pick something else
- memoryEntries should be reusable insights about your aspirations or
  exploration strategy, not one-off notes.
- Maximum 2 memoryEntries per pass.
- Return ONLY the JSON object. No prose before or after.`;

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

export interface CuriosityBacklogItem {
  readonly goal: string;
  readonly priority?: number;
  readonly rationale?: string;
}

export interface CuriosityMemoryEntry {
  readonly category: MemoryCategory;
  readonly title: string;
  readonly body: string;
}

export interface CuriosityAddedBacklogItem {
  readonly id: string;
  readonly goal: string;
  readonly priority: number;
}

export interface CuriosityAddedMemoryEntry {
  readonly id: string;
  readonly category: MemoryCategory;
  readonly title: string;
}

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

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
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

function parsePriority(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function coerceBacklogItem(raw: unknown): CuriosityBacklogItem | null {
  if (!isObject(raw)) return null;
  const goal = typeof raw.goal === 'string' ? raw.goal.trim() : '';
  if (goal.length === 0) return null;
  const priority = parsePriority(raw.priority);
  const rationale =
    typeof raw.rationale === 'string' && raw.rationale.trim().length > 0
      ? raw.rationale.trim()
      : undefined;
  return {
    goal,
    ...(priority !== undefined ? { priority } : {}),
    ...(rationale !== undefined ? { rationale } : {}),
  };
}

function isMemoryCategory(v: unknown): v is MemoryCategory {
  return (
    typeof v === 'string' &&
    (v === 'patterns' || v === 'lessons' || v === 'preferences' || v === 'dreams')
  );
}

function coerceMemoryEntry(raw: unknown): CuriosityMemoryEntry | null {
  if (!isObject(raw)) return null;
  if (!isMemoryCategory(raw.category)) return null;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const body = typeof raw.body === 'string' ? raw.body.trim() : '';
  if (title.length === 0 || body.length === 0) return null;
  return { category: raw.category, title: title.slice(0, 200), body };
}

/**
 * Extract a JSON object from an LLM response. Handles raw JSON, markdown
 * fenced JSON, and JSON embedded in prose. Mirror of dreamer.ts:extractJson
 * — duplicated intentionally so curiosity.ts stays self-contained.
 */
function extractJson(
  content: string,
): { ok: true; value: ParsedCuriosity } | { ok: false; error: string } {
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
    const parsed = JSON.parse(slice) as ParsedCuriosity;
    return { ok: true, value: parsed };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'JSON.parse failed',
    };
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

  const extracted = extractJson(completion.content);
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
