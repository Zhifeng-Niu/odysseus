/**
 * Brain state machine — models the cognitive activity of the agent between
 * and during waypoints.
 *
 * The Orchestrator is the agent's "self-evolution mechanism", not just a task
 * executor. Between waypoints (idle phases) the brain doesn't simply wait —
 * it dreams, reflects, and consolidates, mirroring biological brain activity
 * during sleep.
 *
 * State semantics:
 * - `idle`          : Awaiting external trigger (user input). No cognitive
 *                     activity. Initial state.
 * - `wakeful`       : Executing a waypoint. LLM ↔ tool loop running.
 * - `dreaming`      : Free-association pass over recent trace + memory. LLM
 *                     produces backlog candidates without a goal prompt.
 * - `reflecting`    : Meta-cognition on the last waypoint (why did it fail?
 *                     what surprised us?). Produces backlog items + memory
 *                     entries.
 * - `consolidating` : Persisting backlog/memory updates to disk. The
 *                     "memory write" phase — short-term traces become
 *                     long-term memory.
 *
 * Transitions are constrained by `ALLOWED_TRANSITIONS` — see the unit
 * tests for the invariant.
 *
 * Why explicit modeling (not emergence): internal subsystems are *callable*
 * just like biological cells/tissues — the agent's "thoughts" are observable
 * to itself, while the user-facing persona emerges from their interaction.
 */
export type BrainState =
  | 'idle'
  | 'wakeful'
  | 'dreaming'
  | 'reflecting'
  | 'consolidating';

/**
 * The set of states any given state may legally transition to.
 *
 * State machine topology:
 *
 *   idle ──► wakeful ──► dreaming ──► reflecting ──► consolidating
 *    ▲           │                                      │
 *    └───────────┴──────────────────────────────────────┘
 *
 * - `wakeful → idle` happens when a waypoint completes with empty backlog
 *   (no self-evolution work to do).
 * - `wakeful → dreaming` happens when a waypoint completes with backlog items
 *   queued (or when the dreamer produces them on the fly).
 * - `consolidating → wakeful` happens when the next backlog item starts; → idle
 *   when the backlog is drained.
 * - Any state can be pre-empted back to `wakeful` (user input during dreaming
 *   interrupts the dream and starts a new waypoint).
 *
 * `learning` is intentionally omitted from Iteration 0+ — there is no external
 * knowledge source yet. It will be added when the agent can read docs/PRs.
 */
export const ALLOWED_TRANSITIONS: Record<BrainState, readonly BrainState[]> = {
  idle: ['wakeful'],
  wakeful: ['idle', 'dreaming'],
  dreaming: ['reflecting', 'wakeful'],
  reflecting: ['consolidating', 'wakeful'],
  consolidating: ['wakeful', 'idle'],
};

export function canTransitionTo(from: BrainState, to: BrainState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface BrainStateTransition {
  readonly from: BrainState;
  readonly to: BrainState;
  readonly reason: string;
  readonly ts: number;
}

/**
 * Initial brain state for a fresh Orchestrator instance. The brain is
 * "asleep until prompted" — no dreaming until there is something to dream
 * about.
 */
export const INITIAL_BRAIN_STATE: BrainState = 'idle';

/**
 * States in which the agent is actively consuming LLM tokens. Used by the
 * budget tracker — wakeful and dreaming both call the LLM, while reflecting
 * and consolidating may use cheaper local heuristics.
 */
export const LLM_ACTIVE_STATES: readonly BrainState[] = ['wakeful', 'dreaming'];
