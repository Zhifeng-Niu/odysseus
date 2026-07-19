import type { LLMProvider } from '../llm/provider.js';
import type { TraceRecord } from '../trace/jsonl.js';
import type { MemoryCategory } from '../orchestrator/events.js';
import type { MemoryEntry } from './memory.js';
import { enqueueBacklog, type EnqueueOptions } from './backlog.js';
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
- <memory>: your existing long-term memory (patterns, lessons, preferences, dreams)

Your output must be strict JSON:

\`\`\`json
{
  "backlogItems": [
    {
      "goal": "<concrete, actionable code change>",
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
- backlogItems must be CONCRETE code changes (e.g. "add retry to glm provider"), not philosophical observations.
- Each backlogItem must have a goal that could be a waypoint seed.
- memoryEntries should be reusable insights, not one-off notes.
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

function buildUserPrompt(input: DreamInput): string {
  const recent = input.recentTrace.length === 0
    ? '(no recent waypoints)'
    : input.recentTrace
        .slice(-10) // last 10 max
        .map(
          (r) =>
            `- [${r.outcome}] ${r.goal}${r.fail_reason ? ` — FAIL: ${r.fail_reason.slice(0, 200)}` : ''}`
        )
        .join('\n');

  const memory = input.memorySnapshot.length === 0
    ? '(memory empty — fresh agent)'
    : input.memorySnapshot
        .map((snap) => {
          const titles = snap.entries.map((e) => `  - ${e.title}`).join('\n');
          return `### ${snap.category} (${snap.entries.length})\n${titles}`;
        })
        .join('\n\n');

  return `<recent>
${recent}
</recent>

<memory>
${memory}
</memory>

Reflect. Surface what wants to be done next. Return JSON.`;
}

/**
 * Run a single dreaming pass: LLM call + persist backlog/memory items.
 *
 * Failure modes:
 * - LLM throws → rethrown (caller decides whether to abort voyage).
 * - LLM returns malformed JSON → returns { parseOk: false, parseError }, nothing persisted.
 * - LLM returns valid JSON with junk items → junk items silently dropped.
 *
 * Idempotent at the file level: calling dream() twice will produce two
 * independent sets of items. De-duplication is YAGNI for spike.
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

  // Persist backlog items. Capture ids for the caller to emit events.
  const addedBacklogItems: DreamAddedBacklogItem[] = [];
  for (const item of backlogItems) {
    const options: EnqueueOptions =
      item.priority !== undefined ? { priority: item.priority } : {};
    try {
      const enqueued = await enqueueBacklog(input.rootDir, item.goal, 'dream', options);
      addedBacklogItems.push({
        id: enqueued.id,
        goal: item.goal,
        priority: enqueued.priority,
      });
    } catch {
      // empty-goal validation etc — skip silently
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
    memoryEntriesAdded: addedMemoryEntries.length,
    addedBacklogItems,
    addedMemoryEntries,
    rawResponse: completion.content,
    durationMs: Date.now() - start,
    parseOk: true,
  };
}
