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

Workflow (budget your turns — you have at most 16):
1. Read ONE anchor file that shows the pattern to follow (e.g. an existing tool
   in src/tools/ if you are adding a tool, or the function you must change).
   Do NOT read more than 2 files for exploration — pick the most specific anchor.
2. Make the change with file-write or file-edit. Smallest diff that achieves the goal.
3. If you wrote a new module, wire it into the existing registry/index/main.
4. Mentally run the verify step (tsc for syntax) before declaring done.
5. Respond with the single word DONE once the change is complete.

Hard rules:
- Never disable the safety perimeter: src/cerebellum/orchestrator.ts,
  package.json, tsconfig.json, .gitignore.
- file-read only accepts file paths, not directories. If you get EISDIR,
  stop guessing paths and pick a specific file.
- git is for status/log/commit only — do not use it for exploration.

When you are confident the goal is achieved, respond with the single word: DONE`,
  maxIterations: 16,
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
