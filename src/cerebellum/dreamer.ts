import type { LLMProvider } from '../llm/provider.js';
import type { TraceRecord } from '../trace/jsonl.js';
import type { MemoryCategory } from '../orchestrator/events.js';
import type { MemoryEntry } from './memory.js';
import { type EnqueueOptions } from './backlog.js';
import { enqueuePendingReview, autoApproveAllPendingReview, shouldAutoApprove } from './pending-review.js';
import { writeMemory as writeMemoryEntry } from './memory.js';

/**
 * Dreaming state — free-association over recent trace + memory.
 *
 * Where wakeful execution is structured (HARD verify, multi-iteration loop),
 * dreaming is the opposite:
 *   - Single LLM call, no iteration
 *   - No goal prompt — the agent reflects on what it has done
 *   - Output is structured JSON parsed defensively — a malformed dream is
 *     silently dropped, never crashes the voyage loop
 *
 * The dreamer is the agent's "default mode network" — the cognitive activity
 * that happens when no external task is present, mirroring biological
 * dreaming during sleep.
 */

const DREAM_SYSTEM_PROMPT = `You are Odysseus in a dreaming state.

Unlike wakeful execution where you follow a specific goal, dreaming is free-association: you replay recent experiences and surface patterns, latent ideas, and improvements.

You will receive:
- <recent>: recent waypoint outcomes (success/failure, fail reasons, goals)
- <memory>: your existing long-term memory — titles only, indexed by category. Use these as lightweight pointers to what you already know.
- <reflection>: deep diagnostic entries (source='reflect') with FULL bodies. These are your own self-analyses of systemic gaps — each one is a candidate for translation into concrete backlogItems.

Your output must be strict JSON:

\`\`\`json
{
  "backlogItems": [
    {
      "goal": "<verb + specific change + file/module path>",
      "priority": <number 0-100, lower=higher priority>,
      "rationale": "<1-2 sentences why this matters>"
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
- backlogItems MUST be concrete, file-scoped code changes. The goal field MUST
  include at least one specific file path or module name. Good examples:
    GOOD: "add dedup check to enqueueBacklog() in src/cerebellum/backlog.ts"
    GOOD: "extract conversation detector into src/cerebellum/conversation.ts"
    GOOD: "raise consecutiveTextOnly threshold from 2 to 3 in orchestrator.ts"
- FORBIDDEN: abstract goals with no file/module target. Bad examples:
    BAD:  "add deduplication logic"          (where? how?)
    BAD:  "improve error handling"           (which file? which error?)
    BAD:  "make the agent more reliable"     (not actionable)
- FORBIDDEN: goals whose edit target is a safety-perimeter file. The
  safety perimeter is: src/cerebellum/orchestrator.ts, package.json,
  tsconfig.json, .gitignore. The wakeful agent cannot edit these files
  and will emit BLOCKED+DONE on turn 1 (Iteration 33), so seeding such
  a goal wastes a checkpoint + verify cycle for zero progress. Bad
  examples:
    BAD:  "add recall step at runWaypoint in src/cerebellum/orchestrator.ts"
    BAD:  "wire new validator into package.json scripts"
  If a reflection entry points at a safety-perimeter file, do not seed
  it as a backlogItem — output a memoryEntry noting the gap instead.
- FORBIDDEN: multi-stage goals that chain several verbs across 3+ design
  decisions. Each backlogItem must fit in ONE waypoint (≤16 turns). If
  a change needs "draft→critique→revise" or "tokenize→retrieve→inject",
  split it into separate backlogItems or leave for a future dream.
- FORBIDDEN: goals that explicitly self-label as requiring human review
  ("Sacred-file change — requires manual review", "requires human
  escalation"). These belong in memoryEntries as aspirations, not in
  backlogItems as actionable work.
- Each backlogItem must be a viable waypoint seed — a wakeful run must be able
  to start, pick an anchor file, and make a diff without further clarification.
- Goals already present in <recent> with outcome=success will be SKIPPED — do
  not re-propose work that has already shipped.
- Goals in <recent> with outcome=failure or abandoned carry information too.
  If a failed goal was too vague or hit a safety perimeter, do NOT re-propose
  it in a rephrased form ("implement Stage 2.1" → "implement Stage 2.2" of
  the same roadmap is the same class of failure waiting to happen). Re-seed
  only if you can name a concrete change in the goal text that would unblock
  convergence.
- memoryEntries should be reusable insights, not one-off notes.
- Entries in <reflection> carry diagnostic depth — each one describes a systemic
  gap you identified about yourself. For each reflection entry, ask: "what
  concrete file-scoped change would address this?" If you can name a specific
  file + function + change, output it as a backlogItem with priority < 75
  (reflective work preempts exploratory dream work). If the diagnosis is too
  abstract to translate in this pass, leave it for a future dream — do not
  produce vague backlogItems just to fill quota.
- If nothing useful surfaces, return {"backlogItems": [], "memoryEntries": []}.
- Maximum 5 backlogItems and 3 memoryEntries per dream — quality over quantity.
- Return ONLY the JSON object. No prose before or after.`;

export interface DreamInput {
  /** Root dir for memory + backlog writes. */
  readonly rootDir: string;
  readonly provider: LLMProvider;
  /** Recent trace records — typically the last 5-10 waypoints. */
  readonly recentTrace: readonly TraceRecord[];
  /** Current memory snapshot per category. */
  readonly memorySnapshot: ReadonlyArray<{
    readonly category: MemoryCategory;
    readonly entries: readonly MemoryEntry[];
  }>;
  /** Cap on items persisted — extra items are dropped. */
  readonly maxBacklogItems?: number;
  readonly maxMemoryEntries?: number;
}

export interface DreamBacklogItem {
  readonly goal: string;
  readonly priority?: number;
  readonly rationale?: string;
}

export interface DreamMemoryEntry {
  readonly category: MemoryCategory;
  readonly title: string;
  readonly body: string;
}

export interface DreamAddedBacklogItem {
  readonly id: string;
  readonly goal: string;
  readonly priority: number;
}

export interface DreamAddedMemoryEntry {
  readonly id: string;
  readonly category: MemoryCategory;
  readonly title: string;
}

export interface DreamOutput {
  readonly backlogItemsAdded: number;
  readonly backlogItemsSkipped: number;
  readonly memoryEntriesAdded: number;
  readonly addedBacklogItems: readonly DreamAddedBacklogItem[];
  readonly addedMemoryEntries: readonly DreamAddedMemoryEntry[];
  readonly rawResponse: string;
  readonly durationMs: number;
  readonly parseOk: boolean;
  readonly parseError?: string;
}

interface ParsedDream {
  backlogItems?: unknown;
  memoryEntries?: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Normalize a goal string for dedup comparison. Strips punctuation and case,
 * collapses whitespace. Does NOT remove stop-words — verb choice ("add" vs
 * "fix" vs "refactor") carries signal about intent.
 */
export function normalizeGoal(goal: string): string {
  return goal
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function goalTokens(goal: string): Set<string> {
  const tokens = normalizeGoal(goal)
    .split(' ')
    .filter((t) => t.length > 1);
  return new Set(tokens);
}

/**
 * Decide whether `newGoal` duplicates any goal in `existing`. Two strategies:
 *
 *   1. Exact match after normalization (catches whitespace/case variants).
 *   2. Jaccard token similarity ≥ 0.5 (catches reworded variants like
 *      "add retry to glm" vs "add retry logic to glm provider").
 *
 * Threshold of 0.5 is deliberately low — false positives are cheaper than
 * false negatives in a self-evolution backlog (better to skip one good item
 * than to enqueue five near-duplicates that all execute the same change).
 */
export function isDuplicateGoal(
  newGoal: string,
  existing: ReadonlySet<string>
): boolean {
  const normalized = normalizeGoal(newGoal);
  if (normalized.length === 0) return false;
  if (existing.has(normalized)) return true;

  const newTokens = goalTokens(newGoal);
  if (newTokens.size === 0) return false;

  for (const raw of existing) {
    const existingNorm = normalizeGoal(raw);
    if (existingNorm === normalized) return true;
    const existingTokens = goalTokens(raw);
    if (existingTokens.size === 0) continue;
    let intersection = 0;
    for (const t of newTokens) {
      if (existingTokens.has(t)) intersection += 1;
    }
    const union = new Set([...newTokens, ...existingTokens]).size;
    if (union === 0) continue;
    if (intersection / union >= 0.5) return true;
  }
  return false;
}

/**
 * Build the set of goals already completed successfully. The dreamer refuses
 * to re-enqueue anything in this set, so the backlog cannot accumulate
 * "add retry", "add retry logic", "add a retry", ... variants across dreams.
 */
export function buildSucceededGoalSet(trace: readonly TraceRecord[]): Set<string> {
  const set = new Set<string>();
  for (const r of trace) {
    if (r.outcome === 'success' && r.goal.trim().length > 0) {
      set.add(r.goal);
    }
  }
  return set;
}

function parsePriority(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function coerceBacklogItem(raw: unknown): DreamBacklogItem | null {
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

function coerceMemoryEntry(raw: unknown): DreamMemoryEntry | null {
  if (!isObject(raw)) return null;
  if (!isMemoryCategory(raw.category)) return null;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const body = typeof raw.body === 'string' ? raw.body.trim() : '';
  if (title.length === 0 || body.length === 0) return null;
  return { category: raw.category, title: title.slice(0, 200), body };
}

/**
 * Extract a JSON object from an LLM response. Handles:
 * - raw JSON
 * - JSON wrapped in markdown code fences
 * - JSON preceded/followed by prose (finds the first { ... } block)
 *
 * Returns { parseOk: false, error } if no valid JSON is found.
 */
function extractJson(content: string): { ok: true; value: ParsedDream } | { ok: false; error: string } {
  const trimmed = content.trim();
  // Strip markdown code fences if present.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch?.groups?.[0] ?? trimmed;
  // Find the first balanced { ... } block (best-effort, doesn't handle nested quotes perfectly).
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return { ok: false, error: 'no JSON object found in response' };
  }
  const slice = candidate.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as ParsedDream;
    return { ok: true, value: parsed };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'JSON.parse failed',
    };
  }
}

export function buildUserPrompt(input: DreamInput): string {
  const recent = input.recentTrace.length === 0
    ? '(no recent waypoints)'
    : input.recentTrace
        .slice(-10) // last 10 max
        .map(
          (r) =>
            `- [${r.outcome}] ${r.goal}${r.fail_reason ? ` — FAIL: ${r.fail_reason.slice(0, 200)}` : ''}`
        )
        .join('\n');

  // Split memory into two layers by source:
  //   - Non-reflect entries (dream/user/failure/system) → title-only index.
  //     These are pointers to what the agent already knows; titles are enough.
  //   - Reflect entries → full body injection. These carry diagnostic depth
  //     (systemic gap analyses) that the dreamer should translate into
  //     concrete backlogItems. Title-only would discard the diagnostic content.
  const reflectEntries: Array<{
    readonly category: MemoryCategory;
    readonly entry: MemoryEntry;
  }> = [];
  const otherSnapshots: Array<{
    readonly category: MemoryCategory;
    readonly entries: readonly MemoryEntry[];
  }> = [];

  for (const snap of input.memorySnapshot) {
    const reflect: MemoryEntry[] = [];
    const others: MemoryEntry[] = [];
    for (const entry of snap.entries) {
      if (entry.source === 'reflect') {
        reflect.push(entry);
      } else {
        others.push(entry);
      }
    }
    if (reflect.length > 0) {
      for (const entry of reflect) {
        reflectEntries.push({ category: snap.category, entry });
      }
    }
    if (others.length > 0) {
      otherSnapshots.push({ category: snap.category, entries: others });
    }
  }

  const hasAnyMemory = reflectEntries.length > 0 || otherSnapshots.length > 0;

  const memoryBlock = !hasAnyMemory
    ? '(memory empty — fresh agent)'
    : otherSnapshots.length === 0
      ? '(no non-reflect memory yet — only diagnostic reflections present)'
      : otherSnapshots
          .map((snap) => {
            const titles = snap.entries.map((e) => `  - ${e.title}`).join('\n');
            return `### ${snap.category} (${snap.entries.length})\n${titles}`;
          })
          .join('\n\n');

  const reflectionBlock =
    reflectEntries.length === 0
      ? '(no reflection entries — skip this section)'
      : reflectEntries
          .map(({ category, entry }) => {
            const rel = entry.relatedWaypointId ? ` _(from ${entry.relatedWaypointId})_` : '';
            const tags =
              entry.tags && entry.tags.length > 0 ? ` _[${entry.tags.join(', ')}]_` : '';
            return `### [${category}] ${entry.title}${rel}${tags}\n\n${entry.body}`;
          })
          .join('\n\n---\n\n');

  return `<recent>
${recent}
</recent>

<memory>
${memoryBlock}
</memory>

<reflection>
${reflectionBlock}
</reflection>

Reflect. Surface what wants to be done next. Return JSON.`;
}

/**
 * Run a single dreaming pass: LLM call + persist backlog/memory items.
 *
 * Failure modes:
 * - LLM throws → rethrown (caller decides whether to abort voyage).
 * - LLM returns malformed JSON → returns { parseOk: false, parseError }, nothing persisted.
 * - LLM returns valid JSON with junk items → junk items silently dropped.
 * - LLM returns items that duplicate already-succeeded waypoints → skipped, counted.
 *
 * Near-duplicates across dreams are also dropped (Jaccard ≥ 0.5 vs succeeded set
 * or items already enqueued in this same pass).
 */
export async function dream(input: DreamInput): Promise<DreamOutput> {
  const start = Date.now();
  const completion = await input.provider.complete(buildUserPrompt(input), {
    systemPrompt: DREAM_SYSTEM_PROMPT,
    temperature: 0.9, // high temp for divergent thinking
    maxTokens: 1500,
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
  const maxBacklog = input.maxBacklogItems ?? 5;
  const maxMemory = input.maxMemoryEntries ?? 3;

  const rawBacklog = Array.isArray(parsed.backlogItems) ? parsed.backlogItems : [];
  const rawMemory = Array.isArray(parsed.memoryEntries) ? parsed.memoryEntries : [];

  const backlogItems: DreamBacklogItem[] = [];
  for (const raw of rawBacklog) {
    if (backlogItems.length >= maxBacklog) break;
    const item = coerceBacklogItem(raw);
    if (item) backlogItems.push(item);
  }

  const memoryEntries: DreamMemoryEntry[] = [];
  for (const raw of rawMemory) {
    if (memoryEntries.length >= maxMemory) break;
    const entry = coerceMemoryEntry(raw);
    if (entry) memoryEntries.push(entry);
  }

  // Persist backlog items with dedup against the succeeded-goal set AND
  // against items added earlier in this same pass. Both checks use the
  // raw goal string (isDuplicateGoal normalizes internally).
  const seenGoals = buildSucceededGoalSet(input.recentTrace);
  const addedBacklogItems: DreamAddedBacklogItem[] = [];
  let backlogItemsSkipped = 0;
  for (const item of backlogItems) {
    if (isDuplicateGoal(item.goal, seenGoals)) {
      backlogItemsSkipped += 1;
      continue;
    }
    const options: EnqueueOptions =
      item.priority !== undefined ? { priority: item.priority } : {};
    try {
      // Dreams go to the pending-review queue first (preserves audit log of
      // what the dreamer proposed). When ODYSSEUS_AUTO_APPROVE is enabled
      // (default), all pending items are moved into the backlog at the end
      // of this dream pass — see the auto-approve block below. This gives
      // the agent autonomous evolution (think → propose → execute) without a
      // human pressing 'approve', while keeping pending-review.json as an
      // audit trail of every dreamer-produced proposal.
      const enqueued = await enqueuePendingReview(
        input.rootDir,
        item.goal,
        'dream',
        options
      );
      addedBacklogItems.push({
        id: enqueued.id,
        goal: item.goal,
        priority: enqueued.priority,
      });
      // Register the goal so subsequent items in this same dream cannot
      // sneak in a near-duplicate variant.
      seenGoals.add(item.goal);
    } catch {
      // empty-goal validation etc — skip silently
    }
  }

  // Auto-approve: when ODYSSEUS_AUTO_APPROVE is set (default ON), move every
  // pending item from this dream pass straight into the backlog so the next
  // voyage picks it up without waiting for user approval. Items that fail
  // to enqueue stay in pending-review.json for operator inspection.
  if (shouldAutoApprove() && addedBacklogItems.length > 0) {
    try {
      const approved = await autoApproveAllPendingReview(input.rootDir);
      // Refresh addedBacklogItems with the real backlog IDs (the pending IDs
      // were transient — pr_* ids become bl_* ids after approval). Preserve
      // order so callers can correlate which dream proposals actually shipped.
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
      // Auto-approve failure is non-fatal — items remain in pending-review
      // and the operator can approve them manually. The dream itself still
      // succeeded.
    }
  }

  // Persist memory entries with source='dream'.
  const addedMemoryEntries: DreamAddedMemoryEntry[] = [];
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
