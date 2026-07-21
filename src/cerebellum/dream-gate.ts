/**
 * Graduated dreamer rhythm gate.
 *
 * Today the dreamer fires on a binary condition: side-effects happened
 * during the waypoint. Aspiration 1 (self-model) calls for a circadian-
 * style rhythm — skip dreaming until `workWaypointCounter` reaches a
 * threshold, then reset after dreaming. This module extracts the pure
 * decision function so it can be tested in isolation and wired into
 * the orchestrator later without touching the safety perimeter.
 *
 * Pure function, no I/O, no LLM calls.
 */

/**
 * Decide whether the dreamer should run this waypoint.
 *
 * @param workWaypointCounter  Number of consecutive work waypoints since
 *                             the last dream (caller resets to 0 after a
 *                             successful dream).
 * @param threshold            Minimum counter value required before
 *                             dreaming is even considered.
 * @param hasSideEffects       Whether the current waypoint performed any
 *                             mutating tool call (file-write/edit, git
 *                             commit, bash).
 * @returns `true` only when there were side effects AND the counter has
 *          reached the threshold — i.e. dreaming is both warranted and
 *          due.
 */
export function shouldDream(
  workWaypointCounter: number,
  threshold: number,
  hasSideEffects: boolean,
): boolean {
  return hasSideEffects && workWaypointCounter >= threshold;
}
