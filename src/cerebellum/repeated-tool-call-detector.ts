/**
 * RepeatedToolCallDetector — sliding-window loop detector.
 *
 * Tracks the last N tool-call signatures (name + serialized args). When all N
 * entries are identical the agent is stuck in a convergence-failure loop and
 * the detector throws an error so the orchestrator can abort + rollback.
 *
 * Scoped per waypoint: a fresh detector is created at the start of each
 * `runWaypoint` call so a new task starts with an empty window.
 */
export class RepeatedToolCallDetector {
  private readonly window: string[] = [];
  private readonly maxSize: number;

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
   * @throws Error    If the last `maxSize` signatures are identical.
   */
  record(toolName: string, args: Record<string, unknown>): void {
    const signature = `${toolName}:${JSON.stringify(args)}`;
    this.window.push(signature);
    if (this.window.length > this.maxSize) {
      this.window.shift();
    }

    if (this.window.length === this.maxSize && this.window.every((s) => s === this.window[0])) {
      throw new Error(
        `repeated-tool-call detector: "${toolName}" invoked ${this.maxSize} times in a row with identical arguments (${JSON.stringify(
          args
        )}) — agent appears stuck in a loop; aborting waypoint`
      );
    }
  }

  /** Current number of signatures in the sliding window (for testing). */
  get size(): number {
    return this.window.length;
  }

  /** Reset the detector (e.g. between waypoints). */
  reset(): void {
    this.window.length = 0;
  }
}
