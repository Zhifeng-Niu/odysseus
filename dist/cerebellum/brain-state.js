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
export const ALLOWED_TRANSITIONS = {
    idle: ['wakeful'],
    wakeful: ['idle', 'dreaming'],
    dreaming: ['reflecting', 'wakeful'],
    reflecting: ['consolidating', 'wakeful'],
    consolidating: ['wakeful', 'idle'],
};
export function canTransitionTo(from, to) {
    return ALLOWED_TRANSITIONS[from].includes(to);
}
/**
 * Initial brain state for a fresh Orchestrator instance. The brain is
 * "asleep until prompted" — no dreaming until there is something to dream
 * about.
 */
export const INITIAL_BRAIN_STATE = 'idle';
/**
 * States in which the agent is actively consuming LLM tokens. Used by the
 * budget tracker — wakeful and dreaming both call the LLM, while reflecting
 * and consolidating may use cheaper local heuristics.
 */
export const LLM_ACTIVE_STATES = ['wakeful', 'dreaming'];
//# sourceMappingURL=brain-state.js.map