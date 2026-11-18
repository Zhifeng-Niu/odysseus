/**
 * Perception — the agent's sensory channels.
 *
 * Consensus template (IBM "Agentic components"): perception collects data
 * from the environment / user / internal state to build state
 * representation. Spike design: channels produce PerceptionEvents; the hub
 * (hub.ts) drains them into the backlog with origin 'perception', so the
 * proven dream/idle-voyage machinery consumes them — perception never
 * bypasses the waypoint loop.
 */

export type PerceptionChannel = 'file' | 'clock';

export interface PerceptionEvent {
  /** Stable id, format `p_<hex>` for grep-ability. */
  readonly id: string;
  readonly channel: PerceptionChannel;
  readonly kind: string;
  /** Human/LLM-readable one-liner; becomes the backlog goal text. */
  readonly summary: string;
  readonly ts: number;
}

/** Uniform channel contract the hub aggregates over. */
export interface PerceptionChannelAdapter {
  readonly channel: PerceptionChannel;
  /** Pure/pull-based collection; `now` injected for determinism. */
  collect(now: Date): PerceptionEvent[];
}

let perceptionIdCounter = 0;

export function generatePerceptionId(): string {
  perceptionIdCounter += 1;
  return `p_${Date.now().toString(16)}${perceptionIdCounter.toString(16).padStart(4, '0')}`;
}
