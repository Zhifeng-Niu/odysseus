let counter = 0;
function nextId() {
    counter += 1;
    const stamp = Date.now().toString(36);
    const seq = counter.toString(36).padStart(3, '0');
    return `wp_${stamp}${seq}`;
}
export function createWaypoint(input) {
    return {
        id: nextId(),
        goal: input.goal,
        strategy: input.strategy ?? 'engineer',
        status: 'pending',
        startedAt: Date.now(),
        ...(input.parentWaypointId !== undefined
            ? { parentWaypointId: input.parentWaypointId }
            : {}),
        ...(input.voyageId !== undefined ? { voyageId: input.voyageId } : {}),
        iterationsUsed: 0,
    };
}
export function markActive(waypoint) {
    return { ...waypoint, status: 'active' };
}
export function markSuccess(waypoint, checkpointSha, iterationsUsed) {
    return {
        ...waypoint,
        status: 'success',
        checkpointSha,
        iterationsUsed,
        endedAt: Date.now(),
    };
}
export function markFailure(waypoint, reason, iterationsUsed) {
    return {
        ...waypoint,
        status: 'failure',
        failureReason: reason,
        iterationsUsed,
        endedAt: Date.now(),
    };
}
export function markAbandoned(waypoint, reason) {
    return {
        ...waypoint,
        status: 'abandoned',
        failureReason: reason,
        endedAt: Date.now(),
    };
}
//# sourceMappingURL=waypoint.js.map