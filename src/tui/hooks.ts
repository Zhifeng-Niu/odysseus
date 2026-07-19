import { useEffect, useReducer } from 'react';
import type { CerebellumOrchestrator } from '../cerebellum/orchestrator.js';
import type { OrchestratorEvent } from '../orchestrator/events.js';
import type { BrainState } from '../cerebellum/brain-state.js';

/**
 * Append-only reducer for the Orchestrator event stream. Components subscribe
 * to this hook and re-render whenever a new event arrives.
 *
 * The reducer is intentionally trivial — we never mutate events in flight.
 * The event log is the single source of truth for TUI state; derived views
 * (waypoint grouping, latest approval gate, status) are computed in render.
 */
interface EventLogState {
  readonly events: readonly OrchestratorEvent[];
  readonly revision: number;
}

type EventLogAction = { type: 'append'; event: OrchestratorEvent };

function eventLogReducer(state: EventLogState, action: EventLogAction): EventLogState {
  if (action.type === 'append') {
    return {
      events: [...state.events, action.event],
      revision: state.revision + 1,
    };
  }
  return state;
}

export function useOrchestratorEvents(orch: CerebellumOrchestrator): EventLogState {
  const [state, dispatch] = useReducer(eventLogReducer, { events: [], revision: 0 });

  useEffect(() => {
    const handler = (event: OrchestratorEvent): void => {
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
export function findPendingApproval(
  events: readonly OrchestratorEvent[]
): { waypointId: string; iteration: number } | null {
  let pending: { waypointId: string; iteration: number } | null = null;
  for (const e of events) {
    if (e.type === 'waypoint-awaiting-approval') {
      pending = { waypointId: e.waypointId, iteration: e.iteration };
    } else if (
      e.type === 'waypoint-committed' ||
      e.type === 'waypoint-rolled-back' ||
      e.type === 'waypoint-failed'
    ) {
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
export function deriveBrainState(events: readonly OrchestratorEvent[]): BrainState {
  let state: BrainState = 'idle';
  for (const e of events) {
    if (e.type === 'brain-state-changed') {
      state = e.to;
    }
  }
  return state;
}

/**
 * Derive the backlog snapshot from the event log.
 *
 * Returns `{ size, lastAdded }` where `lastAdded` is the most recently
 * enqueued item's goal (truncated for display). The actual queue lives on
 * disk — this is a derived view from events only, consistent with the
 * "events are the single source of truth" pattern.
 */
export interface BacklogSnapshot {
  readonly size: number;
  readonly lastAddedGoal: string | null;
  readonly lastDreamCount: number;
}

export function deriveBacklog(events: readonly OrchestratorEvent[]): BacklogSnapshot {
  let size = 0;
  let lastAddedGoal: string | null = null;
  let lastDreamCount = 0;

  for (const e of events) {
    if (e.type === 'backlog-item-added') {
      size += 1;
      lastAddedGoal = e.goal;
    } else if (e.type === 'voyage-idle') {
      // Idle emits the authoritative backlog size at that moment.
      size = e.backlogSize;
    } else if (e.type === 'dream-completed') {
      lastDreamCount = e.backlogItemsAdded;
    }
  }
  return { size, lastAddedGoal, lastDreamCount };
}
