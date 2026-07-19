/**
 * In-memory registry of goals that have already been completed during a
 * session. Used by the orchestrator to avoid re-attempting work that is
 * already done.
 */

/** Outcome recorded for a completed goal. */
export type GoalOutcome = {
  /** The goal description that was completed. */
  description: string;
  /** The outcome/result string captured when the goal was marked complete. */
  outcome: string;
  /** Epoch millis when the goal was marked complete. */
  completedAt: number;
};

/** Public view of a completed goal. */
export type CompletedGoal = GoalOutcome;

// In-memory store keyed by goal description. Not persisted across sessions.
const completedGoals: Map<string, GoalOutcome> = new Map();

/**
 * Returns true if `goalDescription` matches an already-completed goal.
 * Matching is substring-based (case-sensitive): a match occurs when the
 * given description is a substring of a stored goal description, or a
 * stored goal description is a substring of the given description.
 */
export function isCompleted(goalDescription: string): boolean {
  if (!goalDescription) {
    return false;
  }
  const needle = goalDescription;
  for (const key of completedGoals.keys()) {
    if (key.includes(needle) || needle.includes(key)) {
      return true;
    }
  }
  return false;
}

/**
 * Records that `goalDescription` has been completed with the given
 * `outcome`. Overwrites any prior entry for the same description.
 */
export function markCompleted(goalDescription: string, outcome: string): void {
  completedGoals.set(goalDescription, {
    description: goalDescription,
    outcome,
    completedAt: Date.now(),
  });
}

/** Test helper: clears all recorded completed goals. */
export function clearCompletedGoals(): void {
  completedGoals.clear();
}

/** Returns a snapshot of all completed goals (in insertion order). */
export function getCompletedGoals(): CompletedGoal[] {
  return Array.from(completedGoals.values());
}
