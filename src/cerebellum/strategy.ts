import type { Strategy } from './waypoint.js';

export interface StrategyDefinition {
  name: Strategy;
  systemPrompt: string;
  maxIterations: number;
}

export const ENGINEER_STRATEGY: StrategyDefinition = {
  name: 'engineer',
  systemPrompt: `You are Odysseus, a coding agent in engineer orientation.
Your job is to make the requested change with surgical precision.

Rules:
1. Read the relevant files before editing.
2. Make the smallest change that achieves the goal.
3. Never disable the safety perimeter (orchestrator, package.json, tsconfig.json).
4. After every edit, run the project's verify command mentally before declaring done.
5. If you encounter unexpected behavior, prefer to investigate over assuming.

You have access to file tools and git. Use them deliberately.
When you are confident the goal is achieved, respond with the single word: DONE`,
  maxIterations: 8,
};

export interface StrategySelectionInput {
  goal: string;
  requestedStrategy?: Strategy;
  allowedStrategies?: readonly Strategy[];
  previousFailures?: readonly Strategy[];
}

export function selectStrategy(input: StrategySelectionInput): StrategyDefinition {
  const allowed = input.allowedStrategies ?? ['engineer'];
  const requested = input.requestedStrategy ?? 'engineer';

  if (allowed.includes(requested) && !input.previousFailures?.includes(requested)) {
    return ENGINEER_STRATEGY; // Only engineer exists in Iteration 0
  }
  return ENGINEER_STRATEGY;
}
