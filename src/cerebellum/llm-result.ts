import type { MemoryCategory } from '../orchestrator/events.js';

/**
 * Shared output shape + coercion for LLM-driven cerebellum phases.
 *
 * Iteration 46 (2026-07-21) extracted the duplicated type aliases and
 * coercion helpers from dreamer.ts and curiosity.ts. Both phases parse
 * an LLM response into the same JSON shape:
 *
 *   { backlogItems: [...], memoryEntries: [...] }
 *
 * And both apply the same validation to each item:
 *   - backlogItems need a non-empty goal, optional clamped priority,
 *     optional non-empty rationale.
 *   - memoryEntries need a valid MemoryCategory, non-empty title
 *     (truncated to 200 chars), non-empty body.
 *
 * Before Iteration 46 this logic was byte-for-byte duplicated across
 * two files. The duplication was originally load-bearing (the dreamer
 * learned to refuse multi-stage goals in Iter 34; curiosity inherited
 * the same rule via prompt rather than via shared code). But the
 * coercion layer has no such divergence — it is pure shape
 * normalization. Keeping it duplicated invites drift on the wrong
 * dimension: a future change to e.g. the priority clamp range would
 * need to land in two files, and a miss would silently change which
 * proposals each phase accepts.
 *
 * The 5 type aliases below are also structurally identical across
 * dreamer and curiosity. Renaming to a single canonical set (Llm
 * prefix instead of Dream and Curiosity prefixes) is safe because
 * no external caller imports the old names — grep-verified before
 * extraction.
 */

export interface LlmBacklogItem {
  readonly goal: string;
  readonly priority?: number;
  readonly rationale?: string;
}

export interface LlmMemoryEntry {
  readonly category: MemoryCategory;
  readonly title: string;
  readonly body: string;
}

export interface LlmAddedBacklogItem {
  readonly id: string;
  readonly goal: string;
  readonly priority: number;
}

export interface LlmAddedMemoryEntry {
  readonly id: string;
  readonly category: MemoryCategory;
  readonly title: string;
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parsePriority(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function isMemoryCategory(v: unknown): v is MemoryCategory {
  return (
    typeof v === 'string' &&
    (v === 'patterns' || v === 'lessons' || v === 'preferences' || v === 'dreams')
  );
}

export function coerceBacklogItem(raw: unknown): LlmBacklogItem | null {
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

export function coerceMemoryEntry(raw: unknown): LlmMemoryEntry | null {
  if (!isObject(raw)) return null;
  if (!isMemoryCategory(raw.category)) return null;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const body = typeof raw.body === 'string' ? raw.body.trim() : '';
  if (title.length === 0 || body.length === 0) return null;
  return { category: raw.category, title: title.slice(0, 200), body };
}
