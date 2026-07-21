import { describe, test, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Size caps for cerebellum source files.
 *
 * CLAUDE.md says: "Every file < 300 lines (violation triggers self-refactor
 * waypoint)". Several cerebellum modules pre-date this rule and accumulated
 * debt: dreamer.ts was 545 lines at Iteration 34. Iterations 33/35/36 are
 * paying down that debt incrementally (extract prompts → extract dedup
 → extract parser/buildUserPrompt next).
 *
 * The caps below pin *current* progress. If a file grows past its cap, this
 * test fails and forces the author to either:
 *   - reverse the growth (extract a module, compress content), OR
 *   - explicitly raise the cap with a comment explaining why the file's
 *     responsibilities expanded.
 *
 * Cap is NOT the same as the CLAUDE.md target. Caps here are checkpoints
 * on the path to <300. Lower the cap when a file shrinks — do not raise
 * it without a structural reason.
 */

const CEREBELLUM_DIR = join(process.cwd(), 'src', 'cerebellum');

interface FileCap {
  readonly filename: string;
  readonly lineCap: number;
  readonly rationale: string;
}

const FILE_CAPS: readonly FileCap[] = [
  {
    filename: 'dreamer.ts',
    lineCap: 240,
    rationale:
      'Iteration 47 extracted buildUserPrompt + DreamInput to ' +
      'dreamer-prompt.ts: 330 → 225. Cap at 240 — locks progress. File is ' +
      'now a thin wrapper around LLM call + persistence side effects ' +
      '(enqueue pending-review, write memory, auto-approve). Further ' +
      'reduction would require extracting the persistence half.',
  },
  {
    filename: 'dreamer-prompt.ts',
    lineCap: 160,
    rationale:
      'Iteration 47 — pure prompt builder + DreamInput shape. Current 124 ' +
      'lines. Cap at 160 — should stay flat; growth means the prompt ' +
      'builder is absorbing coercion logic that belongs in llm-result.ts.',
  },
  {
    filename: 'llm-result.ts',
    lineCap: 130,
    rationale:
      'Iteration 46 — shared LLM-result coercion (isObject, parsePriority, ' +
      'isMemoryCategory, coerceBacklogItem, coerceMemoryEntry) + 4 type ' +
      'aliases consumed by dreamer and curiosity. Current 98 lines. Cap at ' +
      '130 — pure functions and types, should stay flat. Growth means a new ' +
      'coercion rule (e.g. tag validation) is being added; consider whether ' +
      'it applies to both phases before adding.',
  },
  {
    filename: 'dreamer-dedup.ts',
    lineCap: 120,
    rationale:
      'Iteration 36 extracted goal-dedup helpers here (85 lines). Cap at 120 — these are ' +
      'pure functions, should not grow.',
  },
  {
    filename: 'voyage-stats.ts',
    lineCap: 299,
    rationale:
      'Iteration 37 added computeIncrementalTokens (delta from voyage-cumulative). ' +
      'Current 291 lines. Cap at 299 — strictly under CLAUDE.md <300 ceiling. ' +
      'Any growth that crosses 300 must extract a module first (e.g. a ' +
      'voyage-stats-aggregate or voyage-stats-format split).',
  },
  {
    filename: 'extract-json.ts',
    lineCap: 80,
    rationale:
      'Iteration 38 — shared extractJsonObject<T> generic. Current 44 lines. ' +
      'Cap at 80 — pure function, should stay tight. Any larger and it is ' +
      'probably absorbing validation logic that belongs elsewhere.',
  },
  {
    filename: 'backlog.ts',
    lineCap: 260,
    rationale:
      'Iteration 49 extracted enqueueBacklog + enqueueUserOrigin to ' +
      'backlog-enqueue.ts: 378 → 249. Cap at 260 — locks progress. File ' +
      'is now pure storage primitives (load/save, byPriorityThenTime) + ' +
      'queue ops (dequeue/peek/size/list/remove) + type definitions + ' +
      'shared helpers exported to backlog-enqueue.ts. Further reduction ' +
      'would require splitting the queue ops from the storage primitives, ' +
      'but they share the loadBacklogFile/saveBacklogFile pair tightly.',
  },
  {
    filename: 'backlog-enqueue.ts',
    lineCap: 200,
    rationale:
      'Iteration 49 — extracted enqueueBacklog + enqueueUserOrigin from ' +
      'backlog.ts. Current 183 lines. Cap at 200 — leaves headroom for ' +
      'small policy tweaks. The three pre-flight checks (isSeedExhausted, ' +
      'isRetryExhausted, isCompleted) are the dedup gate; if a fourth ' +
      'check is added (e.g. domain-specific blocklist), the file would ' +
      'cross 200 — in that case extract the gate checks into a ' +
      'backlog-enqueue-policy.ts sibling (mirrors the planner/planner-policy ' +
      'pattern from Iter 42).',
  },
  {
    filename: 'retry-counter.ts',
    lineCap: 90,
    rationale:
      'Iteration 45 — pure in-memory registry, mirrors seedAttempts.ts ' +
      'shape exactly. Current 67 lines. Cap at 90 — should stay flat. ' +
      'Growth means the registry is absorbing backlog-API logic that ' +
      'belongs in backlog.ts.',
  },
  {
    filename: 'backlog-registries.ts',
    lineCap: 200,
    rationale:
      'Iteration 39 — SkippedEnqueue + RejectedGoal registries. Current 151 ' +
      'lines. Cap at 200 — leaves headroom for one more in-memory registry ' +
      '(e.g. enqueue-attempts) without forcing a split. If it crosses 200, ' +
      'consider whether SkippedEnqueue and RejectedGoal belong in separate ' +
      'modules.',
  },
  {
    filename: 'planner.ts',
    lineCap: 280,
    rationale:
      'Iteration 42 extracted shouldPlanGoal + PLAN_KEYWORDS + ' +
      'MIN_PLAN_GOAL_LENGTH to planner-policy.ts: 337 → 257. Cap at 280 — ' +
      'under CLAUDE.md <300 ceiling with headroom for prompt tweaks. ' +
      'Crossed only if the PLANNER_SYSTEM_PROMPT grows materially; in that ' +
      'case split the prompt into a prompts.ts entry first.',
  },
  {
    filename: 'planner-policy.ts',
    lineCap: 120,
    rationale:
      'Iteration 42 — pure policy module (shouldPlanGoal + constants). ' +
      'Current 86 lines. Cap at 120 — these are heuristics that should not ' +
      'grow. If it crosses 120, the policy is likely absorbing plan() ' +
      'mechanism code that belongs in planner.ts.',
  },
  {
    filename: 'prompts.ts',
    lineCap: 299,
    rationale:
      'Iteration 42 added CURIOSITY_SYSTEM_PROMPT alongside ENGINEER_BASE_PROMPT ' +
      'and DREAM_SYSTEM_PROMPT: 212 → 294. Cap at 299 — strictly under ' +
      'CLAUDE.md <300 ceiling. All three LLM-phase prompts now live in one ' +
      'module so cross-phase rule audits are trivial. Any growth that crosses ' +
      '300 must split a prompt into a sibling (e.g. curiosity-prompts.ts).',
  },
  {
    filename: 'curiosity.ts',
    lineCap: 280,
    rationale:
      'Iteration 46 extracted shared coercion helpers to llm-result.ts: ' +
      '325 → 272. Cap at 280 — leaves headroom. File is now a thin wrapper ' +
      'around LLM call + persistence side effects; further size reduction ' +
      'would require extracting the persistence half (pending-review enqueue + ' +
      'memory write + exploration log append), which is a larger structural ' +
      'change.',
  },
  {
    filename: 'curiosity-prompt.ts',
    lineCap: 180,
    rationale:
      'Iteration 44 — pure prompt builder + its input shape + self-model ' +
      'loader. Current 140 lines. Cap at 180 — should stay flat; growth ' +
      'means the prompt builder is absorbing coercion logic that belongs ' +
      'in curiosity.ts.',
  },
  {
    filename: 'self-monitor.ts',
    lineCap: 185,
    rationale:
      'Iteration 48 extracted pattern detection to ' +
      'self-monitor-patterns.ts: 318 → 172. Cap at 185 — locks progress. ' +
      'File is now a thin composition layer (buildSelfMonitorObservation) ' +
      '+ the summarizeToolCall arg-to-observation converter + small ' +
      'helpers (makeObs, isObject, truncatePath, truncate). Further ' +
      'reduction would require extracting summarizeToolCall and its ' +
      'helpers to a self-monitor-format.ts split — viable but low ' +
      'priority since the helpers are tightly coupled to makeObs which ' +
      'depends on the ToolCallObservation shape defined here.',
  },
  {
    filename: 'self-monitor-patterns.ts',
    lineCap: 200,
    rationale:
      'Iteration 48 — pure pattern-detection module (detectPattern ' +
      'dispatcher + 4 detectors + READ/WRITE tool constants + formatEntry ' +
      'display helper). Current 182 lines. Cap at 200 — leaves headroom ' +
      'for one more detector (e.g. tool-call latency spike) without ' +
      'forcing a split. Detector order in detectPattern is load-bearing ' +
      '— first-match-wins reflects which signal is most actionable when ' +
      'multiple overlap; see the docstring for the priority sequence.',
  },
];

describe('cerebellum source file size caps', () => {
  for (const cap of FILE_CAPS) {
    describe(`${cap.filename}`, () => {
      test('file exists', () => {
        const stat = statSync(join(CEREBELLUM_DIR, cap.filename));
        expect(stat.isFile()).toBe(true);
      });

      test(`stays under ${cap.lineCap} lines`, () => {
        const content = readFileSync(join(CEREBELLUM_DIR, cap.filename), 'utf8');
        const lines = content.split('\n').length;
        expect(
          lines,
          `${cap.filename} is ${lines} lines (cap ${cap.lineCap}). ${cap.rationale}`
        ).toBeLessThan(cap.lineCap);
      });
    });
  }
});
