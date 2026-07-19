/**
 * RepeatedToolCallDetector — sliding-window loop detector with recovery.
 *
 * Tracks the last N tool-call signatures (name + serialized args). When all N
 * entries are identical the agent is stuck in a convergence-failure loop.
 *
 * Recovery intervention: on the FIRST loop detection the detector does NOT
 * throw — instead it returns a recovery context message for the orchestrator
 * to inject into the LLM history, giving the agent one more chance to break
 * out of the loop. If the same pattern recurs after the recovery injection,
 * the detector throws a `StuckLoopError` and the orchestrator aborts + rolls back.
 *
 * Scoped per waypoint: a fresh detector is created at the start of each
 * `runWaypoint` call so a new task starts with an empty window.
 */

import { StuckLoopError } from '../orchestrator/errors.js';

export interface RecordResult {
  /** True when a loop was detected. */
  loopDetected: boolean;
  /**
   * When the first loop is detected, a human-readable context message the
   * orchestrator should inject into the LLM history as a `user` message.
   * Undefined when no loop was detected, or when the hard-abort threshold
   * is reached (in that case `record` throws instead).
   */
  recoveryMessage?: string;
}

export class RepeatedToolCallDetector {
  private readonly window: string[] = [];
  private readonly maxSize: number;

  /**
   * After the first loop detection the window is reset and this flag is set.
   * A second loop detection while this is true triggers the hard abort.
   */
  private recoveryAttempted = false;

  constructor(maxSize = 3) {
    if (maxSize < 2) {
      throw new Error('RepeatedToolCallDetector maxSize must be >= 2');
    }
    this.maxSize = maxSize;
  }

  /**
   * Record a tool call and check for a loop.
   *
   * @param toolName  - The function name from the tool call.
   * @param args      - Parsed arguments object.
   * @returns A `RecordResult` indicating whether a loop was detected and
   *          whether a recovery message should be injected.
   * @throws Error    If the loop recurs after a recovery intervention has
   *                  already been attempted.
   */
  record(toolName: string, args: Record<string, unknown>): RecordResult {
    const signature = `${toolName}:${JSON.stringify(args)}`;
    this.window.push(signature);
    if (this.window.length > this.maxSize) {
      this.window.shift();
    }

    if (this.window.length === this.maxSize && this.window.every((s) => s === this.window[0])) {
      if (!this.recoveryAttempted) {
        // First loop detection — inject a recovery context message instead of
        // aborting. Reset the window so the agent gets a fresh chance.
        this.recoveryAttempted = true;
        this.window.length = 0;
        const recoveryMessage =
          `[RECOVERY INTERVENTION] You have invoked "${toolName}" ${this.maxSize} times ` +
          `in a row with identical arguments (${JSON.stringify(args)}). ` +
          `This indicates a loop — the approach is not making progress. ` +
          `Try a different strategy, different arguments, or a different tool entirely. ` +
          `If the problem cannot be solved, respond with DONE and explain what you tried.`;
        return { loopDetected: true, recoveryMessage };
      }

      // Second loop detection after recovery — throw StuckLoopError.
      throw new StuckLoopError(toolName, this.maxSize, JSON.stringify(args));
    }

    return { loopDetected: false };
  }

  /** Current number of signatures in the sliding window (for testing). */
  get size(): number {
    return this.window.length;
  }

  /** Whether a recovery intervention has already been attempted (for testing). */
  get hasRecoveryAttempted(): boolean {
    return this.recoveryAttempted;
  }

  /** Reset the detector (e.g. between waypoints). */
  reset(): void {
    this.window.length = 0;
    this.recoveryAttempted = false;
  }
}
