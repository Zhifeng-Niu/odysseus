/**
 * Planner policy — heuristics that decide whether a goal warrants a
 * planning pass before execution.
 *
 * Extracted from planner.ts (Iteration 42) to keep that module focused
 * on the LLM-driven decomposition mechanism. The policy is pure logic
 * — no LLM call, no I/O — so it belongs in its own module that the
 * orchestrator can import independently.
 *
 * The orchestrator (safety-perimeter module) imports `shouldPlanGoal`
 * from planner.ts via a re-export there — that keeps the safety-
 * perimeter file's import surface unchanged across this extraction.
 * New callers should import directly from planner-policy.ts.
 */

/**
 * Minimum goal length (in characters) that triggers planning without a
 * keyword match. Below this threshold the goal is almost certainly
 * single-waypoint-sized (e.g., "add error-loop detection to self-monitor.ts"
 * is 49 chars). Tuned by sampling real waypoint goals from trace.jsonl:
 * single-file changes typically clock in at 40–80 chars, multi-step
 * epics at 100+ chars. The threshold 60 sits in the middle — a goal
 * shorter than 60 chars is very likely a single waypoint; a goal at
 * 60+ chars MAY be multi-step and is worth a planning pass.
 *
 * The threshold is a HEURISTIC — keyword match below is the other
 * trigger. A goal can be short AND trigger planning if it contains
 * "refactor" or "system".
 */
export const MIN_PLAN_GOAL_LENGTH = 60;

/**
 * Keywords that trigger planning regardless of goal length. Presence of
 * any of these signals the goal is likely multi-step even when terse.
 * The list is deliberately small — each entry must earn its place by
 * catching real multi-step goals that the length heuristic would miss.
 *
 * Bilingual (English + Chinese) because Odysseus's goals originate from
 * both English operator commands and Chinese conversational inputs.
 */
export const PLAN_KEYWORDS: readonly string[] = [
  'refactor',
  '重构',
  'redesign',
  '重设计',
  'system',
  '系统',
  'full',
  '完整',
  'module',
  '模块',
  'end-to-end',
  '端到端',
  'overhaul',
  '改造',
];

/**
 * Decide whether a goal is complex enough to warrant a planning pass
 * before execution.
 *
 * Two triggers, either suffices:
 *   1. LENGTH — goal is at least MIN_PLAN_GOAL_LENGTH chars after trim.
 *      Multi-step goals tend to be longer because they name multiple
 *      files or behaviors.
 *   2. KEYWORD — goal contains any of PLAN_KEYWORDS (case-insensitive).
 *      Words like "refactor" / "system" / "module" reliably signal
 *      multi-step intent even when the goal itself is terse.
 *
 * Returns false for empty/whitespace goals — the caller then executes
 * the goal directly (no regression vs. pre-planner behavior).
 *
 * This function is the POLICY counterpart to plan()'s MECHANISM. Keeping
 * them separate means the orchestrator (or any future caller) can apply
 * the policy without committing to a specific plan() invocation shape.
 * The policy is also independently testable, which matters because the
 * threshold and keyword list will need tuning as we see what real
 * user goals look like.
 */
export function shouldPlanGoal(goal: string): boolean {
  const trimmed = goal.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length >= MIN_PLAN_GOAL_LENGTH) return true;
  const lower = trimmed.toLowerCase();
  return PLAN_KEYWORDS.some((kw) => lower.includes(kw));
}
