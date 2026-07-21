/**
 * Voyage state — persists cross-waypoint counters to
 * `.odysseus/voyage-state.json`.
 *
 * Closes self-model aspiration #1 ("Graduated dreamer rhythm"). Today the
 * dreamer gate is binary (side-effect vs not). A `workWaypointCounter`
 * lets a future dream-gate skip dreaming until N work waypoints have
 * accumulated, then reset after dreaming — a circadian-style rhythm.
 *
 * This module is the *state-persistence layer*. The pure decision logic
 * lives in dream-gate.ts; the wiring into orchestrator.ts is deferred to
 * human review (safety perimeter). Shipping this module makes the state
 * available and testable in isolation.
 *
 * Physical shape: `.odysseus/voyage-state.json`
 *   { "workWaypointCounter": 3 }
 *
 * All functions are synchronous (matching loadRecentExplorationsSync in
 * exploration-log.ts) so callers don't need to await — the orchestrator
 * calls these in a synchronous decision path.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Default location of the voyage-state file. */
export const DEFAULT_VOYAGE_STATE_PATH = '.odysseus/voyage-state.json';

/** Shape of the persisted voyage state. */
export interface VoyageState {
  /** Number of consecutive work waypoints since the last dream. */
  workWaypointCounter: number;
}

/** The state returned when the file is missing or unreadable. */
export const INITIAL_VOYAGE_STATE: VoyageState = {
  workWaypointCounter: 0,
};

/**
 * Read voyage state from disk. Returns INITIAL_VOYAGE_STATE when the
 * file is missing, empty, or contains malformed JSON — a fresh agent
 * starts with counter 0.
 *
 * Extra fields in the JSON are tolerated (forward-compatible): only
 * `workWaypointCounter` is read; missing fields default to 0.
 */
export function readVoyageState(
  path: string = DEFAULT_VOYAGE_STATE_PATH,
): VoyageState {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { ...INITIAL_VOYAGE_STATE };
  }

  if (raw.trim().length === 0) {
    return { ...INITIAL_VOYAGE_STATE };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...INITIAL_VOYAGE_STATE };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ...INITIAL_VOYAGE_STATE };
  }

  const obj = parsed as Record<string, unknown>;
  const counter = obj.workWaypointCounter;
  return {
    workWaypointCounter:
      typeof counter === 'number' && Number.isFinite(counter)
        ? Math.max(0, Math.floor(counter))
        : 0,
  };
}

/**
 * Persist voyage state to disk. Creates parent directories as needed.
 * Atomicity is best-effort (single writeFileSync call).
 */
function writeVoyageState(
  path: string,
  state: VoyageState,
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * Increment the work-waypoint counter and persist. Returns the new
 * counter value.
 */
export function incrementWorkCounter(
  path: string = DEFAULT_VOYAGE_STATE_PATH,
): number {
  const state = readVoyageState(path);
  const next: VoyageState = {
    workWaypointCounter: state.workWaypointCounter + 1,
  };
  writeVoyageState(path, next);
  return next.workWaypointCounter;
}

/**
 * Reset the work-waypoint counter to 0 and persist. Called after a
 * dream cycle completes so the counter can begin accumulating again.
 */
export function resetWorkCounter(
  path: string = DEFAULT_VOYAGE_STATE_PATH,
): void {
  writeVoyageState(path, { ...INITIAL_VOYAGE_STATE });
}
