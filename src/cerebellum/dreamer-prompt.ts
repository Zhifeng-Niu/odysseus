import type { LLMProvider } from '../llm/provider.js';
import type { TraceRecord } from '../trace/jsonl.js';
import type { MemoryCategory } from '../orchestrator/events.js';
import type { MemoryEntry } from './memory.js';

/**
 * Dreamer prompt builder + its input shape.
 *
 * Iteration 47 (2026-07-21) extracted these from dreamer.ts (330 → 245
 * lines) as the next step in the incremental debt paydown documented
 * in tests/unit/cerebellum-size.test.ts. Mirrors the Iteration 44
 * extraction of curiosity-prompt.ts.
 *
 * Pure functions, no side effects on the backlog/memory. The dreamer
 * prompt is richer than curiosity's because it splits memory by source:
 *   - Reflect entries get full-body injection (they carry diagnostic
 *     depth that the dreamer should translate into backlogItems).
 *   - Non-reflect entries get title-only injection (they are pointers,
 *     not content).
 * This two-layer design is what lets reflective memory actually feed
 * back into the agent's roadmap.
 */

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
