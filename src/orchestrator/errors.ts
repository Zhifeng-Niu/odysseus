/**
 * Thrown when a voyage is interrupted (user pressed Ctrl+C, or `interrupt()` was called).
 *
 * The pending Promise in `waitForApproval` is rejected with this error so
 * `runWaypoint` unwinds instead of hanging forever.
 */
export class InterruptedError extends Error {
  constructor(public reason: string) {
    super(`Voyage interrupted: ${reason}`);
    this.name = 'InterruptedError';
  }
}

/**
 * Thrown when a waypoint is rejected by the user via `reject(waypointId, reason)`.
 *
 * Distinct from `InterruptedError` so callers can branch on rejection vs. interruption
 * (rejection may trigger rollback of the rejected waypoint specifically).
 */
export class RejectedError extends Error {
  constructor(
    public waypointId: string,
    public reason: string,
  ) {
    super(`Waypoint ${waypointId} rejected: ${reason}`);
    this.name = 'RejectedError';
  }
}
