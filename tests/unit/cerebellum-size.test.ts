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
    lineCap: 260,
    rationale:
      'Iteration 55 extracted the markdown formatter block ' +
      '(formatPct, formatTokens, formatReasons, formatSlice, ' +
      'formatVoyageStatsMarkdown) to voyage-stats-format.ts: ' +
      '291 → 234. Cap at 260 — locks progress and pulls out of the ' +
      'CLAUDE.md <300 red zone. File is now pure aggregation ' +
      '(computeVoyageStats, computeSlice, countOutcomes, ' +
      'aggregateReasons, computeIncrementalTokens, sumTokens, ' +
      'normalizeReason) + type definitions. Further reduction would ' +
      'require splitting computeIncrementalTokens (token accounting) ' +
      'from computeVoyageStats (rollup) into a voyage-stats-tokens.ts ' +
      'sibling, but the two are tightly coupled by the VoyageStats ' +
      'shape and the shared sumTokens helper.',
  },
  {
    filename: 'voyage-stats-format.ts',
    lineCap: 140,
    rationale:
      'Iteration 55 — pure markdown renderer for VoyageStats. Current ' +
      '112 lines. Cap at 140 — leaves headroom for output-format ' +
      'evolution (e.g. adding a "Top success reasons" section, or a ' +
      'compact one-line summary). Growth beyond 140 means the ' +
      'formatter is absorbing aggregation logic that belongs in ' +
      'voyage-stats.ts.',
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
    filename: 'strategy.ts',
    lineCap: 160,
    rationale:
      'Iteration 51 extracted the prompt-builder block (loadSelfModel, ' +
      'loadLongTermMemoryMarkdown, loadVoyageLogMarkdown, ' +
      'buildEngineerSystemPrompt, INJECTED_MEMORY_CATEGORIES) to ' +
      'strategy-prompt.ts: 271 → 137. Cap at 160 — locks progress. File ' +
      'is now strategy definitions + selection (StrategyDefinition, ' +
      'ENGINEER_STRATEGY, selectStrategy, setStrategyCwd) + the ' +
      'conversational-done detector. Further reduction would require ' +
      'extracting detectConversationalDone to its own module, but that ' +
      'logic is tightly coupled to CONVERSATIONAL_DONE_MARKER which is ' +
      'defined here and consumed by the orchestrator alongside selectStrategy.',
  },
  {
    filename: 'strategy-prompt.ts',
    lineCap: 180,
    rationale:
      'Iteration 51 — pure prompt-builder module. Current 150 lines. ' +
      'Cap at 180 — leaves headroom for one more memory category ' +
      '(e.g. injecting aspirations at prompt-build time) or a new ' +
      'context layer (e.g. recent-commands) without forcing a split. ' +
      'Growth beyond 180 means the prompt builder is absorbing strategy ' +
      'selection logic that belongs in strategy.ts.',
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
  {
    filename: 'pending-review.ts',
    lineCap: 260,
    rationale:
      'Iteration 50 extracted auto-approve (shouldAutoApprove + ' +
      'autoApproveAllPendingReview) to pending-review-auto.ts: ' +
      '294 → 242. Cap at 260 — locks progress. File is now the manual ' +
      'CRUD API (enqueue/list/approve/reject) + storage primitives ' +
      '(loadFile/saveFile) shared with pending-review-auto.ts. Further ' +
      'reduction would require extracting the approval path (which uses ' +
      'enqueueBacklog + the listSkippedEnqueues side-channel) to a ' +
      'pending-review-approve.ts sibling, but the approval path is the ' +
      'core API surface and should stay visible here.',
  },
  {
    filename: 'pending-review-auto.ts',
    lineCap: 100,
    rationale:
      'Iteration 50 — autonomous-mode policy module. Current 81 lines. ' +
      'Cap at 100 — leaves headroom for one or two more env-driven ' +
      'toggles (e.g. per-origin auto-approve overrides) without forcing ' +
      'a split. Growth beyond 100 means the policy is absorbing approval ' +
      'mechanism code that belongs in pending-review.ts.',
  },
  {
    filename: 'memory.ts',
    lineCap: 200,
    rationale:
      'Iteration 53 extracted pure markdown (de)serialization ' +
      '(serializeEntry, splitSections, parseEntry, ParsedSection) to ' +
      'memory-parse.ts: 252 → 166. Cap at 200 — locks progress. File is ' +
      'now storage primitives (memoryFilePath, generateMemoryId) + the ' +
      'CRUD API (readMemory, writeMemory, listMemory, ' +
      'readMemoryAsPromptContext) + type definitions. Further reduction ' +
      'would require splitting listMemory from the rest, but listMemory ' +
      'is the only consumer of stat() and is small enough to stay.',
  },
  {
    filename: 'memory-parse.ts',
    lineCap: 160,
    rationale:
      'Iteration 53 — pure markdown parser module. Current 127 lines. ' +
      'Cap at 160 — leaves headroom for format evolution (e.g. ' +
      'versioning the section header, adding a new metadata field) ' +
      'without forcing a split. Growth beyond 160 means the parser is ' +
      'absorbing storage logic that belongs in memory.ts.',
  },
  {
    filename: 'voyage-log.ts',
    lineCap: 220,
    rationale:
      'Iteration 54 — voyage summary aggregator + markdown formatter. ' +
      'Current 203 lines. Cap at 220 — leaves a small headroom for ' +
      'summarize() field additions (e.g. total tokens consumed per ' +
      'voyage). Growth beyond 220 means it is absorbing prompt-building ' +
      'logic that belongs in strategy-prompt.ts; in that case extract ' +
      'formatVoyageSummariesMarkdown + truncate to a voyage-log-format.ts ' +
      'sibling (mirrors memory-parse split, Iter 53).',
  },
  {
    filename: 'commit-audit.ts',
    lineCap: 210,
    rationale:
      'Iteration 54 — empty-commit detector module. Current 193 lines. ' +
      'Cap at 210 — the module has one concern (parse `git log --shortstat` ' +
      'for empty waypoint-success commits). Growth beyond 210 means a ' +
      'second audit dimension (e.g. detecting commits that touch only ' +
      'comments) is being added; in that case split the new audit into ' +
      'commit-audit-<dimension>.ts so each detector stays independent.',
  },
  {
    filename: 'exploration-log.ts',
    lineCap: 260,
    rationale:
      'Iteration 54 — curiosity exploration log. Current 240 lines. ' +
      'Cap at 260 — leaves headroom for format additions (e.g. rendering ' +
      'tags alongside the proposal). Growth beyond 260 means the module ' +
      'is absorbing curiosity-prompt logic; in that case extract ' +
      'formatExplorationsMarkdown + formatAge + truncate to an ' +
      'exploration-log-format.ts sibling (mirrors memory-parse split, ' +
      'Iter 53).',
  },
  {
    filename: 'verify.ts',
    lineCap: 180,
    rationale:
      'Iteration 54 — multi-layer verify gate. Current 147 lines. Cap at ' +
      '180 — leaves room for one more verify layer (lint, metric). Each ' +
      'layer is ~15-25 lines including its comment block. Growth beyond ' +
      '180 means a fourth layer (e.g. coverage threshold) is being ' +
      'added; in that case split layers into verify-<name>.ts files and ' +
      'keep verify.ts as the dispatcher only.',
  },
  {
    filename: 'repeated-tool-call-detector.ts',
    lineCap: 130,
    rationale:
      'Iteration 54 — sliding-window loop detector class. Current 102 ' +
      'lines. Cap at 130 — small headroom for detector refinements ' +
      '(e.g. signature normalization to ignore trivially-differing ' +
      'args). Growth beyond 130 means the class is absorbing recovery ' +
      'policy that belongs in the orchestrator or a sibling module.',
  },
  {
    filename: 'goal-validator.ts',
    lineCap: 150,
    rationale:
      'Iteration 54 — pre-dispatch conversational-goal filter. Current ' +
      '111 lines. Cap at 150 — leaves headroom for additional language ' +
      'patterns (e.g. Japanese, Korean) without forcing a split. Growth ' +
      'beyond 150 means action-verb or conversational regex sets are ' +
      'ballooning; in that case extract the regex tables to a ' +
      'goal-validator-patterns.ts sibling (mirrors self-monitor-patterns, ' +
      'Iter 48).',
  },
  {
    filename: 'brain-state.ts',
    lineCap: 120,
    rationale:
      'Iteration 54 — brain-state machine (declarative type + transition ' +
      'table + 3 constants). Current 89 lines. Cap at 120 — small ' +
      'headroom for a new state (e.g. `learning` — documented in the ' +
      'module as a future addition). Growth beyond 120 means the file ' +
      'is absorbing transition logic that belongs in the orchestrator.',
  },
  {
    filename: 'waypoint.ts',
    lineCap: 130,
    rationale:
      'Iteration 54 — Waypoint type + status transition factories. ' +
      'Current 93 lines. Cap at 130 — leaves headroom for additional ' +
      'factory functions (e.g. markInterrupted) without forcing a ' +
      'split. Growth beyond 130 means status logic is being inlined ' +
      'instead of expressed as small factories.',
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
