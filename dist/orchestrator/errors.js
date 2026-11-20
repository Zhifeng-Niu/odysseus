/**
 * Thrown when a voyage is interrupted (user pressed Ctrl+C, or `interrupt()` was called).
 *
 * The pending Promise in `waitForApproval` is rejected with this error so
 * `runWaypoint` unwinds instead of hanging forever.
 */
export class InterruptedError extends Error {
    reason;
    constructor(reason) {
        super(`Voyage interrupted: ${reason}`);
        this.reason = reason;
        this.name = 'InterruptedError';
    }
}
/**
 * Thrown when the repeated-tool-call detector fires after a recovery intervention
 * has already been attempted and the loop persists. The orchestrator catches
 * this to roll back and mark the waypoint as failed.
 */
export class StuckLoopError extends Error {
    toolName;
    count;
    args;
    constructor(toolName, count, args) {
        super(`Stuck loop detected: "${toolName}" invoked ${count} times in a row ` +
            `with identical arguments (${args}) — loop persisted after recovery intervention`);
        this.toolName = toolName;
        this.count = count;
        this.args = args;
        this.name = 'StuckLoopError';
    }
}
/**
 * Thrown when a waypoint is rejected by the user via `reject(waypointId, reason)`.
 *
 * Distinct from `InterruptedError` so callers can branch on rejection vs. interruption
 * (rejection may trigger rollback of the rejected waypoint specifically).
 */
export class RejectedError extends Error {
    waypointId;
    reason;
    constructor(waypointId, reason) {
        super(`Waypoint ${waypointId} rejected: ${reason}`);
        this.waypointId = waypointId;
        this.reason = reason;
        this.name = 'RejectedError';
    }
}
//# sourceMappingURL=errors.js.map