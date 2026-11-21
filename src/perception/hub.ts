/**
 * PerceptionHub — aggregates channels and drains events into the backlog.
 *
 * Why the backlog and not a direct LLM call: perception must not bypass
 * the waypoint loop (same "one path" contract as user input). The backlog
 * carries dedup gates, priority, and provenance — repeated perceptions of
 * an unchanged world do not re-enqueue.
 */

import { enqueueBacklog } from '../cerebellum/backlog-enqueue.js';
import type { PerceptionChannelAdapter, PerceptionEvent } from './types.js';

export interface PerceptionHubOptions {
  channels: readonly PerceptionChannelAdapter[];
  /**
   * M2 感知守卫 — optional admission predicate: return false to block an
   * event from enqueuing. Injected by the wiring layer (e.g. "clock
   * check-in only passes when the protected core is non-empty"); a throwing
   * gate is fail-closed (event blocked, drain never crashes). collect() is
   * unaffected — observability keeps full events.
   */
  gate?: (event: PerceptionEvent) => Promise<boolean>;
}

export interface PerceptionHub {
  /** Aggregate events from all channels (stable channel order). */
  collect(now: Date): PerceptionEvent[];
  /**
   * Collect, apply the gate (if any), and enqueue surviving events with
   * origin 'perception'. Returns the number of events enqueued.
   */
  drainToBacklog(rootDir: string, now: Date): Promise<number>;
}

export function createPerceptionHub(options: PerceptionHubOptions): PerceptionHub {
  const channels = options.channels;
  const gate = options.gate;

  return {
    collect(now: Date): PerceptionEvent[] {
      const events: PerceptionEvent[] = [];
      for (const channel of channels) {
        events.push(...channel.collect(now));
      }
      return events;
    },

    async drainToBacklog(rootDir: string, now: Date): Promise<number> {
      const events = this.collect(now);
      let enqueued = 0;
      for (const event of events) {
        if (gate) {
          try {
            if (!(await gate(event))) continue;
          } catch {
            continue; // fail-closed: a broken gate blocks, never crashes
          }
        }
        await enqueueBacklog(
          rootDir,
          `[perception:${event.channel}] ${event.summary}`,
          'perception'
        );
        enqueued += 1;
      }
      return enqueued;
    },
  };
}
