import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { OrchestratorEvent } from '../orchestrator/events.js';

/**
 * Append-only recorder for orchestrator events.
 *
 * Captures the fine-grained event stream (tool calls, assistant messages,
 * verify outcomes, brain-state transitions) that the waypoint-level
 * trace.jsonl summarizes over. Used for development retrospective —
 * reconstructing what the agent actually did inside a waypoint, not just
 * the outcome.
 *
 * Writes are serialized through a promise chain to avoid interleaved
 * partial-lines when the orchestrator emits bursts of events on the same
 * tick. Recorder errors are swallowed: a logging failure must never
 * crash the voyage.
 */

let writeChain: Promise<void> = Promise.resolve();

export function recordEvent(path: string, event: OrchestratorEvent): void {
  writeChain = writeChain
    .then(() => writeOne(path, event))
    .catch(() => {
      // Swallow — logging is best-effort. The orchestrator must keep running
      // even if the disk is full or the path is unwritable.
    });
}

async function writeOne(path: string, event: OrchestratorEvent): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const line = JSON.stringify(event) + '\n';
  await appendFile(path, line, 'utf8');
}

/**
 * Replay all events from a log file in emission order. Malformed lines are
 * skipped defensively — a corrupted tail must not break retrospective reads
 * of the earlier events.
 */
export async function readEventLog(path: string): Promise<OrchestratorEvent[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  const events: OrchestratorEvent[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      events.push(JSON.parse(trimmed) as OrchestratorEvent);
    } catch {
      // Skip malformed line.
    }
  }
  return events;
}

/**
 * Filter events to a single waypoint, in emission order. Useful for
 * retrospective: "show me everything that happened inside wp_xyz".
 */
export function eventsForWaypoint(
  events: readonly OrchestratorEvent[],
  waypointId: string
): OrchestratorEvent[] {
  return events.filter((e) => {
    if ('waypointId' in e) return e.waypointId === waypointId;
    return false;
  });
}
