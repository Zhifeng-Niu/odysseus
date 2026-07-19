export type Strategy = 'engineer' | 'creative' | 'production';
export type WaypointStatus = 'pending' | 'active' | 'success' | 'failure' | 'abandoned';

export interface Waypoint {
  id: string;
  goal: string;
  strategy: Strategy;
  status: WaypointStatus;
  startedAt: number;
  endedAt?: number;
  parentWaypointId?: string;
  checkpointSha?: string;
  iterationsUsed: number;
  failureReason?: string;
}

export interface CreateWaypointInput {
  goal: string;
  strategy?: Strategy;
  parentWaypointId?: string;
}

let counter = 0;

function nextId(): string {
  counter += 1;
  const stamp = Date.now().toString(36);
  const seq = counter.toString(36).padStart(3, '0');
  return `wp_${stamp}${seq}`;
}

export function createWaypoint(input: CreateWaypointInput): Waypoint {
  return {
    id: nextId(),
    goal: input.goal,
    strategy: input.strategy ?? 'engineer',
    status: 'pending',
    startedAt: Date.now(),
    ...(input.parentWaypointId !== undefined
      ? { parentWaypointId: input.parentWaypointId }
      : {}),
    iterationsUsed: 0,
  };
}

export function markActive(waypoint: Waypoint): Waypoint {
  return { ...waypoint, status: 'active' };
}

export function markSuccess(
  waypoint: Waypoint,
  checkpointSha: string,
  iterationsUsed: number
): Waypoint {
  return {
    ...waypoint,
    status: 'success',
    checkpointSha,
    iterationsUsed,
    endedAt: Date.now(),
  };
}

export function markFailure(
  waypoint: Waypoint,
  reason: string,
  iterationsUsed: number
): Waypoint {
  return {
    ...waypoint,
    status: 'failure',
    failureReason: reason,
    iterationsUsed,
    endedAt: Date.now(),
  };
}

export function markAbandoned(waypoint: Waypoint, reason: string): Waypoint {
  return {
    ...waypoint,
    status: 'abandoned',
    failureReason: reason,
    endedAt: Date.now(),
  };
}
