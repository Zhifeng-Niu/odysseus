import { useEffect, useReducer } from 'react';
function eventLogReducer(state, action) {
    if (action.type === 'append') {
        return {
            events: [...state.events, action.event],
            revision: state.revision + 1,
        };
    }
    return state;
}
export function useOrchestratorEvents(orch) {
    const [state, dispatch] = useReducer(eventLogReducer, { events: [], revision: 0 });
    useEffect(() => {
        const handler = (event) => {
            dispatch({ type: 'append', event });
        };
        orch.on('event', handler);
        return () => {
            orch.off('event', handler);
        };
    }, [orch]);
    return state;
}
/**
 * Extract the latest pending approval gate from the event log, if any.
 * Returns the waypointId awaiting approval, or null if the gate has been
 * resolved (committed/failed/rolled-back).
 */
export function findPendingApproval(events) {
    let pending = null;
    for (const e of events) {
        if (e.type === 'waypoint-awaiting-approval') {
            pending = { waypointId: e.waypointId, iteration: e.iteration };
        }
        else if (e.type === 'waypoint-committed' ||
            e.type === 'waypoint-rolled-back' ||
            e.type === 'waypoint-failed') {
            if (pending !== null && pending.waypointId === e.waypointId) {
                pending = null;
            }
        }
    }
    return pending;
}
/**
 * Derive the current brain state from the event log. Falls back to 'idle'
 * (the initial state) if no brain-state-changed events have been emitted.
 */
export function deriveBrainState(events) {
    let state = 'idle';
    for (const e of events) {
        if (e.type === 'brain-state-changed') {
            state = e.to;
        }
    }
    return state;
}
export function deriveBacklog(events) {
    let size = 0;
    let lastAddedGoal = null;
    let lastDreamCount = 0;
    for (const e of events) {
        if (e.type === 'backlog-item-added') {
            size += 1;
            lastAddedGoal = e.goal;
        }
        else if (e.type === 'voyage-idle') {
            // Idle emits the authoritative backlog size at that moment.
            size = e.backlogSize;
        }
        else if (e.type === 'dream-completed') {
            lastDreamCount = e.backlogItemsAdded;
        }
    }
    return { size, lastAddedGoal, lastDreamCount };
}
//# sourceMappingURL=hooks.js.map